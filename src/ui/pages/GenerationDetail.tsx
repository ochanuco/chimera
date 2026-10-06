import { Layout } from '../layout';
import { formatImageMetaText, type ImageMeta } from '../../lib/image-meta';
import { CopyIdButton } from '../components/CopyIdButton';
import type { GenerationFamily } from '../../lib/generation-family';
import { FamilyStrip, type FamilyCardData } from '../components/FamilyCard';
import { FinalizeSection } from '../components/FinalizeSection';
import type { BackdropOption } from '../components/FinalizeFields';
import type { FinalizeDials, FinalizeProfileOption } from '../finalize-options';
import type { FinalizeDefaults, FinalizeDof, FinalizeLight } from '../../lib/catalogs';
import { NoteSection } from '../components/NoteSection';
import { ResolvedOptionsTable } from '../components/ResolvedOptionsTable';
import { PoseReferenceRow, type PoseReferenceData } from '../components/PoseReferenceRow';
import { PromptChips } from '../components/PromptChips';
import { SafetySection, type SafetyDetailData } from '../components/SafetyBadge';
import { PublicationSection, type PublicationData } from '../components/PublicationSection';
import { RatingBookmark } from '../components/RatingBookmark';
import { TagsEditor } from '../components/TagsEditor';
import type { RenderFacts, RenderLatentSource, RenderSampler } from '../../lib/render-facts';

export type { PublicationData };

export interface GenerationDetailData {
  id: string;
  short_id: string;
  canonical_url: string;
  image: { url: string };
  /** original.png が保持ジョブで削除された時刻。null なら未削除。 */
  original_purged_at: string | null;
  character: { id: string; name: string } | null;
  created_at: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  note: string | null;
  summary: string | null;
  semantic: {
    schema_version: number;
    core: Record<string, string | null>;
    strengths: string[];
    defects: string[];
    attributes: Record<string, unknown>;
  } | null;
  request: {
    id: string;
    short_id: string | null;
    kind: string;
    prompt: string | null;
    negative_prompt: string | null;
    recipe: string | null;
    raw_instruction: string | null;
    git_commit: string | null;
    git_dirty: boolean;
  } | null;
  siblings: { id: string; short_id: string; image_width: number | null; image_height: number | null; comfy_output_index: number | null }[];
  publications: PublicationData[];
  safety: SafetyDetailData | null;
  pose_reference: PoseReferenceData | null;
  refines_generation: { id: string; short_id: string; rating: 'bad' | 'neutral' | 'good' | null } | null;
  comfy_job: {
    id: string;
    seed: number | null;
    comfy_prompt_id: string | null;
    status: string;
    graph: unknown;
    render_facts: RenderFacts | null;
  } | null;
  original_filename: string | null;
}

/** Latest finalize requests targeting this Generation (GET /api/v1/requests?kind=finalize&generation_id=). */
export interface FinalizeRequestSummary {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at: string;
  error: string | null;
  /** done の場合の納品 Generation の short_id（resolveGenerationShortIds で解決済み）。 */
  resultShortId: string | null;
  /** worker が done の `result` に書く解決済みの値 (docs/worker-protocol.md「finalize profile」)。opaque。 */
  resolvedOptions: Record<string, unknown> | null;
}

/** `options` が requested のまま、`result.resolved_options` が worker の解決値 — このGenerationを産んだ finalize/repair/masked_redraw request から。 */
export interface ProducedByOptions {
  requested: Record<string, unknown> | null;
  resolved: Record<string, unknown>;
}

/** `LoRA name @strength_model (clip strength_clip)`, omitting the clip part when absent or equal to strength_model. */
function formatLoraLine(l: RenderFacts['loras'][number]): string {
  let s = `${l.lora_name} @${l.strength_model ?? '?'}`;
  if (l.strength_clip !== null && l.strength_clip !== l.strength_model) s += ` (clip ${l.strength_clip})`;
  return s;
}

/** `ControlNet name @strength · start–end`, omitting the range when the apply node carries none. */
function formatControlNetLine(cn: RenderFacts['controlnets'][number]): string {
  let s = `${cn.control_net_name} @${cn.strength ?? '?'}`;
  if (cn.start_percent !== null && cn.end_percent !== null) s += ` · ${cn.start_percent}–${cn.end_percent}`;
  return s;
}

