import { Hono } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import { getGenerationByIdOrShortId, resolveGenerationShortIds } from '../lib/db';
import { getExperimentRunFamily } from '../lib/experiments';
import { getGenerationFamily } from '../lib/generation-family';
import { listTagsForTarget } from '../lib/tags';
import { gone, notFound } from '../lib/errors';
import { canonicalGenerationUrl, generationImageUrl } from '../lib/serialize';
import { loadOrCreateGenerationPreview } from '../lib/generation-preview';
import { queryGenerations } from '../lib/generations';
import { defaultRecipeRef, findProducingRequest, isDeliveredRequest, requestOfGeneration } from '../lib/requests';
import {
  getCatalog,
  findDeliverDials,
  findDeliverDefaults,
  findDeliverDof,
  findDeliverBackdropColor,
  findRedrawDials,
  findRepairDials,
  findRedrawDefaults,
  findRedrawLight,
  findBackdrops,
} from '../lib/catalogs';
import { listDeliverProfiles } from '../lib/presets';
import { isDeliverResult } from '../lib/promote';
import {
  GenerationDetailPage,
  type GenerationDetailData,
  type RequestSummary,
  type ProducedByOptions,
} from '../ui/pages/GenerationDetail';
import { GenerationCard } from '../ui/components/GenerationCard';
import { NotFoundPage } from '../ui/pages/NotFound';
import { getImageMeta, formatImageMetaText, type ImageMeta } from '../lib/image-meta';
import type { AppEnv, GenerationAssetRow, GenerationRow } from '../types';
import type { Context } from 'hono';

export const images = new Hono<AppEnv>();

/** Prefers the D1-persisted columns (backfilled or set at ingest) over an R2 ranged get; NULL means a pre-backfill row. */
async function resolveImageMeta(bucket: R2Bucket, generation: GenerationRow): Promise<ImageMeta | null> {
  if (generation.image_size !== null) {
    return { width: generation.image_width, height: generation.image_height, size: generation.image_size };
  }
  // original が purge 済みなら R2 には無いので、無駄な GET を打たずに諦める。
  if (generation.original_purged_at) return null;
  return getImageMeta(bucket, generation.r2_object_key);
}

/** Summaries of the requests that target one Generation; every kind carries a generation_id + options-only payload. */
async function requestSummaries<
  T extends {
    id: string;
    kind: string;
    status: string;
    created_at: string;
    error: string | null;
    resultShortId: string | null;
    resolvedOptions: Record<string, unknown> | null;
  },
>(db: D1Database, res: Response): Promise<T[]> {
  const data = (await res.json()) as {
    items: {
      id: string;
      kind: string;
      status: string;
      created_at: string;
      error: string | null;
      result: { generation_ids: string[]; resolved_options?: Record<string, unknown> } | null;
    }[];
  };
  const resultGenerationIds = data.items.flatMap((r) => r.result?.generation_ids ?? []);
  const resultShortIds = await resolveGenerationShortIds(db, resultGenerationIds);
  return data.items.map(
    (r) =>
      ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        created_at: r.created_at,
        error: r.error,
        resultShortId: r.result?.generation_ids[0] ? (resultShortIds.get(r.result.generation_ids[0]) ?? null) : null,
        resolvedOptions: r.result?.resolved_options ?? null,
      }) as T,
  );
}

/** `{requested, resolved}` for the redraw/deliver/repair/masked_redraw (or older finalize) request that produced `generation` — null when it wasn't produced by one, or the worker hasn't written `resolved_options` yet. */
async function findProducedByOptions(db: D1Database, generationId: string): Promise<ProducedByOptions | null> {
  const row = await findProducingRequest(db, generationId);
  if (!row || !row.result_json) return null;
  const result = JSON.parse(row.result_json) as { resolved_options?: Record<string, unknown> };
  if (!result.resolved_options) return null;
  const payload = JSON.parse(row.payload_json) as { options?: Record<string, unknown> };
  return { requested: payload.options ?? null, resolved: result.resolved_options };
}

