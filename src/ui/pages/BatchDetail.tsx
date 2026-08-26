import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';

export interface BatchDetailData {
  id: string;
  short_id: string;
  raw_instruction: string | null;
  recipe: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  parameters: unknown;
  git_commit: string | null;
  git_dirty: boolean;
  note: string | null;
  bookmark: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  jobs: { id: string; comfy_prompt_id: string | null; seed: number | null; index: number | null; status: string }[];
  generations: GenerationCardData[];
  references: { id: string; source_generation_id: string; purpose: string | null; aspect: string | null; instruction: string | null; created_at: string }[];
  relations: {
    outgoing: { id: string; target_batch_id: string; type: string | null; actor: string; reason: string | null; created_at: string }[];
    incoming: { id: string; source_batch_id: string; type: string | null; actor: string; reason: string | null; created_at: string }[];
  };
  story_relations: { id: string; story_id: string; source_batch_id: string; target_batch_id: string; label: string | null }[];
  tags: string[];
  reference_children: { batch_id: string; source_generation_id: string; purpose: string | null; aspect: string | null }[];
  siblings: { batch_id: string; via: 'refinement' | 'reference'; shared_id: string }[];
}

/** Renders a reference link, preferring the resolved short_id over the raw UUID for both href and label. */
function refLink(prefix: '/b/' | '/g/', id: string, shortIds: Map<string, string>) {
  const shortId = shortIds.get(id);
  return { href: `${prefix}${shortId ?? id}`, label: shortId ?? id };
}

type RelBadgeKind = 'reference' | 'refinement' | 'story';

/** Small rounded label distinguishing which of the three Relation types (see CLAUDE.md invariants) a row comes from. */
function RelBadge({ kind }: { kind: RelBadgeKind }) {
  const label = kind === 'reference' ? 'Reference' : kind === 'refinement' ? 'Refinement' : 'Story';
  return <span class={`rel-badge rel-${kind}`}>{label}</span>;
}

