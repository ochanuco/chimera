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
import { notFound } from '../lib/errors';
import { canonicalGenerationUrl, generationImageUrl } from '../lib/serialize';
import { GenerationDetailPage, type GenerationDetailData, type FinalizeRequestSummary } from '../ui/pages/GenerationDetail';
import { NotFoundPage } from '../ui/pages/NotFound';
import { getImageMeta, type ImageMeta } from '../lib/image-meta';
import type { AppEnv, GenerationAssetRow, GenerationRow } from '../types';
import type { Context } from 'hono';

export const images = new Hono<AppEnv>();

/** Prefers the D1-persisted columns (backfilled or set at ingest) over an R2 ranged get; NULL means a pre-backfill row. */
async function resolveImageMeta(bucket: R2Bucket, generation: GenerationRow): Promise<ImageMeta | null> {
  if (generation.image_size !== null) {
    return { width: generation.image_width, height: generation.image_height, size: generation.image_size };
  }
  return getImageMeta(bucket, generation.r2_object_key);
}

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

  const [detailRes, tagRows, imageMeta, finalizeRequestsRes] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations/${generation.id}`),
    listTagsForTarget(db, 'generation_tags', generation.id),
    resolveImageMeta(c.env.IMAGES, generation),
    internalApiRequest(c, `/api/v1/requests?kind=finalize&generation_id=${generation.id}&limit=5`),
  ]);
  const data = (await detailRes.json()) as GenerationDetailData;

  // Finalize セクション: このGenerationを対象にした最新のfinalize requestを状況表示する
  // (段階2のGUIはrequestsを積むことと状態を表示することだけを行う。worker-protocol.md参照)。
  const finalizeRequestsData = (await finalizeRequestsRes.json()) as {
    items: { id: string; status: string; created_at: string; error: string | null; result: { generation_ids: string[] } | null }[];
  };
  const finalizeResultGenerationIds = finalizeRequestsData.items.flatMap((r) => r.result?.generation_ids ?? []);
  const finalizeResultShortIds = await resolveGenerationShortIds(db, finalizeResultGenerationIds);
  const finalizeRequests: FinalizeRequestSummary[] = finalizeRequestsData.items.map((r) => ({
    id: r.id,
    status: r.status as FinalizeRequestSummary['status'],
    created_at: r.created_at,
    error: r.error,
    resultShortId: r.result?.generation_ids[0] ? finalizeResultShortIds.get(r.result.generation_ids[0]) ?? null : null,
  }));

  // "親" (parent) material for a Generation is its own Batch's reference material
  // (batch_references where target_batch_id = the owning Batch), not `data.references`
  // (which is the reverse: Batches downstream that used *this* Generation as material,
  // i.e. this Generation's "子" — see `used_by` below).
  let parentReferences: { source_generation_id: string; purpose: string | null; aspect: string | null }[] = [];
  // Batch-level relations of the owning Batch (retries / Story continuation), surfaced on the
  // Generation page as "via batch" family cards alongside the Generation-level material relations.
  let relationsIncoming: { source_batch_id: string; reason: string | null }[] = [];
  let relationsOutgoing: { target_batch_id: string; reason: string | null }[] = [];
  let storyLinks: { story_id: string; story_name: string; label: string | null; source_batch_id: string; target_batch_id: string }[] =
    [];
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
      };
      parentReferences = batchData.references;
      relationsIncoming = batchData.relations.incoming;
      relationsOutgoing = batchData.relations.outgoing;

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

  // 系譜ミニマップ: 所属Batchの参照系譜・再試行連結成分と、所属Batchが属する各Storyの全Batch。
  const ownBatchId = data.batch?.id;
  const miniMapStoryIds = Array.from(new Set(storyLinks.map((s) => s.story_id)));
  const [referenceLineageBatches, relationChainBatches, storyChainBatchesList] = await Promise.all([
    ownBatchId ? getReferenceLineageBatches(db, ownBatchId) : Promise.resolve([]),
    ownBatchId ? getRelationChainBatches(db, ownBatchId) : Promise.resolve([]),
    Promise.all(miniMapStoryIds.map((sid) => getStoryChainBatches(db, sid))),
  ]);
  const miniMapRows: MiniMapRow[] = ownBatchId
    ? [
        {
          label: 'References',
          items: referenceLineageBatches.map((b) => ({ short_id: b.short_id, is_current: b.id === ownBatchId })),
        },
        {
          label: 'Retries',
          items: relationChainBatches.map((b) => ({ short_id: b.short_id, is_current: b.id === ownBatchId })),
        },
        ...miniMapStoryIds.map((sid, i) => ({
          label: storyLinks.find((s) => s.story_id === sid)?.story_name ?? sid,
          items: storyChainBatchesList[i]!.map((b) => ({ short_id: b.short_id, is_current: b.id === ownBatchId })),
        })),
      ]
    : [];

  // Every Batch referenced by a family card (used_by / relation retries / Story neighbors)
  // needs both its short_id (for the link) and its representative Generation (for the thumbnail).
  const relatedBatchIds = [
    ...data.used_by.map((r) => r.batch_id),
    ...relationsIncoming.map((r) => r.source_batch_id),
    ...relationsOutgoing.map((r) => r.target_batch_id),
    ...storyLinks.map((r) => r.source_batch_id),
    ...storyLinks.map((r) => r.target_batch_id),
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
      imageMeta={imageMeta}
      finalizeRequests={finalizeRequests}
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