/** How a pass's canvas came to be: an empty latent's size, an upscale (literal size or *By scale factor), or an unrecognized upstream node. */
function formatLatentLine(latent: RenderLatentSource | null): string {
  if (!latent) return '(unknown latent source)';
  if (latent.kind === 'empty') return `${latent.width ?? '?'}×${latent.height ?? '?'} · empty latent`;
  if (latent.kind === 'other') return '(unrecognized latent source)';
  const label = latent.kind === 'latent_upscale' ? 'latent upscale' : 'image upscale';
  if (latent.width !== null && latent.height !== null) {
    return `${label} ${latent.upscale_method ?? '?'} → ${latent.width}×${latent.height}`;
  }
  if (latent.scale_by !== null) return `×${latent.scale_by} (${latent.upscale_method ?? '?'})`;
  return label;
}

function formatSamplerLine(s: RenderSampler): string {
  return `${s.sampler_name ?? '?'} / ${s.scheduler ?? '?'} · ${s.steps ?? '?'} steps · cfg ${s.cfg ?? '?'} · denoise ${s.denoise ?? '?'} · seed ${s.seed ?? '?'}`;
}

/** Pass n's "continues pass k" label: matches latent.from_node_id against an earlier sampler's node_id. */
function findContinuesPassIndex(samplers: RenderSampler[], index: number): number | null {
  const fromNodeId = samplers[index]?.latent?.from_node_id ?? null;
  if (!fromNodeId) return null;
  const i = samplers.findIndex((s) => s.node_id === fromNodeId);
  return i >= 0 ? i : null;
}

function renderPromptField(label: string, text: string | null, parentText: string | null | undefined, variant: 'positive' | 'negative') {
  return (
    <div class="prompt-field">
      <div class="prompt-field-label">
        {label} {text ? <CopyIdButton value={text} /> : null}
      </div>
      <PromptChips text={text} parentText={parentText} variant={variant} />
    </div>
  );
}

/** A pass-2+ prompt field: collapses to "same as pass N" when identical (trimmed) to the previous pass, else diffs against it via PromptChips. */
function renderPassPromptField(
  label: string,
  text: string | null,
  prevText: string | null,
  prevPassNumber: number,
  variant: 'positive' | 'negative',
) {
  if (prevPassNumber === 0) return renderPromptField(label, text, null, variant);
  if (text !== null && prevText !== null && text.trim() === prevText.trim()) {
    return (
      <div class="prompt-field">
        <div class="prompt-field-label">{label}</div>
        <p class="workflow-line">same as pass {prevPassNumber}</p>
      </div>
    );
  }
  return renderPromptField(label, text, prevText, variant);
}

