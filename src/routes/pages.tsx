import { Hono } from 'hono';
import { app } from '../app';
import { getGenerationByIdOrShortId } from '../lib/db';
import { listTagsForTarget } from '../lib/tags';
import { generationImageUrl } from '../lib/serialize';
import { listBookmarkedExperiments, listBookmarkedStories } from '../lib/ui-queries';
import { GalleryPage, type GalleryFilters, type GalleryItem } from '../ui/pages/Gallery';
import { BatchesPage } from '../ui/pages/Batches';
import { BatchDetailPage, type BatchDetailData } from '../ui/pages/BatchDetail';
import { StoriesPage, type StoryListItem } from '../ui/pages/Stories';
import { StoryDetailPage, type StoryDetailData } from '../ui/pages/StoryDetail';
import { BookmarksPage } from '../ui/pages/Bookmarks';
import { ComparePage, type CompareItem } from '../ui/pages/Compare';
import { NotFoundPage } from '../ui/pages/NotFound';
import type { AppEnv } from '../types';
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
  apiParams.set('limit', String(limit));
  apiParams.set('offset', String(offset));

  const [genRes, charRes] = await Promise.all([
    app.request(`/api/v1/generations?${apiParams.toString()}`, {}, c.env),
    app.request('/api/v1/characters', {}, c.env),
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

  const res = await app.request(`/api/v1/batches?${params.toString()}`, {}, c.env);
  const data = (await res.json()) as { items: BatchRowData[] };

  return c.html(<BatchesPage items={data.items} bookmarkOnly={bookmarkOnly} />);
});

pages.get('/b/:shortId', async (c) => {
  const shortId = c.req.param('shortId');
  const res = await app.request(`/api/v1/batches/${shortId}`, {}, c.env);
  if (res.status === 404) {
    return c.html(<NotFoundPage what="Batch" />, 404);
  }
  const data = (await res.json()) as BatchDetailData;

  const [storyNames, generationTags] = await Promise.all([
    (async () => {
      const storyIds = Array.from(new Set(data.story_relations.map((r) => r.story_id)));
      const names: Record<string, string> = {};
      await Promise.all(
        storyIds.map(async (sid) => {
          const sRes = await app.request(`/api/v1/stories/${sid}`, {}, c.env);
          if (sRes.ok) {
            const sData = (await sRes.json()) as { name: string };
            names[sid] = sData.name;
          }
        }),
      );
      return names;
    })(),
    Promise.all(data.generations.map((g) => listTagsForTarget(c.env.DB, 'generation_tags', g.id))),
  ]);

  const generationsWithTags = data.generations.map((g, i) => ({
    ...g,
    tags: (generationTags[i] ?? []).map((t) => t.name),
  }));

  return c.html(<BatchDetailPage batch={{ ...data, generations: generationsWithTags }} storyNames={storyNames} />);
});

pages.get('/stories', async (c) => {
  const res = await app.request('/api/v1/stories', {}, c.env);
  const data = (await res.json()) as { items: StoryListItem[] };
  return c.html(<StoriesPage items={data.items} />);
});

pages.get('/stories/:id', async (c) => {
  const id = c.req.param('id');
  const res = await app.request(`/api/v1/stories/${id}`, {}, c.env);
  if (res.status === 404) {
    return c.html(<NotFoundPage what="Story" />, 404);
  }
  const data = (await res.json()) as StoryDetailData;
  return c.html(<StoryDetailPage story={data} />);
});

pages.get('/bookmarks', async (c) => {
  const [genRes, batchRes, bookmarkedStories, bookmarkedExperiments] = await Promise.all([
    app.request('/api/v1/generations?bookmark=true&limit=100', {}, c.env),
    app.request('/api/v1/batches?bookmark=true&limit=100', {}, c.env),
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
    items.push({ short_id: row.short_id, image_url: generationImageUrl(origin, row.short_id) });
  }

  return c.html(<ComparePage items={items} missingIds={missingIds} warning={warning} />);
});
