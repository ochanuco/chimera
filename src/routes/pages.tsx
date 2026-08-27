import { Hono } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import { getBatchByIdOrShortId, getGenerationByIdOrShortId, resolveBatchShortIds, resolveGenerationShortIds } from '../lib/db';
import { listTagsForTarget } from '../lib/tags';
import { generationImageUrl } from '../lib/serialize';
import { listBookmarkedExperiments, listBookmarkedStories } from '../lib/ui-queries';
import { GalleryPage, type GalleryFilters, type GalleryItem } from '../ui/pages/Gallery';
import { BatchesPage } from '../ui/pages/Batches';
import { BatchDetailPage, type BatchDetailData } from '../ui/pages/BatchDetail';
import { StoriesPage, type StoryListItem } from '../ui/pages/Stories';
import { StoryDetailPage, type StoryDetailData } from '../ui/pages/StoryDetail';
import { BookmarksPage } from '../ui/pages/Bookmarks';
import { GraphPage, type GraphNodeData, type GraphEdgeData, type GraphStoryOption, type GraphScope } from '../ui/pages/Graph';
import { ComparePage, type CompareItem, type CompareSemantic } from '../ui/pages/Compare';
import { NotFoundPage } from '../ui/pages/NotFound';
import type { AppEnv, GenerationRow } from '../types';
import type { GenerationCardData } from '../ui/components/GenerationCard';
import type { BatchRowData } from '../ui/components/BatchRow';

export const pages = new Hono<AppEnv>();

pages.get('/', (c) => c.redirect('/gallery'));

