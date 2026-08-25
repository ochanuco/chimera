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
}

export function BatchDetailPage({ batch, storyNames }: { batch: BatchDetailData; storyNames: Record<string, string> }) {
  const refinementIncoming = batch.relations.incoming.find((r) => r.type === 'refinement');
  const storyIds = Array.from(new Set(batch.story_relations.map((r) => r.story_id)));

  return (
    <Layout title={`Batch ${batch.short_id}`}>
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

      <datalist id="tag-suggestions"></datalist>

      {batch.generations.length === 0 ? (
        <p class="empty-state">No generations in this batch yet.</p>
      ) : (
        <div class="grid">
          {batch.generations.map((g) => (
            <GenerationCard g={g} />
          ))}
        </div>
      )}

      <div id="compare-bar" class="compare-bar hidden">
        <span id="compare-count">Compare (0)</span>
        <a id="compare-link" class="compare-go" href="#">
          Compare
        </a>
      </div>

      <p>
        References: {batch.references.length}
        {refinementIncoming ? (
          <>
            {' '}
            · Refinement from: <a href={`/b/${refinementIncoming.source_batch_id}`}>{refinementIncoming.source_batch_id}</a>
          </>
        ) : null}
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

      <details class="section">
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

      <details class="section">
        <summary>References ({batch.references.length})</summary>
        <div class="section-body">
          {batch.references.length === 0 ? (
            <p>None.</p>
          ) : (
            <table class="kv-table">
              {batch.references.map((r) => (
                <tr>
                  <td>
                    <a href={`/g/${r.source_generation_id}`}>{r.source_generation_id}</a>
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

      <details class="section">
        <summary>
          Relations (outgoing {batch.relations.outgoing.length} / incoming {batch.relations.incoming.length})
        </summary>
        <div class="section-body">
          <p>Outgoing:</p>
          <table class="kv-table">
            {batch.relations.outgoing.map((r) => (
              <tr>
                <td>
                  <a href={`/b/${r.target_batch_id}`}>{r.target_batch_id}</a>
                </td>
                <td>
                  {r.type ?? '-'} / {r.actor} / {r.reason ?? '-'}
                </td>
              </tr>
            ))}
          </table>
          <p>Incoming:</p>
          <table class="kv-table">
            {batch.relations.incoming.map((r) => (
              <tr>
                <td>
                  <a href={`/b/${r.source_batch_id}`}>{r.source_batch_id}</a>
                </td>
                <td>
                  {r.type ?? '-'} / {r.actor} / {r.reason ?? '-'}
                </td>
              </tr>
            ))}
          </table>
        </div>
      </details>

      <details class="section">
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

      <details class="section">
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

      <details class="section">
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
    </Layout>
  );
}
