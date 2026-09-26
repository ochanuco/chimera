import { Hono } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import {
  getGenerationByIdOrShortId,
  getReferenceLineageBatches,
  getRelationChainBatches,
  getStoryChainBatches,
  resolveBatchShortIds,
  resolveBatchThumbnails,
  resolveGenerationShortIds,
} from '../lib/db';
import type { MiniMapRow } from '../ui/components/MiniMap';
import { listTagsForTarget } from '../lib/tags';
import { gone, notFound } from '../lib/errors';
import { canonicalGenerationUrl, generationImageUrl } from '../lib/serialize';
import { loadOrCreateGenerationPreview } from '../lib/generation-preview';
import { queryGenerations } from '../lib/generations';
import { defaultRecipeRef, findProducingRequest } from '../lib/requests';
import { getCatalog, findFinalizeDials, findFinalizeDefaults, findBackdrops, type FinalizeDefaults } from '../lib/catalogs';
import { listFinalizeProfiles } from '../lib/presets';
import { findFinalizeRequestForBatch } from '../lib/promote';
import type { FinalizeDials } from '../ui/finalize-options';
import {
  GenerationDetailPage,
  type GenerationDetailData,
  type FinalizeRequestSummary,
  type ExperimentRunFamily,
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

/** Shape shared by FinalizeRequestSummary / RepairRequestSummary: both requests kinds carry generation_id + options-only payloads. */
async function requestSummaries<
  T extends {
    id: string;
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
        status: r.status,
        created_at: r.created_at,
        error: r.error,
        resultShortId: r.result?.generation_ids[0] ? (resultShortIds.get(r.result.generation_ids[0]) ?? null) : null,
        resolvedOptions: r.result?.resolved_options ?? null,
      }) as T,
  );
}

