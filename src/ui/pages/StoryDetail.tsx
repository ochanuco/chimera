import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';

export interface StoryRelationData {
  id: string;
  source_batch_id: string;
  target_batch_id: string;
  label: string | null;
  description: string | null;
}

export interface StoryBatchData {
  id: string;
  short_id: string;
  representative_generation: { thumbnail_url: string } | null;
}

export interface StoryDetailData {
  id: string;
  name: string;
  description: string | null;
  bookmark: boolean;
  relations: StoryRelationData[];
  batches: StoryBatchData[];
  tags: string[];
}

function renderNode(
  storyId: string,
  batchId: string,
  batchesById: Map<string, StoryBatchData>,
  outgoing: Map<string, StoryRelationData[]>,
  visited: Set<string>,
) {
  const batch = batchesById.get(batchId);
  const children = outgoing.get(batchId) ?? [];
  const alreadyVisited = visited.has(batchId);
  visited.add(batchId);

  return (
    <li>
      <div class="story-node">
        {batch?.representative_generation ? <img src={batch.representative_generation.thumbnail_url} alt="" /> : null}
        <a href={`/b/${batch ? batch.short_id : batchId}`}>{batch ? batch.short_id : batchId}</a>
        <CopyIdButton value={batch ? batch.short_id : batchId} />
      </div>
      {alreadyVisited || children.length === 0 ? null : (
        <ul>
          {children.map((rel) => (
            <li>
              <span class="rel-label-display" data-relation-id={rel.id}>
                {rel.label || '(no label)'}
              </span>{' '}
              <button type="button" class="rel-edit-toggle" data-target={`rel-form-${rel.id}`}>
                ✎
              </button>
              <form id={`rel-form-${rel.id}`} class="rel-edit-form hidden" data-story-id={storyId} data-relation-id={rel.id}>
                <input type="text" name="label" value={rel.label ?? ''} placeholder="label" />
                <textarea name="description">{rel.description ?? ''}</textarea>
                <button type="submit">Save</button>
              </form>
              <ul>{renderNode(storyId, rel.target_batch_id, batchesById, outgoing, visited)}</ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function StoryDetailPage({ story }: { story: StoryDetailData }) {
  const batchesById = new Map(story.batches.map((b) => [b.id, b] as const));
  const outgoing = new Map<string, StoryRelationData[]>();
  const hasIncoming = new Set<string>();
  for (const rel of story.relations) {
    const list = outgoing.get(rel.source_batch_id) ?? [];
    list.push(rel);
    outgoing.set(rel.source_batch_id, list);
    hasIncoming.add(rel.target_batch_id);
  }
  const roots = story.batches.filter((b) => !hasIncoming.has(b.id));
  const visited = new Set<string>();

  return (
    <Layout title={story.name}>
      <h1>{story.name}</h1>
      {story.description ? <p>{story.description}</p> : null}
      <button
        type="button"
        class="bookmark-btn"
        data-kind="stories"
        data-id={story.id}
        data-bookmarked={story.bookmark ? 'true' : 'false'}
      >
        🔖
      </button>

      {story.batches.length === 0 ? (
        <p class="empty-state">No batches in this story yet.</p>
      ) : (
        <div class="story-tree">
          <ul>{roots.map((r) => renderNode(story.id, r.id, batchesById, outgoing, visited))}</ul>
        </div>
      )}
    </Layout>
  );
}