export function GenerationDetailPage({
  path,
  data,
  tags,
  family,
  imageMeta,
  finalizeRequests,
  finalizeDials,
  finalizeDefaults = null,
  finalizeDof = null,
  finalizeLight = null,
  finalizeBackdropColor = null,
  finalizeProfiles,
  finalizeBackdrops = [],
  finalizeRecipeRef = null,
  finalizeCatalogVersion = null,
  canPromoteToProfile,
  producedByOptions,
}: {
  path: string;
  data: GenerationDetailData;
  tags: { id: string; name: string }[];
  /** 親 / 子 / 兄弟カード (素材参照・仕上げ元・Experiment Run)。 */
  family: GenerationFamily;
  imageMeta: ImageMeta | null;
  /** 最新の finalize request 一覧 (最大5件、新しい順)。GUI はここに積むだけで進捗もここで見る。 */
  finalizeRequests: FinalizeRequestSummary[];
  finalizeDials: FinalizeDials | null;
  finalizeDefaults?: FinalizeDefaults | null;
  finalizeDof?: FinalizeDof | null;
  finalizeLight?: FinalizeLight | null;
  finalizeBackdropColor?: string | null;
  finalizeProfiles: FinalizeProfileOption[];
  finalizeBackdrops?: BackdropOption[];
  finalizeRecipeRef?: string | null;
  finalizeCatalogVersion?: string | null;
  canPromoteToProfile: boolean;
  /** このGeneration自身を産んだ finalize/repair/masked_redraw request の options。resolved_options を worker がまだ書かない行は null。 */
  producedByOptions: ProducedByOptions | null;
}) {
  const parentCards = family.parents;
  const childCards = family.children;
  const siblingCards = family.siblings;
  const requestGenerationCards: FamilyCardData[] = data.siblings.map(
    (g): FamilyCardData => ({
      kind: 'request',
      href: `/g/${g.short_id}`,
      shortId: g.short_id,
      imageUrl: `/g/${g.short_id}/preview`,
      detail: g.comfy_output_index !== null ? `output ${g.comfy_output_index}` : null,
    }),
  );

  return (
    <Layout title={`Generation ${data.short_id}`} fullBleed path={path}>
      <div class="detail-layout">
        <div class="detail-left">
          <div class="gen-detail-hero">
            <img src={data.original_purged_at ? `/g/${data.short_id}/preview` : data.image.url} alt={data.short_id} />
          </div>
          {formatImageMetaText(imageMeta) ? <p class="image-meta">{formatImageMetaText(imageMeta)}</p> : null}
          {data.original_purged_at ? <p class="image-meta">原寸は破棄済み（preview のみ）</p> : null}
        </div>
        <div class="detail-right">
          <h1>
            {data.short_id} <CopyIdButton value={data.short_id} />{' '}
            {data.refines_generation ? (
              <span class="detail-from">
                from <a href={`/g/${data.refines_generation.short_id}`}>{data.refines_generation.short_id}</a>{' '}
                <CopyIdButton value={data.refines_generation.short_id} />
              </span>
            ) : null}{' '}
            <button type="button" class="compare-add-btn" data-generation-id={data.id} data-short-id={data.short_id}>
              比較に追加
            </button>
          </h1>
          {data.character ? <p>{data.character.name}</p> : null}
          <RatingBookmark id={data.id} rating={data.rating} bookmark={data.bookmark} />

          <PoseReferenceRow generationId={data.id} poseReference={data.pose_reference} />

          <SafetySection safety={data.safety} />

          <PublicationSection generationId={data.id} publications={data.publications} safety={data.safety} />

          <datalist id="tag-suggestions"></datalist>
          <TagsEditor kind="generations" id={data.id} tags={tags} />

          <FinalizeSection
            shortId={data.short_id}
            requests={finalizeRequests}
            open={!data.refines_generation}
            dials={finalizeDials}
            defaults={finalizeDefaults}
            dof={finalizeDof}
            light={finalizeLight}
            backdropColor={finalizeBackdropColor}
            profiles={finalizeProfiles}
            backdrops={finalizeBackdrops}
            recipeRef={finalizeRecipeRef}
            catalogVersion={finalizeCatalogVersion}
            canPromoteToProfile={canPromoteToProfile}
            purged={Boolean(data.original_purged_at)}
          />

          {producedByOptions ? (
            <details class="section" open>
              <summary>仕上げの解決値</summary>
              <div class="section-body">
                <ResolvedOptionsTable requested={producedByOptions.requested} resolved={producedByOptions.resolved} />
              </div>
            </details>
          ) : null}

          <details class="section" open>
            <summary>Summary</summary>
            <div class="section-body">{data.summary ?? 'No summary yet.'}</div>
          </details>

          <details class="section" open>
            <summary>Semantic</summary>
            <div class="section-body">
              {data.semantic ? (
                <>
                  <table class="kv-table">
                    {Object.entries(data.semantic.core).map(([k, v]) => (
                      <tr>
                        <td>{k}</td>
                        <td>{v ?? '-'}</td>
                      </tr>
                    ))}
                  </table>
                  <p>Strengths: {data.semantic.strengths.length ? data.semantic.strengths.join(', ') : '-'}</p>
                  <p>Defects: {data.semantic.defects.length ? data.semantic.defects.join(', ') : '-'}</p>
                  <details class="section-sub">
                    <summary>Raw JSON</summary>
                    <pre>{JSON.stringify(data.semantic.attributes, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <p>Not analyzed yet.</p>
              )}
            </div>
          </details>

          <details class="section" open>
            <summary>親 ({parentCards.length})</summary>
            <div class="section-body">
              <FamilyStrip items={parentCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>子 ({childCards.length})</summary>
            <div class="section-body">
              <FamilyStrip items={childCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>兄弟 ({siblingCards.length})</summary>
            <div class="section-body">
              <FamilyStrip items={siblingCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>同じ Request の Generation ({requestGenerationCards.length})</summary>
            <div class="section-body">
              <FamilyStrip items={requestGenerationCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>Workflow</summary>
            <div class="section-body">
              <div class="workflow">
                {(() => {
                  const facts = data.comfy_job?.render_facts ?? null;
                  const graph = data.comfy_job?.graph ?? null;
                  const requestPrompt = data.request?.prompt ?? null;
                  const requestNegative = data.request?.negative_prompt ?? null;

                  if (!facts) {
                    return (
                      <>
                        <p>(no graph)</p>
                        {renderPromptField('positive', requestPrompt, null, 'positive')}
                        {renderPromptField('negative', requestNegative, null, 'negative')}
                        <table class="kv-table">
                          <tr>
                            <td>seed</td>
                            <td>{data.comfy_job?.seed ?? '-'}</td>
                          </tr>
                        </table>
                      </>
                    );
                  }

                  const modelsLine = (() => {
                    const parts: string[] = [];
                    if (facts.models.clip.length > 0) parts.push(`clip: ${facts.models.clip.join(', ')}`);
                    if (facts.models.vae) parts.push(`vae: ${facts.models.vae}`);
                    return parts.length > 0 ? parts.join(' · ') : null;
                  })();

                  const headerRows: { label: string; value: unknown }[] = [
                    {
                      label: 'Model',
                      value: (
                        <>
                          {facts.checkpoints.length > 0 ? facts.checkpoints.join('  +  ') : '-'}
                          {modelsLine ? <div class="workflow-line">{modelsLine}</div> : null}
                        </>
                      ),
                    },
                    ...facts.loras.map((l) => ({ label: 'LoRA', value: formatLoraLine(l) })),
                    ...facts.controlnets.map((cn) => ({ label: 'ControlNet', value: formatControlNetLine(cn) })),
                  ];

                  const pass1 = facts.samplers[0] ?? null;
                  const requestDiffers =
                    pass1 !== null && requestPrompt !== null && requestPrompt.trim() !== (pass1.prompt.positive ?? '').trim();

                  return (
                    <>
                      <table class="kv-table">
                        {headerRows.map((r) => (
                          <tr>
                            <td>{r.label}</td>
                            <td>{r.value}</td>
                          </tr>
                        ))}
                      </table>

                      {facts.samplers.map((s, i) => {
                        const continuesIdx = findContinuesPassIndex(facts.samplers, i);
                        const prev = i > 0 ? facts.samplers[i - 1]! : null;
                        return (
                          <div class="workflow-pass">
                            <div class="workflow-pass-head">
                              Pass {i + 1} · node {s.node_id}
                              {continuesIdx !== null ? ` · continues pass ${continuesIdx + 1}` : ''}
                            </div>
                            <p class="workflow-line">{formatLatentLine(s.latent)}</p>
                            <p class="workflow-line">{formatSamplerLine(s)}</p>
                            {renderPassPromptField('positive', s.prompt.positive, prev?.prompt.positive ?? null, i, 'positive')}
                            {renderPassPromptField('negative', s.prompt.negative, prev?.prompt.negative ?? null, i, 'negative')}
                          </div>
                        );
                      })}

                      <table class="kv-table">
                        <tr>
                          <td>Output</td>
                          <td>{facts.output.filename_prefix ?? '-'}</td>
                        </tr>
                      </table>

                      {requestDiffers ? (
                        <>
                          <p class="workflow-line">request prompt differs</p>
                          <details class="section-sub">
                            <summary>Request prompt</summary>
                            <div class="section-body">
                              {renderPromptField('positive', requestPrompt, pass1!.prompt.positive, 'positive')}
                            </div>
                          </details>
                        </>
                      ) : null}

                      <details class="section-sub">
                        <summary>Raw graph</summary>
                        <pre>{JSON.stringify(graph, null, 2)}</pre>
                      </details>
                    </>
                  );
                })()}
              </div>
            </div>
          </details>

          <details class="section" open>
            <summary>ComfyUI Job</summary>
            <div class="section-body">
              <table class="kv-table">
                <tr>
                  <td>prompt_id</td>
                  <td>{data.comfy_job?.comfy_prompt_id ?? '-'}</td>
                </tr>
                <tr>
                  <td>status</td>
                  <td>{data.comfy_job?.status ?? '-'}</td>
                </tr>
                <tr>
                  <td>original_filename</td>
                  <td>{data.original_filename ?? '-'}</td>
                </tr>
              </table>
            </div>
          </details>

          <details class="section" open>
            <summary>Git</summary>
            <div class="section-body">
              <table class="kv-table">
                <tr>
                  <td>commit</td>
                  <td>{data.request?.git_commit ?? '-'}</td>
                </tr>
                <tr>
                  <td>dirty</td>
                  <td>{data.request?.git_dirty ? 'yes' : 'no'}</td>
                </tr>
              </table>
            </div>
          </details>

          <NoteSection kind="generations" id={data.id} note={data.note} />
        </div>
      </div>
    </Layout>
  );
}