/** `{requested, resolved}` for the finalize/repair/masked_redraw request that produced `generation` — null when it wasn't produced by one, or the worker hasn't written `resolved_options` yet. */
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

  const [detailRes, tagRows, imageMeta, finalizeRequestsRes] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations/${generation.id}`),
    listTagsForTarget(db, 'generation_tags', generation.id),
    resolveImageMeta(c.env.IMAGES, generation),
    internalApiRequest(c, `/api/v1/requests?generation_id=${generation.id}&limit=5`),
  ]);
  const data = (await detailRes.json()) as GenerationDetailData;

  // Finalize セクション: 最新の finalize/repair request の状態表示のみ（GUI は request を積むだけ、worker-protocol.md）。
  const finalizeRequests = await requestSummaries<FinalizeRequestSummary>(db, finalizeRequestsRes);

  const recipe = data.batch?.recipe ?? null;
  const [catalogDoc, finalizeProfiles] = await Promise.all([
    recipe ? getCatalog(db, defaultRecipeRef(c.env)) : Promise.resolve(null),
    recipe ? listFinalizeProfiles(db, recipe) : Promise.resolve([]),
  ]);
  const finalizeDials: FinalizeDials | null = recipe && catalogDoc ? findFinalizeDials(catalogDoc.doc, recipe) : null;
  const finalizeDefaults: FinalizeDefaults | null = recipe && catalogDoc ? findFinalizeDefaults(catalogDoc.doc, recipe) : null;
  // backdrops is a catalog-wide (not per-recipe) key, so it follows the same recipe-gated catalog fetch above.
  const finalizeBackdrops = catalogDoc ? findBackdrops(catalogDoc.doc).map(({ name, label }) => ({ name, label })) : [];
  const finalizeRecipeRef = recipe ? defaultRecipeRef(c.env) : null;
  const finalizeCatalogVersion = catalogDoc?.row.updated_at ?? null;

  // promote-profile の表示条件: rating good で、かつこの Generation が finalize request の
  // 納品物であること。full page のみで引く追加クエリなので card / json には出さない。
  const canPromoteToProfile =
    data.rating === 'good' && data.batch !== null && (await findFinalizeRequestForBatch(db, data.batch.id)) !== null;

  const producedByOptions = await findProducedByOptions(db, generation.id);

  // "親" material is the owning Batch's own reference material (batch_references,
  // target_batch_id = this Batch) — not `data.references`, which is the reverse: downstream
  // Batches that used this Generation as material (this Generation's "子", see `used_by` below).
  let parentReferences: { source_generation_id: string; purpose: string | null; aspect: string | null }[] = [];
  // Batch-level relations (retries / Story continuation), surfaced as "via batch" family cards
  // alongside the Generation-level material relations above.
  let relationsIncoming: { source_batch_id: string; reason: string | null }[] = [];
  let relationsOutgoing: { target_batch_id: string; reason: string | null }[] = [];
  let storyLinks: { story_id: string; story_name: string; label: string | null; source_batch_id: string; target_batch_id: string }[] =
    [];
  let experimentRun: ExperimentRunFamily | null = null;
  if (data.batch) {
    const batchRes = await internalApiRequest(c, `/api/v1/batches/${data.batch.id}`);
    if (batchRes.ok) {
      const batchData = (await batchRes.json()) as {
        references: { source_generation_id: string; purpose: string | null; aspect: string | null }[];
        relations: {
          outgoing: { target_batch_id: string; reason: string | null }[];
          incoming: { source_batch_id: string; reason: string | null }[];
        };
        story_relations: { story_id: string; label: string | null; source_batch_id: string; target_batch_id: string }[];
        experiment_run: ExperimentRunFamily | null;
      };
      parentReferences = batchData.references;
      relationsIncoming = batchData.relations.incoming;
      relationsOutgoing = batchData.relations.outgoing;
      experimentRun = batchData.experiment_run;

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
        source_batch_id: r.source_batch_id,
        target_batch_id: r.target_batch_id,
      }));
    }
  }

  const ownBatchId = data.batch?.id;
  const miniMapStoryIds = Array.from(new Set(storyLinks.map((s) => s.story_id)));
  const [referenceLineageBatches, relationChainBatches, storyChainBatchesList] = await Promise.all([
    ownBatchId ? getReferenceLineageBatches(db, ownBatchId) : Promise.resolve([]),
    ownBatchId ? getRelationChainBatches(db, ownBatchId) : Promise.resolve([]),
    Promise.all(miniMapStoryIds.map((sid) => getStoryChainBatches(db, sid))),
  ]);
  // Each Batch is stood in for by its representative Generation (owning Batch by this
  // Generation itself); a Batch with no Generations yet keeps its /b/ link instead.
  const mapThumbnails = await resolveBatchThumbnails(
    db,
    [referenceLineageBatches, relationChainBatches, ...storyChainBatchesList].flat().map((b) => b.id),
  );
  const generationMapItem = (b: { id: string; short_id: string }) => {
    if (b.id === ownBatchId) return { short_id: data.short_id, href: `/g/${data.short_id}`, is_current: true };
    const representative = mapThumbnails.get(b.id);
    return representative
      ? { short_id: representative, href: `/g/${representative}`, is_current: false }
      : { short_id: b.short_id, href: `/b/${b.short_id}`, is_current: false };
  };
  const miniMapRows: MiniMapRow[] = ownBatchId
    ? [
        { label: 'References', items: referenceLineageBatches.map(generationMapItem) },
        { label: 'Retries', items: relationChainBatches.map(generationMapItem) },
        ...miniMapStoryIds.map((sid, i) => ({
          label: storyLinks.find((s) => s.story_id === sid)?.story_name ?? sid,
          items: storyChainBatchesList[i]!.map(generationMapItem),
        })),
      ]
    : [];

  const relatedBatchIds = [
    ...data.used_by.map((r) => r.batch_id),
    ...relationsIncoming.map((r) => r.source_batch_id),
    ...relationsOutgoing.map((r) => r.target_batch_id),
    ...storyLinks.map((r) => r.source_batch_id),
    ...storyLinks.map((r) => r.target_batch_id),
    ...(experimentRun?.parent ? [experimentRun.parent.batch_id] : []),
    ...(experimentRun?.children.map((ch) => ch.batch_id) ?? []),
    ...(experimentRun?.siblings.map((s) => s.batch_id) ?? []),
  ];

  const [batchShortIds, generationShortIds, batchThumbnails] = await Promise.all([
    resolveBatchShortIds(db, relatedBatchIds),
    resolveGenerationShortIds(
      db,
      parentReferences.map((r) => r.source_generation_id),
    ),
    resolveBatchThumbnails(db, relatedBatchIds),
  ]);

  return c.html(
    <GenerationDetailPage
      path={c.req.path}
      data={data}
      tags={tagRows.map((t) => ({ id: t.id, name: t.name }))}
      storyLinks={storyLinks}
      miniMapRows={miniMapRows}
      batchShortIds={batchShortIds}
      generationShortIds={generationShortIds}
      batchThumbnails={batchThumbnails}
      parentReferences={parentReferences}
      relationsIncoming={relationsIncoming}
      relationsOutgoing={relationsOutgoing}
      experimentRun={experimentRun}
      imageMeta={imageMeta}
      finalizeRequests={finalizeRequests}
      finalizeDials={finalizeDials}
      finalizeDefaults={finalizeDefaults}
      finalizeProfiles={finalizeProfiles}
      finalizeBackdrops={finalizeBackdrops}
      finalizeRecipeRef={finalizeRecipeRef}
      finalizeCatalogVersion={finalizeCatalogVersion}
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