pages.get('/gallery', async (c) => {
  const q = c.req.query();
  const limit = q.limit ? Math.min(Math.max(Number(q.limit) || 24, 1), 200) : 24;
  const offset = q.offset ? Math.max(Number(q.offset) || 0, 0) : 0;

  const filters: GalleryFilters = {
    character: q.character || undefined,
    tag: q.tag || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    rating: q.rating || undefined,
    bookmark: q.bookmark === 'true' ? 'true' : undefined,
    comfy_prompt_id: q.comfy_prompt_id || undefined,
    original_filename: q.original_filename || undefined,
    limit,
    offset,
  };

  const apiParams = new URLSearchParams();
  if (filters.character) apiParams.set('character', filters.character);
  if (filters.tag) apiParams.set('tag', filters.tag);
  if (filters.from) apiParams.set('from', filters.from);
  if (filters.to) apiParams.set('to', filters.to);
  if (filters.rating) apiParams.set('rating', filters.rating);
  if (filters.bookmark) apiParams.set('bookmark', filters.bookmark);
  if (filters.comfy_prompt_id) apiParams.set('comfy_prompt_id', filters.comfy_prompt_id);
  if (filters.original_filename) apiParams.set('original_filename', filters.original_filename);
  apiParams.set('limit', String(limit));
  apiParams.set('offset', String(offset));

  const [genRes, charRes] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations?${apiParams.toString()}`),
    internalApiRequest(c, '/api/v1/characters'),
  ]);
  const genData = (await genRes.json()) as { items: GalleryItem[]; total: number };
  const charData = (await charRes.json()) as { items: { id: string; name: string }[] };

  return c.html(
    <GalleryPage characters={charData.items} items={genData.items} total={genData.total} filters={filters} />,
  );
});

pages.get('/batches', async (c) => {
  const bookmarkOnly = c.req.query('bookmark') === 'true';
  const params = new URLSearchParams();
  if (bookmarkOnly) params.set('bookmark', 'true');
  params.set('limit', '100');

  const res = await internalApiRequest(c, `/api/v1/batches?${params.toString()}`);
  const data = (await res.json()) as { items: BatchRowData[] };

  return c.html(<BatchesPage items={data.items} bookmarkOnly={bookmarkOnly} />);
});

pages.get('/b/:shortId', async (c) => {
  const shortId = c.req.param('shortId');
  const res = await internalApiRequest(c, `/api/v1/batches/${shortId}`);
  if (res.status === 404) {
    return c.html(<NotFoundPage what="Batch" />, 404);
  }
  const data = (await res.json()) as BatchDetailData;

  const referencedBatchIds = [
    ...data.relations.outgoing.map((r) => r.target_batch_id),
    ...data.relations.incoming.map((r) => r.source_batch_id),
    ...data.story_relations.map((r) => r.source_batch_id),
    ...data.story_relations.map((r) => r.target_batch_id),
    ...data.reference_children.map((r) => r.batch_id),
    ...data.siblings.map((s) => s.batch_id),
    ...data.siblings.filter((s) => s.via === 'refinement').map((s) => s.shared_id),
  ];
  const referencedGenerationIds = [
    ...data.references.map((r) => r.source_generation_id),
    ...data.reference_children.map((r) => r.source_generation_id),
    ...data.siblings.filter((s) => s.via === 'reference').map((s) => s.shared_id),
  ];

  const [storyNames, generationTags, batchShortIds, generationShortIds] = await Promise.all([
    (async () => {
      const storyIds = Array.from(new Set(data.story_relations.map((r) => r.story_id)));
      const names: Record<string, string> = {};
      await Promise.all(
        storyIds.map(async (sid) => {
          const sRes = await internalApiRequest(c, `/api/v1/stories/${sid}`);
          if (sRes.ok) {
            const sData = (await sRes.json()) as { name: string };
            names[sid] = sData.name;
          }
        }),
      );
      return names;
    })(),
    Promise.all(data.generations.map((g) => listTagsForTarget(c.env.DB, 'generation_tags', g.id))),
    resolveBatchShortIds(c.env.DB, referencedBatchIds),
    resolveGenerationShortIds(c.env.DB, referencedGenerationIds),
  ]);

  const generationsWithTags = data.generations.map((g, i) => ({
    ...g,
    tags: (generationTags[i] ?? []).map((t) => t.name),
  }));

  return c.html(
    <BatchDetailPage
      batch={{ ...data, generations: generationsWithTags }}
      storyNames={storyNames}
      batchShortIds={batchShortIds}
      generationShortIds={generationShortIds}
    />,
  );
});

pages.get('/stories', async (c) => {
  const res = await internalApiRequest(c, '/api/v1/stories');
  const data = (await res.json()) as { items: StoryListItem[] };
  return c.html(<StoriesPage items={data.items} />);
});

pages.get('/stories/:id', async (c) => {
  const id = c.req.param('id');
  const res = await internalApiRequest(c, `/api/v1/stories/${id}`);
  if (res.status === 404) {
    return c.html(<NotFoundPage what="Story" />, 404);
  }
  const data = (await res.json()) as StoryDetailData;
  return c.html(<StoryDetailPage story={data} />);
});

pages.get('/bookmarks', async (c) => {
  const [genRes, batchRes, bookmarkedStories, bookmarkedExperiments] = await Promise.all([
    internalApiRequest(c, '/api/v1/generations?bookmark=true&limit=100'),
    internalApiRequest(c, '/api/v1/batches?bookmark=true&limit=100'),
    listBookmarkedStories(c.env.DB),
    listBookmarkedExperiments(c.env.DB),
  ]);
  const genData = (await genRes.json()) as { items: GenerationCardData[] };
  const batchData = (await batchRes.json()) as { items: BatchRowData[] };

  return c.html(
    <BookmarksPage
      generations={genData.items}
      batches={batchData.items}
      stories={bookmarkedStories}
      experiments={bookmarkedExperiments}
    />,
  );
});

/** BFS over an adjacency map, returning every id reachable from start (start included). */
function reachableIds(start: string, adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function addEdge(adjacency: Map<string, Set<string>>, from: string, to: string): void {
  let set = adjacency.get(from);
  if (!set) {
    set = new Set();
    adjacency.set(from, set);
  }
  set.add(to);
}

/** Ancestors + descendants of rootId, following all edge types as directed source -> target, plus rootId itself. */
function subgraphIds(edges: GraphEdgeData[], rootId: string): Set<string> {
  const forward = new Map<string, Set<string>>();
  const backward = new Map<string, Set<string>>();
  for (const e of edges) {
    addEdge(forward, e.source_batch_id, e.target_batch_id);
    addEdge(backward, e.target_batch_id, e.source_batch_id);
  }
  const descendants = reachableIds(rootId, forward);
  const ancestors = reachableIds(rootId, backward);
  return new Set([...descendants, ...ancestors]);
}

/** Connected component (edges treated as undirected) containing the most recently created Batch. */
function activeComponentIds(nodes: GraphNodeData[], edges: GraphEdgeData[]): Set<string> {
  if (nodes.length === 0) return new Set();
  // nodes arrive sorted by created_at ASC, id ASC (see /api/v1/graph), so the last entry is the newest.
  const latest = nodes[nodes.length - 1]!;
  const undirected = new Map<string, Set<string>>();
  for (const e of edges) {
    addEdge(undirected, e.source_batch_id, e.target_batch_id);
    addEdge(undirected, e.target_batch_id, e.source_batch_id);
  }
  return reachableIds(latest.id, undirected);
}

/** Ids within `maxDepth` undirected hops of rootId, rootId itself included at depth 0. */
function depthLimitedIds(edges: GraphEdgeData[], rootId: string, maxDepth: number): Set<string> {
  const undirected = new Map<string, Set<string>>();
  for (const e of edges) {
    addEdge(undirected, e.source_batch_id, e.target_batch_id);
    addEdge(undirected, e.target_batch_id, e.source_batch_id);
  }
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of undirected.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

/** Clamps a `?depth=` query value to 1..10, falling back to 3 when it's missing or unparseable. */
function clampDepth(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10) return 3;
  return n;
}

function filterGraph(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  ids: Set<string>,
): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  return {
    nodes: nodes.filter((n) => ids.has(n.id)),
    edges: edges.filter((e) => ids.has(e.source_batch_id) && ids.has(e.target_batch_id)),
  };
}

/** Annotates each node with how many of its direct (undirected) neighbors, across the whole graph, are missing from the current scope. */
function withHiddenNeighborCounts(
  nodes: GraphNodeData[],
  allEdges: GraphEdgeData[],
  visibleIds: Set<string>,
): GraphNodeData[] {
  const undirected = new Map<string, Set<string>>();
  for (const e of allEdges) {
    addEdge(undirected, e.source_batch_id, e.target_batch_id);
    addEdge(undirected, e.target_batch_id, e.source_batch_id);
  }
  return nodes.map((n) => {
    const neighbors = undirected.get(n.id) ?? new Set<string>();
    let hidden = 0;
    for (const neighborId of neighbors) {
      if (!visibleIds.has(neighborId)) hidden += 1;
    }
    return { ...n, hidden_neighbor_count: hidden };
  });
}

pages.get('/graph', async (c) => {
  const q = c.req.query();
  const [graphRes, storiesRes] = await Promise.all([
    internalApiRequest(c, '/api/v1/graph'),
    internalApiRequest(c, '/api/v1/stories'),
  ]);
  const data = (await graphRes.json()) as { nodes: GraphNodeData[]; edges: GraphEdgeData[] };
  const storiesData = (await storiesRes.json()) as { items: GraphStoryOption[] };

  let filtered: { nodes: GraphNodeData[]; edges: GraphEdgeData[] };
  let scope: GraphScope;
  let emptyMessage: string | undefined;
  const hasDepthParam = q.depth !== undefined;

  if (q.all === '1') {
    filtered = { nodes: data.nodes, edges: data.edges };
    scope = { value: 'all', label: 'All' };
  } else if (q.story) {
    const story = storiesData.items.find((s) => s.id === q.story);
    const ids = new Set<string>();
    for (const e of data.edges) {
      if (e.type === 'story' && e.story_id === q.story) {
        ids.add(e.source_batch_id);
        ids.add(e.target_batch_id);
      }
    }
    filtered = filterGraph(data.nodes, data.edges, ids);
    scope = { value: `story:${q.story}`, label: story ? story.name : 'Story' };
  } else if (q.root) {
    const batch = await getBatchByIdOrShortId(c.env.DB, q.root);
    if (!batch) {
      filtered = { nodes: [], edges: [] };
      scope = { value: `root:${q.root}`, label: `Subgraph: ${q.root}` };
      emptyMessage = `Batch not found: ${q.root}`;
    } else {
      const ids = hasDepthParam
        ? depthLimitedIds(data.edges, batch.id, clampDepth(q.depth))
        : subgraphIds(data.edges, batch.id);
      filtered = filterGraph(data.nodes, data.edges, ids);
      scope = { value: `root:${batch.short_id}`, label: `Subgraph: ${batch.short_id}` };
    }
  } else if (q.active === '1') {
    filtered = filterGraph(data.nodes, data.edges, activeComponentIds(data.nodes, data.edges));
    scope = { value: 'active', label: 'Active tree' };
  } else if (data.nodes.length === 0) {
    filtered = { nodes: [], edges: [] };
    scope = { value: '', label: 'Recent' };
  } else {
    const latest = data.nodes[data.nodes.length - 1]!;
    const depth = hasDepthParam ? clampDepth(q.depth) : 3;
    filtered = filterGraph(data.nodes, data.edges, depthLimitedIds(data.edges, latest.id, depth));
    scope = { value: '', label: 'Recent' };
  }

  const visibleIds = new Set(filtered.nodes.map((n) => n.id));
  const nodesWithHidden = withHiddenNeighborCounts(filtered.nodes, data.edges, visibleIds);

  return c.html(
    <GraphPage
      nodes={nodesWithHidden}
      edges={filtered.edges}
      stories={storiesData.items}
      scope={scope}
      emptyMessage={emptyMessage}
    />,
  );
});

/** Parses a Generation's semantic_json into CompareSemantic; NULL or unparseable JSON is treated as "not analyzed". */
function parseCompareSemantic(row: GenerationRow): CompareSemantic | null {
  if (!row.semantic_json) return null;
  try {
    const parsed = JSON.parse(row.semantic_json) as {
      core?: Partial<CompareSemantic['core']>;
      strengths?: string[];
      defects?: string[];
      attributes?: Record<string, unknown>;
    };
    return {
      summary: row.summary,
      core: {
        pose: parsed.core?.pose ?? null,
        expression: parsed.core?.expression ?? null,
        outfit: parsed.core?.outfit ?? null,
        style: parsed.core?.style ?? null,
        composition: parsed.core?.composition ?? null,
      },
      strengths: parsed.strengths ?? [],
      defects: parsed.defects ?? [],
      attributes: parsed.attributes ?? {},
    };
  } catch {
    return null;
  }
}

pages.get('/compare', async (c) => {
  const idsParam = c.req.query('ids') ?? '';
  const requestedIds = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let warning: string | undefined;
  let idsToUse = requestedIds;
  if (idsToUse.length > 9) {
    idsToUse = idsToUse.slice(0, 9);
    warning = 'Only the first 9 selected generations are shown.';
  } else if (requestedIds.length === 1) {
    warning = 'Select at least 2 generations to compare.';
  }

  const missingIds: string[] = [];
  const origin = new URL(c.req.url).origin;

  const rows: { row: GenerationRow; characterName: string | null }[] = [];
  for (const id of idsToUse) {
    const row = await getGenerationByIdOrShortId(c.env.DB, id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    const character = row.character_id
      ? await c.env.DB.prepare('SELECT name FROM characters WHERE id = ?').bind(row.character_id).first<{ name: string }>()
      : null;
    rows.push({ row, characterName: character?.name ?? null });
  }

  const batchShortIds = await resolveBatchShortIds(
    c.env.DB,
    rows.map(({ row }) => row.batch_id),
  );

  const items: CompareItem[] = rows.map(({ row, characterName }) => ({
    short_id: row.short_id,
    image_url: generationImageUrl(origin, row.short_id),
    rating: row.rating,
    character_name: characterName,
    batch_short_id: batchShortIds.get(row.batch_id) ?? null,
    seed: row.seed,
    created_at: row.created_at,
    semantic: parseCompareSemantic(row),
  }));

  return c.html(<ComparePage items={items} missingIds={missingIds} warning={warning} />);
});
