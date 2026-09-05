import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import { CopyIdButton } from '../components/CopyIdButton';
import { FamilyStrip, type FamilyCardData, type RelKind } from '../components/FamilyCard';
import { MiniMap, hasMiniMapContent, type MiniMapRow } from '../components/MiniMap';
import { PromptChips } from '../components/PromptChips';

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

/** GET /api/v1/requests?kind=finalize&batch_id= の集計。worker-protocol.md の GUI 節参照。 */
export interface FinalizeSummary {
  queued: number;
  running: number;
  done: number;
  failed: number;
}

/** Renders a reference link, preferring the resolved short_id over the raw UUID for both href and label. */
function refLink(prefix: '/b/' | '/g/', id: string, shortIds: Map<string, string>) {
  const shortId = shortIds.get(id);
  return { href: `${prefix}${shortId ?? id}`, label: shortId ?? id };
}

export function BatchDetailPage({
  batch,
  storyNames,
  miniMapRows,
  batchShortIds,
  generationShortIds,
  batchThumbnails,
  diffParent,
  finalizeSummary,
}: {
  batch: BatchDetailData;
  storyNames: Record<string, string>;
  /** 系譜ミニマップ: 自Batchの再試行連結成分 + 自Batchが属する各Storyの全Batch。 */
  miniMapRows: MiniMapRow[];
  batchShortIds: Map<string, string>;
  generationShortIds: Map<string, string>;
  /** Batch id -> representative Generation short_id, for family-card thumbnails. */
  batchThumbnails: Map<string, string>;
  /** retry 元(親)Batchのprompt。Prompt セクションのチップdiff基準。retry元がなければnull。 */
  diffParent?: { shortId: string; prompt: string | null; negative_prompt: string | null } | null;
  /** このBatch配下の全GenerationについてのfinalizeRequest状況の集計。 */
  finalizeSummary: FinalizeSummary;
}) {
  const storyIds = Array.from(new Set(batch.story_relations.map((r) => r.story_id)));
  const storyParents = batch.story_relations.filter((r) => r.target_batch_id === batch.id);
  const storyChildren = batch.story_relations.filter((r) => r.source_batch_id === batch.id);

  const batchThumb = (batchId: string): string | null => {
    const genShortId = batchThumbnails.get(batchId);
    return genShortId ? `/g/${genShortId}/image` : null;
  };

  const parentCards: FamilyCardData[] = [
    ...batch.references.map((r): FamilyCardData => {
      const link = refLink('/g/', r.source_generation_id, generationShortIds);
      return {
        kind: 'reference',
        href: link.href,
        shortId: link.label,
        imageUrl: `/g/${link.label}/image`,
        detail: `purpose: ${r.purpose ?? '-'} / aspect: ${r.aspect ?? '-'}`,
      };
    }),
    ...batch.relations.incoming.map((r): FamilyCardData => {
      const link = refLink('/b/', r.source_batch_id, batchShortIds);
      return {
        kind: 'refinement',
        href: link.href,
        shortId: link.label,
        imageUrl: batchThumb(r.source_batch_id),
        detail: `reason: ${r.reason ?? '-'}`,
      };
    }),
    ...storyParents.map((r): FamilyCardData => {
      const link = refLink('/b/', r.source_batch_id, batchShortIds);
      return {
        kind: 'story',
        href: link.href,
        shortId: link.label,
        imageUrl: batchThumb(r.source_batch_id),
        detail: `${storyNames[r.story_id] ?? r.story_id}${r.label ? ` — ${r.label}` : ''}`,
      };
    }),
  ];

  const childCards: FamilyCardData[] = [
    ...batch.reference_children.map((r): FamilyCardData => {
      const link = refLink('/b/', r.batch_id, batchShortIds);
      const viaLink = refLink('/g/', r.source_generation_id, generationShortIds);
      return {
        kind: 'reference',
        href: link.href,
        shortId: link.label,
        imageUrl: batchThumb(r.batch_id),
        detail: `via ${viaLink.label}`,
      };
    }),
    ...batch.relations.outgoing.map((r): FamilyCardData => {
      const link = refLink('/b/', r.target_batch_id, batchShortIds);
      return {
        kind: 'refinement',
        href: link.href,
        shortId: link.label,
        imageUrl: batchThumb(r.target_batch_id),
        detail: `reason: ${r.reason ?? '-'}`,
      };
    }),
    ...storyChildren.map((r): FamilyCardData => {
      const link = refLink('/b/', r.target_batch_id, batchShortIds);
      return {
        kind: 'story',
        href: link.href,
        shortId: link.label,
        imageUrl: batchThumb(r.target_batch_id),
        detail: `${storyNames[r.story_id] ?? r.story_id}${r.label ? ` — ${r.label}` : ''}`,
      };
    }),
  ];

  const siblingCards: FamilyCardData[] = batch.siblings.map((s): FamilyCardData => {
    const link = refLink('/b/', s.batch_id, batchShortIds);
    const sharedLink =
      s.via === 'refinement' ? refLink('/b/', s.shared_id, batchShortIds) : refLink('/g/', s.shared_id, generationShortIds);
    return {
      kind: s.via as RelKind,
      href: link.href,
      shortId: link.label,
      imageUrl: batchThumb(s.batch_id),
      detail: `shared parent: ${sharedLink.label}`,
    };
  });

  const parentCount = parentCards.length;
  const childCount = childCards.length;
  const siblingCount = siblingCards.length;

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
          <h1>
            Batch {batch.short_id} <CopyIdButton value={batch.short_id} />{' '}
            <a class="graph-jump" href={`/graph?root=${batch.short_id}&depth=3`}>
              Graph
            </a>
          </h1>
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

          {hasMiniMapContent(miniMapRows) ? (
            <details class="section" open>
              <summary>Map</summary>
              <div class="section-body">
                <MiniMap rows={miniMapRows} />
              </div>
            </details>
          ) : null}

          <details class="section" open>
            <summary>親 ({parentCount})</summary>
            <div class="section-body">
              <FamilyStrip items={parentCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>子 ({childCount})</summary>
            <div class="section-body">
              <FamilyStrip items={childCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>兄弟 ({siblingCount})</summary>
            <div class="section-body">
              <FamilyStrip items={siblingCards} />
            </div>
          </details>

          <details class="section" open>
            <summary>Prompt</summary>
            <div class="section-body">
              {diffParent ? (
                <p class="prompt-diff-base">
                  diff base: <a href={`/b/${diffParent.shortId}`}>{diffParent.shortId}</a>
                </p>
              ) : null}
              <div class="prompt-field">
                <div class="prompt-field-label">prompt {batch.prompt ? <CopyIdButton value={batch.prompt} /> : null}</div>
                <PromptChips text={batch.prompt} parentText={diffParent?.prompt} variant="positive" />
              </div>
              <div class="prompt-field">
                <div class="prompt-field-label">
                  negative {batch.negative_prompt ? <CopyIdButton value={batch.negative_prompt} /> : null}
                </div>
                <PromptChips text={batch.negative_prompt} parentText={diffParent?.negative_prompt} variant="negative" />
              </div>
              <table class="kv-table">
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
                    <td>
                      {j.comfy_prompt_id ?? j.id} <CopyIdButton value={j.comfy_prompt_id ?? j.id} />
                    </td>
                    <td>
                      seed: {j.seed ?? '-'} / status: {j.status}
                    </td>
                  </tr>
                ))}
              </table>
            </div>
          </details>

          <details class="section" open>
            <summary>Finalize all arms</summary>
            <div class="section-body">
              <form
                class="finalize-all-form"
                data-generation-short-ids={batch.generations.map((g) => g.short_id).join(',')}
              >
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
                <button type="submit">Finalize all arms</button>
              </form>
              <p class="finalize-summary">
                finalize: {finalizeSummary.queued} queued · {finalizeSummary.running} running · {finalizeSummary.done} done ·{' '}
                {finalizeSummary.failed} failed
              </p>
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
