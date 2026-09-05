import { Layout } from '../layout';
import { formatBytes, type ImageMeta } from '../../lib/image-meta';
import { CopyIdButton } from '../components/CopyIdButton';
import { FamilyStrip, type FamilyCardData } from '../components/FamilyCard';
import { MiniMap, hasMiniMapContent, type MiniMapRow } from '../components/MiniMap';
import { PromptChips } from '../components/PromptChips';
import type { RenderFacts, RenderLatentSource, RenderSampler } from '../../lib/render-facts';

export interface GenerationDetailData {
  id: string;
  short_id: string;
  canonical_url: string;
  image: { url: string };
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
  batch: {
    id: string;
    short_id: string;
    prompt: string | null;
    negative_prompt: string | null;
    recipe: string | null;
    raw_instruction: string | null;
    git_commit: string | null;
    git_dirty: boolean;
  } | null;
  references: { id: string; target_batch_id: string; purpose: string | null; aspect: string | null; instruction: string | null; created_at: string }[];
  used_by: { id: string; batch_id: string; purpose: string | null; aspect: string | null; instruction: string | null; created_at: string }[];
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

const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Latest finalize requests targeting this Generation (GET /api/v1/requests?kind=finalize&generation_id=). */
export interface FinalizeRequestSummary {
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at: string;
  error: string | null;
  /** done の場合の納品 Generation の short_id（resolveGenerationShortIds で解決済み）。 */
  resultShortId: string | null;
}

/** Renders a reference link, preferring the resolved short_id over the raw UUID for both href and label. */
function refLink(prefix: '/b/' | '/g/', id: string, shortIds: Map<string, string>) {
  const shortId = shortIds.get(id);
  return { href: `${prefix}${shortId ?? id}`, label: shortId ?? id };
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
  data,
  tags,
  storyLinks,
  miniMapRows,
  batchShortIds,
  generationShortIds,
  batchThumbnails,
  parentReferences,
  relationsIncoming,
  relationsOutgoing,
  imageMeta,
  finalizeRequests,
}: {
  data: GenerationDetailData;
  tags: { id: string; name: string }[];
  /** Story neighbors of the owning Batch (both directions; filtered by data.batch.id below). */
  storyLinks: { story_id: string; story_name: string; label: string | null; source_batch_id: string; target_batch_id: string }[];
  /** 系譜ミニマップ: 所属Batchの再試行連結成分 + 所属Batchが属する各Storyの全Batch。 */
  miniMapRows: MiniMapRow[];
  batchShortIds: Map<string, string>;
  generationShortIds: Map<string, string>;
  /** Batch id -> representative Generation short_id, for family-card thumbnails of Batch-level relations. */
  batchThumbnails: Map<string, string>;
  /** The owning Batch's own reference material (its "parents"), fetched from that Batch's detail. */
  parentReferences: { source_generation_id: string; purpose: string | null; aspect: string | null }[];
  /** Retry relations of the owning Batch (source_batch_id = the Batch that was refined into this one). */
  relationsIncoming: { source_batch_id: string; reason: string | null }[];
  /** Retry relations of the owning Batch (target_batch_id = the Batch this one was refined into). */
  relationsOutgoing: { target_batch_id: string; reason: string | null }[];
  imageMeta: ImageMeta | null;
  /** 最新の finalize request 一覧 (最大5件、新しい順)。段階2の GUI はここに積むだけで進捗はここで見る。 */
  finalizeRequests: FinalizeRequestSummary[];
}) {
  const ownBatchId = data.batch?.id;

  const parentCards: FamilyCardData[] = [
    ...parentReferences.map((r): FamilyCardData => {
      const link = refLink('/g/', r.source_generation_id, generationShortIds);
      return {
        kind: 'reference',
        href: link.href,
        shortId: link.label,
        imageUrl: `/g/${link.label}/image`,
        detail: `purpose: ${r.purpose ?? '-'} / aspect: ${r.aspect ?? '-'}`,
      };
    }),
    ...relationsIncoming.map((r): FamilyCardData => {
      const link = refLink('/b/', r.source_batch_id, batchShortIds);
      const genShortId = batchThumbnails.get(r.source_batch_id);
      return {
        kind: 'refinement',
        href: link.href,
        shortId: link.label,
        imageUrl: genShortId ? `/g/${genShortId}/image` : null,
        caption: 'via batch',
        detail: `reason: ${r.reason ?? '-'}`,
      };
    }),
    ...storyLinks
      .filter((s) => s.target_batch_id === ownBatchId)
      .map((s): FamilyCardData => {
        const link = refLink('/b/', s.source_batch_id, batchShortIds);
        const genShortId = batchThumbnails.get(s.source_batch_id);
        return {
          kind: 'story',
          href: link.href,
          shortId: link.label,
          imageUrl: genShortId ? `/g/${genShortId}/image` : null,
          caption: 'via batch',
          detail: `${s.story_name}${s.label ? ` — ${s.label}` : ''}`,
        };
      }),
  ];

  const childCards: FamilyCardData[] = [
    ...data.used_by.map((r): FamilyCardData => {
      const link = refLink('/b/', r.batch_id, batchShortIds);
      const genShortId = batchThumbnails.get(r.batch_id);
      return {
        kind: 'reference',
        href: link.href,
        shortId: link.label,
        imageUrl: genShortId ? `/g/${genShortId}/image` : null,
        detail: `purpose: ${r.purpose ?? '-'} / aspect: ${r.aspect ?? '-'}`,
      };
    }),
    ...relationsOutgoing.map((r): FamilyCardData => {
      const link = refLink('/b/', r.target_batch_id, batchShortIds);
      const genShortId = batchThumbnails.get(r.target_batch_id);
      return {
        kind: 'refinement',
        href: link.href,
        shortId: link.label,
        imageUrl: genShortId ? `/g/${genShortId}/image` : null,
        caption: 'via batch',
        detail: `reason: ${r.reason ?? '-'}`,
      };
    }),
    ...storyLinks
      .filter((s) => s.source_batch_id === ownBatchId)
      .map((s): FamilyCardData => {
        const link = refLink('/b/', s.target_batch_id, batchShortIds);
        const genShortId = batchThumbnails.get(s.target_batch_id);
        return {
          kind: 'story',
          href: link.href,
          shortId: link.label,
          imageUrl: genShortId ? `/g/${genShortId}/image` : null,
          caption: 'via batch',
          detail: `${s.story_name}${s.label ? ` — ${s.label}` : ''}`,
        };
      }),
  ];

  return (
    <Layout title={`Generation ${data.short_id}`} fullBleed>
      <div class="detail-layout">
        <div class="detail-left">
          <div class="gen-detail-hero">
            <img src={data.image.url} alt={data.short_id} />
          </div>
          {imageMeta ? (
            <p class="image-meta">
              {imageMeta.width !== null && imageMeta.height !== null
                ? `${imageMeta.width}×${imageMeta.height} · ${formatBytes(imageMeta.size)}`
                : formatBytes(imageMeta.size)}
            </p>
          ) : null}
        </div>
        <div class="detail-right">
          <h1>
            {data.short_id} <CopyIdButton value={data.short_id} />
            {data.batch ? (
              <>
                {' '}
                <a class="graph-jump" href={`/graph?root=${data.batch.short_id}&depth=3`}>
                  Graph
                </a>
              </>
            ) : null}
          </h1>
          {data.character ? <p>{data.character.name}</p> : null}
          <div class="card-top-row">
            <div class="rating-group" data-generation-id={data.id} data-current={data.rating ?? ''}>
              {RATINGS.map((r) => (
                <button type="button" class={`rate-btn${data.rating === r ? ' active' : ''}`} data-rating={r}>
                  {r}
                </button>
              ))}
            </div>
            <button
              type="button"
              class="bookmark-btn"
              data-kind="generations"
              data-id={data.id}
              data-bookmarked={data.bookmark ? 'true' : 'false'}
            >
              🔖
            </button>
          </div>

          <datalist id="tag-suggestions"></datalist>
          <div class="tag-chips">
            {tags.map((t) => (
              <span class="tag-chip">
                #{t.name}
                <button
                  type="button"
                  class="tag-remove-btn"
                  data-kind="generations"
                  data-id={data.id}
                  data-tag-id={t.id}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <form class="tag-add-form" data-kind="generations" data-id={data.id} data-removable="true">
            <input type="text" name="name" list="tag-suggestions" placeholder="add tag" />
            <button type="submit">+</button>
          </form>

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

          {hasMiniMapContent(miniMapRows) ? (
            <details class="section" open>
              <summary>Map</summary>
              <div class="section-body">
                <MiniMap rows={miniMapRows} />
              </div>
            </details>
          ) : null}

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
            <summary>Story</summary>
            <div class="section-body">
              {storyLinks.length === 0 ? (
                <p>Not part of a story.</p>
              ) : (
                <ul>
                  {storyLinks.map((s) => (
                    <li>
                      <a href={`/stories/${s.story_id}`}>{s.story_name}</a>
                      {s.label ? ` — ${s.label}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details class="section" open>
            <summary>Workflow</summary>
            <div class="section-body">
              <div class="workflow">
                {(() => {
                  const facts = data.comfy_job?.render_facts ?? null;
                  const graph = data.comfy_job?.graph ?? null;
                  const batchPrompt = data.batch?.prompt ?? null;
                  const batchNegative = data.batch?.negative_prompt ?? null;

                  if (!facts) {
                    return (
                      <>
                        <p>(no graph)</p>
                        {renderPromptField('positive', batchPrompt, null, 'positive')}
                        {renderPromptField('negative', batchNegative, null, 'negative')}
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
                    pass1 !== null && batchPrompt !== null && batchPrompt.trim() !== (pass1.prompt.positive ?? '').trim();

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
                              {renderPromptField('positive', batchPrompt, pass1!.prompt.positive, 'positive')}
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
            <summary>Finalize</summary>
            <div class="section-body">
              <form class="finalize-form" data-generation-short-id={data.short_id}>
                <label>
                  <input type="checkbox" name="repin" /> repin
                </label>
                <label>
                  <input type="checkbox" name="recolor" /> recolor
                </label>
                <label>
                  <input type="checkbox" name="keep_legwear" /> keep legwear
                </label>
                <label>
                  denoise <input type="number" name="denoise" step="0.01" min="0" max="1" placeholder="recipe default" />
                </label>
                <button type="submit">Finalize</button>
              </form>
              {finalizeRequests.length > 0 ? (
                <ul class="request-status-list">
                  {finalizeRequests.map((r) => (
                    <li class={`request-status-${r.status}`}>
                      {r.status} · {r.created_at}
                      {r.status === 'done' && r.resultShortId ? (
                        <>
                          {' '}
                          — <a href={`/g/${r.resultShortId}`}>{r.resultShortId}</a>
                        </>
                      ) : null}
                      {r.status === 'failed' && r.error ? <> — {r.error}</> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
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
                  <td>{data.batch?.git_commit ?? '-'}</td>
                </tr>
                <tr>
                  <td>dirty</td>
                  <td>{data.batch?.git_dirty ? 'yes' : 'no'}</td>
                </tr>
              </table>
            </div>
          </details>

          <details class="section" open>
            <summary>Note</summary>
            <div class="section-body">
              <form class="note-form" data-kind="generations" data-id={data.id}>
                <textarea name="note">{data.note ?? ''}</textarea>
                <br />
                <button type="submit">Save</button>
                <span class="save-status"></span>
              </form>
            </div>
          </details>
        </div>
      </div>
    </Layout>
  );
}
