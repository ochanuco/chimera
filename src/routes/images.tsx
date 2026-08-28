import { Hono } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import { getGenerationByIdOrShortId, resolveBatchShortIds, resolveGenerationShortIds } from '../lib/db';
import { listTagsForTarget } from '../lib/tags';
import { notFound } from '../lib/errors';
import { canonicalGenerationUrl, generationImageUrl } from '../lib/serialize';
import { GenerationDetailPage, type GenerationDetailData } from '../ui/pages/GenerationDetail';
import { NotFoundPage } from '../ui/pages/NotFound';
import { getImageMeta } from '../lib/image-meta';
import type { AppEnv, GenerationAssetRow } from '../types';
import type { Context } from 'hono';

export const images = new Hono<AppEnv>();

/** Explicit JSON opt-out from the default HTML Generation Detail page. */
function wantsJson(c: Context): boolean {
  if (c.req.query('format') === 'json') return true;
  const accept = c.req.header('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

// GET /g/{short_id} — canonical human-facing Generation page (SSR HTML).
// Callers that explicitly ask for JSON (Accept: application/json, or
// ?format=json) get a small pointer payload to the machine-readable API
// instead, preserving the previous stub's contract for scripted consumers.
images.get('/:shortId', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const generation = await getGenerationByIdOrShortId(db, shortId);

  if (!generation) {
    if (wantsJson(c)) throw notFound('generation');
    return c.html(<NotFoundPage what="Generation" />, 404);
  }

  if (wantsJson(c)) {
    const origin = new URL(c.req.url).origin;
    return c.json({
      canonical_url: canonicalGenerationUrl(origin, generation.short_id),
      context_url: `${origin}/api/v1/generations/${generation.short_id}/context`,
      image_url: generationImageUrl(origin, generation.short_id),
    });
  }

  const [detailRes, tagRows, imageMeta] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations/${generation.id}`),
    listTagsForTarget(db, 'generation_tags', generation.id),
    getImageMeta(c.env.IMAGES, generation.r2_object_key),
  ]);
  const data = (await detailRes.json()) as GenerationDetailData;

  let storyLinks: { story_id: string; story_name: string; label: string | null }[] = [];
  // "親" (parent) material for a Generation is its own Batch's reference material
  // (batch_references where target_batch_id = the owning Batch), not `data.references`
  // (which is the reverse: Batches downstream that used *this* Generation as material,
  // i.e. this Generation's "子" — see `used_by` below).
  let parentReferences: { source_generation_id: string; purpose: string | null; aspect: string | null }[] = [];
  if (data.batch) {
    const batchRes = await internalApiRequest(c, `/api/v1/batches/${data.batch.id}`);
    if (batchRes.ok) {
      const batchData = (await batchRes.json()) as {
        references: { source_generation_id: string; purpose: string | null; aspect: string | null }[];
        story_relations: { story_id: string; label: string | null }[];
      };
      parentReferences = batchData.references;

      const storyIds = Array.from(new Set(batchData.story_relations.map((r) => r.story_id)));
      const storyNames = new Map<string, string>();
      await Promise.all(
        storyIds.map(async (sid) => {
          const sRes = await internalApiRequest(c, `/api/v1/stories/${sid}`);
          if (sRes.ok) {
            const sData = (await sRes.json()) as { name: string };
            storyNames.set(sid, sData.name);
          }
        }),
      );
      storyLinks = batchData.story_relations.map((r) => ({
        story_id: r.story_id,
        story_name: storyNames.get(r.story_id) ?? r.story_id,
        label: r.label,
      }));
    }
  }

  const [batchShortIds, generationShortIds] = await Promise.all([
    resolveBatchShortIds(db, data.used_by.map((r) => r.batch_id)),
    resolveGenerationShortIds(
      db,
      parentReferences.map((r) => r.source_generation_id),
    ),
  ]);

  return c.html(
    <GenerationDetailPage
      data={data}
      tags={tagRows.map((t) => ({ id: t.id, name: t.name }))}
      storyLinks={storyLinks}
      batchShortIds={batchShortIds}
      generationShortIds={generationShortIds}
      parentReferences={parentReferences}
      imageMeta={imageMeta}
    />,
  );
});

images.get('/:shortId/image', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const generation = await getGenerationByIdOrShortId(db, shortId);
  if (!generation) throw notFound('generation');

  const object = await c.env.IMAGES.get(generation.r2_object_key);
  if (!object) throw notFound('image');

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// GET /g/{short_id}/assets/{role}[?region=] — streams a layered asset
// (lineart / mask / decomposed layer / PSD / ...) for a Generation.
// region omitted means '' (the "whole image, no region" row).
images.get('/:shortId/assets/:role', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const role = c.req.param('role');
  const region = c.req.query('region') ?? '';

  const generation = await getGenerationByIdOrShortId(db, shortId);
  if (!generation) throw notFound('generation');

  const asset = await db
    .prepare('SELECT * FROM generation_assets WHERE generation_id = ? AND role = ? AND region = ?')
    .bind(generation.id, role, region)
    .first<GenerationAssetRow>();
  if (!asset) throw notFound('asset');

  const object = await c.env.IMAGES.get(asset.r2_object_key);
  if (!object) throw notFound('asset');

  return new Response(object.body, {
    headers: {
      'Content-Type': asset.content_type,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
