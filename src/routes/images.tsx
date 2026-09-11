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
import { queryGenerations } from '../lib/generations';
import { defaultRecipeRef, findProducingRequest } from '../lib/requests';
import { getCatalog, findFinalizeDials } from '../lib/catalogs';
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
import { LightboxPanel } from '../ui/components/Lightbox';
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

/** short_id of the raw Generation `batchId`'s Batch refines (GenerationCard/Lightbox "from" badge), or null for a raw Batch. */
async function resolveRefinesGenerationShortId(c: Context, db: D1Database, batchId: string): Promise<string | null> {
  const batchRes = await internalApiRequest(c, `/api/v1/batches/${batchId}`);
  if (!batchRes.ok) return null;
  const batchData = (await batchRes.json()) as { refines_generation_id: string | null };
  if (!batchData.refines_generation_id) return null;
  const shortIds = await resolveGenerationShortIds(db, [batchData.refines_generation_id]);
  return shortIds.get(batchData.refines_generation_id) ?? null;
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

  // Gallery live insertion fragment (docs/ui.md「Gallery」): the exact card the Gallery /
  // Bookmarks list itself would render, reusing queryGenerations so the two never drift.
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

  // Finalize セクション: このGenerationを対象にした最新のrequest (finalize / repair) を状況表示する
  // (段階2のGUIはrequestsを積むことと状態を表示することだけを行う。worker-protocol.md参照)。
  const finalizeRequests = await requestSummaries<FinalizeRequestSummary>(db, finalizeRequestsRes);

  // dials / profile buttons (FinalizeFields): both the lightbox and the full page need these,
  // neither needs more than one catalog + preset lookup for it.
  const recipe = data.batch?.recipe ?? null;
  const [catalogDoc, finalizeProfiles] = await Promise.all([
    recipe ? getCatalog(db, defaultRecipeRef(c.env)) : Promise.resolve(null),
    recipe ? listFinalizeProfiles(db, recipe) : Promise.resolve([]),
  ]);
  const finalizeDials: FinalizeDials | null = recipe && catalogDoc ? findFinalizeDials(catalogDoc.doc, recipe) : null;

  // Lightbox panel fragment (Gallery / Bookmarks / Batch Detail): same components as the full
  // page below, minus the family-card / mini-map / workflow sections it doesn't need.
  if (c.req.query('partial') === 'lightbox') {
    const refinesGenerationShortId = data.batch ? await resolveRefinesGenerationShortId(c, db, data.batch.id) : null;
    return c.html(
      <LightboxPanel
        generationId={data.id}
        shortId={data.short_id}
        imageMetaText={formatImageMetaText(imageMeta)}
        refinesGenerationShortId={refinesGenerationShortId}
        rating={data.rating}
        bookmark={data.bookmark}
        poseReference={data.pose_reference}
        publications={data.publications}
        tags={tagRows.map((t) => ({ id: t.id, name: t.name }))}
        recipe={data.batch?.recipe ?? null}
        finalizeRequests={finalizeRequests}
        note={data.note}
        finalizeDials={finalizeDials}
        finalizeProfiles={finalizeProfiles}
      />,
    );
  }

  // promote-profile の表示条件: rating good で、かつこの Generation が finalize request の
  // 納品物であること。full page のみで引く追加クエリなので lightbox / card / json には出さない。
  const canPromoteToProfile =
    data.rating === 'good' && data.batch !== null && (await findFinalizeRequestForBatch(db, data.batch.id)) !== null;

  // resolved_options (worker が done の result に書く解決済みの値、docs/worker-protocol.md
  // 「finalize profile」): このGeneration自身を産んだ request からしか出せない。worker がまだ
  // 書かない行は null（段階的ロールアウトの間は何も増えない）。
  const producedByOptions = await findProducedByOptions(db, generation.id);

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
      finalizeProfiles={finalizeProfiles}
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
