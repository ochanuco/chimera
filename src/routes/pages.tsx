import { Hono } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import { getGenerationByIdOrShortId, resolveBatchShortIds, resolveGenerationShortIds } from '../lib/db';
import { listTagsForTarget } from '../lib/tags';
import { generationImageUrl } from '../lib/serialize';
import { listBookmarkedExperiments, listBookmarkedStories } from '../lib/ui-queries';
import { GalleryPage, type GalleryFilters, type GalleryItem } from '../ui/pages/Gallery';
import { BatchesPage } from '../ui/pages/Batches';
import { BatchDetailPage, type BatchDetailData } from '../ui/pages/BatchDetail';
import { StoriesPage, type StoryListItem } from '../ui/pages/Stories';
import { StoryDetailPage, type StoryDetailData } from '../ui/pages/StoryDetail';
import { BookmarksPage } from '../ui/pages/Bookmarks';
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
  ];
  const referencedGenerationIds = data.references.map((r) => r.source_generation_id);

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

  const items: CompareItem[] = [];
  const missingIds: string[] = [];
  const origin = new URL(c.req.url).origin;

  for (const id of idsToUse) {
    const row = await getGenerationByIdOrShortId(c.env.DB, id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    const character = row.character_id
      ? await c.env.DB.prepare('SELECT name FROM characters WHERE id = ?').bind(row.character_id).first<{ name: string }>()
      : null;

    items.push({
      short_id: row.short_id,
      image_url: generationImageUrl(origin, row.short_id),
      rating: row.rating,
      character_name: character?.name ?? null,
      semantic: parseCompareSemantic(row),
    });
  }

  return c.html(<ComparePage items={items} missingIds={missingIds} warning={warning} />);
});
