import { Layout } from '../layout';
import { formatBytes, type ImageMeta } from '../../lib/image-meta';
import { CopyIdButton } from '../components/CopyIdButton';
import { FamilyStrip, type FamilyCardData } from '../components/FamilyCard';
import { MiniMap, hasMiniMapContent, type MiniMapRow } from '../components/MiniMap';
import { summarizeRenderFacts, type RenderFacts } from '../../lib/render-facts';

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
    recipe: string | null;
    raw_instruction: string | null;
    git_commit: string | null;
    git_dirty: boolean;
  } | null;
  references: { id: string; target_batch_id: string; purpose: string | null; aspect: string | null; instruction: string | null; created_at: string }[];
  used_by: { id: string; batch_id: string; purpose: string | null; aspect: string | null; instruction: string | null; created_at: string }[];
  comfy_job: { id: string; seed: number | null; comfy_prompt_id: string | null; status: string; render_facts: RenderFacts | null } | null;
  original_filename: string | null;
}

const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Renders a reference link, preferring the resolved short_id over the raw UUID for both href and label. */
function refLink(prefix: '/b/' | '/g/', id: string, shortIds: Map<string, string>) {
  const shortId = shortIds.get(id);
  return { href: `${prefix}${shortId ?? id}`, label: shortId ?? id };
}

/** Builds the Render facts kv-table rows, skipping any column with no value; null means "(no graph)". */
function buildRenderFactsRows(facts: RenderFacts | null): { label: string; value: string }[] | null {
  if (!facts) return null;
  const summary = summarizeRenderFacts(facts);
  const rows: { label: string; value: string }[] = [];
  if (summary.checkpoint) rows.push({ label: 'checkpoint', value: summary.checkpoint });
  for (const s of facts.samplers) {
    rows.push({
      label: `sampler #${s.node_id}`,
      value: `${s.sampler_name ?? '?'}/${s.scheduler ?? '?'} · steps ${s.steps ?? '?'} · cfg ${s.cfg ?? '?'} · denoise ${s.denoise ?? '?'}`,
    });
  }
  if (summary.canvas) rows.push({ label: 'canvas', value: summary.canvas });
  if (summary.lora) rows.push({ label: 'lora', value: summary.lora });
  if (summary.controlnet) rows.push({ label: 'controlnet', value: summary.controlnet });
  return rows;
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
            <summary>Prompt</summary>
            <div class="section-body">
              <table class="kv-table">
                <tr>
                  <td>prompt</td>
                  <td>{data.batch?.prompt ?? '-'}</td>
                </tr>
              </table>
            </div>
          </details>

          <details class="section" open>
            <summary>Seed</summary>
            <div class="section-body">{data.comfy_job?.seed ?? '-'}</div>
          </details>

          <details class="section" open>
            <summary>Render facts</summary>
            <div class="section-body">
              {(() => {
                const rows = buildRenderFactsRows(data.comfy_job?.render_facts ?? null);
                if (!rows) return <p>(no graph)</p>;
                return (
                  <table class="kv-table">
                    {rows.map((r) => (
                      <tr>
                        <td>{r.label}</td>
                        <td>{r.value}</td>
                      </tr>
                    ))}
                  </table>
                );
              })()}
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
