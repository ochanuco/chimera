import { Layout } from '../layout';
import { formatBytes, type ImageMeta } from '../../lib/image-meta';

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
  comfy_job: { id: string; seed: number | null; comfy_prompt_id: string | null; status: string } | null;
  original_filename: string | null;
}

const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Renders a reference link, preferring the resolved short_id over the raw UUID for both href and label. */
function refLink(prefix: '/b/' | '/g/', id: string, shortIds: Map<string, string>) {
  const shortId = shortIds.get(id);
  return { href: `${prefix}${shortId ?? id}`, label: shortId ?? id };
}

/** Small rounded label distinguishing which of the three Relation types (see CLAUDE.md invariants) a row comes from. */
function RelBadge({ kind }: { kind: 'reference' | 'refinement' | 'story' }) {
  const label = kind === 'reference' ? 'Reference' : kind === 'refinement' ? 'Refinement' : 'Story';
  return <span class={`rel-badge rel-${kind}`}>{label}</span>;
}

export function GenerationDetailPage({
  data,
  tags,
  storyLinks,
  batchShortIds,
  generationShortIds,
  parentReferences,
  imageMeta,
}: {
  data: GenerationDetailData;
  tags: { id: string; name: string }[];
  storyLinks: { story_id: string; story_name: string; label: string | null }[];
  batchShortIds: Map<string, string>;
  generationShortIds: Map<string, string>;
  /** The owning Batch's own reference material (its "parents"), fetched from that Batch's detail. */
  parentReferences: { source_generation_id: string; purpose: string | null; aspect: string | null }[];
  imageMeta: ImageMeta | null;
}) {
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
          <h1>{data.short_id}</h1>
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

          <details class="section" open>
            <summary>親 ({parentReferences.length})</summary>
            <div class="section-body">
              {parentReferences.length === 0 ? (
                <p>None.</p>
              ) : (
                <table class="kv-table">
                  {parentReferences.map((r) => (
                    <tr>
                      <td>
                        <RelBadge kind="reference" />
                      </td>
                      <td>
                        <a href={refLink('/g/', r.source_generation_id, generationShortIds).href}>
                          {refLink('/g/', r.source_generation_id, generationShortIds).label}
                        </a>
                      </td>
                      <td>
                        purpose: {r.purpose ?? '-'} / aspect: {r.aspect ?? '-'}
                      </td>
                    </tr>
                  ))}
                </table>
              )}
            </div>
          </details>

          <details class="section" open>
            <summary>子 ({data.used_by.length})</summary>
            <div class="section-body">
              {data.used_by.length === 0 ? (
                <p>None.</p>
              ) : (
                <table class="kv-table">
                  {data.used_by.map((r) => (
                    <tr>
                      <td>
                        <RelBadge kind="reference" />
                      </td>
                      <td>
                        <a href={refLink('/b/', r.batch_id, batchShortIds).href}>
                          {refLink('/b/', r.batch_id, batchShortIds).label}
                        </a>
                      </td>
                      <td>
                        purpose: {r.purpose ?? '-'} / aspect: {r.aspect ?? '-'}
                      </td>
                    </tr>
                  ))}
                </table>
              )}
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