export function BatchDetailPage({
  batch,
  storyNames,
  batchShortIds,
  generationShortIds,
}: {
  batch: BatchDetailData;
  storyNames: Record<string, string>;
  batchShortIds: Map<string, string>;
  generationShortIds: Map<string, string>;
}) {
  const storyIds = Array.from(new Set(batch.story_relations.map((r) => r.story_id)));
  const storyParents = batch.story_relations.filter((r) => r.target_batch_id === batch.id);
  const storyChildren = batch.story_relations.filter((r) => r.source_batch_id === batch.id);

  const parentCount = batch.references.length + batch.relations.incoming.length + storyParents.length;
  const childCount = batch.reference_children.length + batch.relations.outgoing.length + storyChildren.length;
  const siblingCount = batch.siblings.length;

  return (
    <Layout title={`Batch ${batch.short_id}`} fullBleed>
      <div class="detail-layout">
        <div class="detail-left">
          {batch.generations.length === 0 ? (
            <p class="empty-state">No generations in this batch yet.</p>
          ) : (
            <div class="grid">
              {batch.generations.map((g) => (
                <GenerationCard g={g} />
              ))}
            </div>
          )}
        </div>
        <div class="detail-right">
          <h1>Batch {batch.short_id}</h1>
          <div class="card-top-row">
            <button
              type="button"
              class="bookmark-btn"
              data-kind="batches"
              data-id={batch.id}
              data-bookmarked={batch.bookmark ? 'true' : 'false'}
            >
              🔖
            </button>
            <span>status: {batch.status}</span>
          </div>
          {batch.raw_instruction ? <p>&ldquo;{batch.raw_instruction}&rdquo;</p> : null}

          <p>
            親 {parentCount} · 子 {childCount} · 兄弟 {siblingCount}
            {storyIds.length > 0 ? (
              <>
                {' '}
                · Story:{' '}
                {storyIds.map((sid, i) => (
                  <>
                    {i > 0 ? ', ' : ''}
                    <a href={`/stories/${sid}`}>{storyNames[sid] ?? sid}</a>
                  </>
                ))}
              </>
            ) : null}
          </p>

          <datalist id="tag-suggestions"></datalist>

          <details class="section" open>
            <summary>Tags</summary>
            <div class="section-body">
              <div class="tag-chips">
                {batch.tags.map((t) => (
                  <span class="tag-chip">#{t}</span>
                ))}
              </div>
              <form class="tag-add-form" data-kind="batches" data-id={batch.id}>
                <input type="text" name="name" list="tag-suggestions" placeholder="add tag" />
                <button type="submit">+</button>
              </form>
            </div>
          </details>

          <details class="section" open>
            <summary>親 ({parentCount})</summary>
            <div class="section-body">
              {parentCount === 0 ? (
                <p>None.</p>
              ) : (
                <table class="kv-table">
                  {batch.references.map((r) => (
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
                  {batch.relations.incoming.map((r) => (
                    <tr>
                      <td>
                        <RelBadge kind="refinement" />
                      </td>
                      <td>
                        <a href={refLink('/b/', r.source_batch_id, batchShortIds).href}>
                          {refLink('/b/', r.source_batch_id, batchShortIds).label}
                        </a>
                      </td>
                      <td>reason: {r.reason ?? '-'}</td>
                    </tr>
                  ))}
                  {storyParents.map((r) => (
                    <tr>
                      <td>
                        <RelBadge kind="story" />
                      </td>
                      <td>
                        <a href={refLink('/b/', r.source_batch_id, batchShortIds).href}>
                          {refLink('/b/', r.source_batch_id, batchShortIds).label}
                        </a>
                      </td>
                      <td>
                        <a href={`/stories/${r.story_id}`}>{storyNames[r.story_id] ?? r.story_id}</a>
                        {r.label ? ` — ${r.label}` : ''}
                      </td>
                    </tr>
                  ))}
                </table>
              )}
            </div>
          </details>

          <details class="section" open>
            <summary>子 ({childCount})</summary>
            <div class="section-body">
              {childCount === 0 ? (
                <p>None.</p>
              ) : (
                <table class="kv-table">
                  {batch.reference_children.map((r) => (
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
                        via{' '}
                        <a href={refLink('/g/', r.source_generation_id, generationShortIds).href}>
                          {refLink('/g/', r.source_generation_id, generationShortIds).label}
                        </a>
                      </td>
                    </tr>
                  ))}
                  {batch.relations.outgoing.map((r) => (
                    <tr>
                      <td>
                        <RelBadge kind="refinement" />
                      </td>
                      <td>
                        <a href={refLink('/b/', r.target_batch_id, batchShortIds).href}>
                          {refLink('/b/', r.target_batch_id, batchShortIds).label}
                        </a>
                      </td>
                      <td>reason: {r.reason ?? '-'}</td>
                    </tr>
                  ))}
                  {storyChildren.map((r) => (
                    <tr>
                      <td>
                        <RelBadge kind="story" />
                      </td>
                      <td>
                        <a href={refLink('/b/', r.target_batch_id, batchShortIds).href}>
                          {refLink('/b/', r.target_batch_id, batchShortIds).label}
                        </a>
                      </td>
                      <td>
                        <a href={`/stories/${r.story_id}`}>{storyNames[r.story_id] ?? r.story_id}</a>
                        {r.label ? ` — ${r.label}` : ''}
                      </td>
                    </tr>
                  ))}
                </table>
              )}
            </div>
          </details>

          <details class="section" open>
            <summary>兄弟 ({siblingCount})</summary>
            <div class="section-body">
              {siblingCount === 0 ? (
                <p>None.</p>
              ) : (
                <table class="kv-table">
                  {batch.siblings.map((s) => (
                    <tr>
                      <td>
                        <RelBadge kind={s.via} />
                      </td>
                      <td>
                        <a href={refLink('/b/', s.batch_id, batchShortIds).href}>
                          {refLink('/b/', s.batch_id, batchShortIds).label}
                        </a>
                      </td>
                      <td>
                        shared parent:{' '}
                        {s.via === 'refinement' ? (
                          <a href={refLink('/b/', s.shared_id, batchShortIds).href}>
                            {refLink('/b/', s.shared_id, batchShortIds).label}
                          </a>
                        ) : (
                          <a href={refLink('/g/', s.shared_id, generationShortIds).href}>
                            {refLink('/g/', s.shared_id, generationShortIds).label}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </table>
              )}
            </div>
          </details>

          <details class="section" open>
            <summary>Prompt</summary>
            <div class="section-body">
              <table class="kv-table">
                <tr>
                  <td>prompt</td>
                  <td>{batch.prompt ?? '-'}</td>
                </tr>
                <tr>
                  <td>negative</td>
                  <td>{batch.negative_prompt ?? '-'}</td>
                </tr>
                <tr>
                  <td>recipe</td>
                  <td>{batch.recipe ?? '-'}</td>
                </tr>
              </table>
            </div>
          </details>

          <details class="section">
            <summary>Parameters</summary>
            <div class="section-body">
              <pre>{batch.parameters ? JSON.stringify(batch.parameters, null, 2) : '-'}</pre>
            </div>
          </details>

          <details class="section" open>
            <summary>ComfyUI Jobs ({batch.jobs.length})</summary>
            <div class="section-body">
              <table class="kv-table">
                {batch.jobs.map((j) => (
                  <tr>
                    <td>{j.comfy_prompt_id ?? j.id}</td>
                    <td>
                      seed: {j.seed ?? '-'} / status: {j.status}
                    </td>
                  </tr>
                ))}
              </table>
            </div>
          </details>

          <details class="section" open>
            <summary>Git</summary>
            <div class="section-body">
              <table class="kv-table">
                <tr>
                  <td>commit</td>
                  <td>{batch.git_commit ?? '-'}</td>
                </tr>
                <tr>
                  <td>dirty</td>
                  <td>{batch.git_dirty ? 'yes' : 'no'}</td>
                </tr>
              </table>
            </div>
          </details>

          <details class="section" open>
            <summary>Note</summary>
            <div class="section-body">
              <form class="note-form" data-kind="batches" data-id={batch.id}>
                <textarea name="note">{batch.note ?? ''}</textarea>
                <br />
                <button type="submit">Save</button>
                <span class="save-status"></span>
              </form>
            </div>
          </details>
        </div>
      </div>

      <div id="compare-bar" class="compare-bar hidden">
        <span id="compare-count">Compare (0)</span>
        <a id="compare-link" class="compare-go" href="#">
          Compare
        </a>
      </div>
    </Layout>
  );
}