/** Explicit JSON opt-out from the default HTML Generation Detail page. */
function wantsJson(c: Context): boolean {
  if (c.req.query('format') === 'json') return true;
  const accept = c.req.header('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

// GET /g/{short_id} — canonical SSR page; JSON opt-in (Accept/format=json) returns a
// pointer payload for scripted consumers instead of the full HTML page.
images.get('/:shortId', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const generation = await getGenerationByIdOrShortId(db, shortId);

  if (!generation) {
    if (wantsJson(c)) throw notFound('generation');
    return c.html(<NotFoundPage what="Generation" />, 404);
  }

  // Gallery live insertion fragment: reuses queryGenerations so this card never drifts from
  // what the Gallery / Bookmarks list itself renders (docs/ui.md「Gallery」).
  if (c.req.query('partial') === 'card') {
    const origin = new URL(c.req.url).origin;
    const cardData = await queryGenerations(db, { ids: generation.short_id }, origin);
    const item = cardData.items[0];
    if (!item) throw notFound('generation');
    return c.html(<GenerationCard g={item} />);
  }

  if (wantsJson(c)) {
    const origin = new URL(c.req.url).origin;
    return c.json({
      canonical_url: canonicalGenerationUrl(origin, generation.short_id),
      context_url: `${origin}/api/v1/generations/${generation.short_id}/context`,
      image_url: generationImageUrl(origin, generation.short_id),
    });
  }

  const [detailRes, tagRows, imageMeta, requestsRes] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations/${generation.id}`),
    listTagsForTarget(db, 'generation_tags', generation.id),
    resolveImageMeta(c.env.IMAGES, generation),
    internalApiRequest(c, `/api/v1/requests?generation_id=${generation.id}&limit=5`),
  ]);
  const data = (await detailRes.json()) as GenerationDetailData;

  // Requests セクション: 最新の request の状態表示（GUI は request を積むだけ、worker-protocol.md）。
  const requests = await requestSummaries<RequestSummary>(db, requestsRes);

  const recipe = data.request?.recipe ?? null;
  const [catalogDoc, deliverProfiles] = await Promise.all([
    recipe ? getCatalog(db, defaultRecipeRef(c.env)) : Promise.resolve(null),
    recipe ? listDeliverProfiles(db, recipe) : Promise.resolve([]),
  ]);
  const doc = recipe && catalogDoc ? catalogDoc.doc : null;
  const producing = generation.request_id ? await requestOfGeneration(db, generation).catch(() => null) : null;
  const delivered = producing ? isDeliveredRequest(producing) : false;

  // promote-profile の表示条件: rating good で、かつこの Generation が deliver request の
  // 納品物であること。full page のみで引く追加クエリなので card / json には出さない。
  const canPromoteToProfile = data.rating === 'good' && (await isDeliverResult(db, generation));

  const producedByOptions = await findProducedByOptions(db, generation.id);

  const experimentRun = generation.request_id ? await getExperimentRunFamily(db, generation.request_id) : null;
  const family = await getGenerationFamily(db, generation, experimentRun);

  return c.html(
    <GenerationDetailPage
      path={c.req.path}
      data={data}
      tags={tagRows.map((t) => ({ id: t.id, name: t.name }))}
      family={family}
      imageMeta={imageMeta}
      requests={requests}
      delivered={delivered}
      redrawForm={{
        dials: doc && recipe ? findRedrawDials(doc, recipe) : null,
        defaults: doc && recipe ? findRedrawDefaults(doc, recipe) : null,
        light: doc && recipe ? findRedrawLight(doc, recipe) : null,
        hiresAvailable: producing?.kind === 'generate',
      }}
      repairForm={{ dials: doc && recipe ? findRepairDials(doc, recipe) : null }}
      deliverForm={{
        dials: doc && recipe ? findDeliverDials(doc, recipe) : null,
        defaults: doc && recipe ? findDeliverDefaults(doc, recipe) : null,
        dof: doc && recipe ? findDeliverDof(doc, recipe) : null,
        light: doc && recipe ? findRedrawLight(doc, recipe) : null,
        backdropColor: doc && recipe ? findDeliverBackdropColor(doc, recipe) : null,
        profiles: deliverProfiles,
        // backdrops is a catalog-wide (not per-recipe) key, so it follows the same recipe-gated catalog fetch above.
        backdrops: doc ? findBackdrops(doc).map(({ name, label }) => ({ name, label })) : [],
        recipeRef: recipe ? defaultRecipeRef(c.env) : null,
        catalogVersion: catalogDoc?.row.updated_at ?? null,
      }}
      canPromoteToProfile={canPromoteToProfile}
      producedByOptions={producedByOptions}
    />,
  );
});

images.get('/:shortId/image', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const generation = await getGenerationByIdOrShortId(db, shortId);
  if (!generation) throw notFound('generation');
  if (generation.original_purged_at) throw gone('original_purged', 'the original image was purged; see /preview instead');

  const object = await c.env.IMAGES.get(generation.r2_object_key);
  if (!object) throw notFound('image');

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// GET /g/{short_id}/preview — thumbnail WebP, created on first request and stored for next
// time. Falls back to the original bytes (cached far more briefly) when a preview can't be made.
images.get('/:shortId/preview', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const generation = await getGenerationByIdOrShortId(db, shortId);
  if (!generation) throw notFound('generation');

  const preview = await loadOrCreateGenerationPreview(c.env, generation);
  if (!preview) throw notFound('image');

  return new Response(preview.body, {
    headers: {
      'Content-Type': preview.contentType,
      'Cache-Control': preview.stored ? 'private, max-age=31536000, immutable' : 'private, max-age=300',
    },
  });
});

// GET /g/{short_id}/assets/{role}[?region=] — region omitted means '' (the "whole image" row).
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
