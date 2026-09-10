import { Hono } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import {
  getGenerationByIdOrShortId,
  getReferenceLineageBatches,
  getRelationChainBatches,
  getStoryChainBatches,
  resolveBatchPrompts,
  resolveBatchShortIds,
  resolveBatchThumbnails,
  resolveGenerationShortIds,
} from '../lib/db';
import type { MiniMapRow } from '../ui/components/MiniMap';
import { listTagsForTarget } from '../lib/tags';
import { generationImageUrl } from '../lib/serialize';
import { listBookmarkedExperiments } from '../lib/ui-queries';
import { GalleryPage, GalleryCards, type GalleryFilters, type GalleryItem } from '../ui/pages/Gallery';
import type { GalleryView } from '../ui/components/ViewSwitch';
import { BatchesPage } from '../ui/pages/Batches';
import { BatchDetailPage, type BatchDetailData, type FinalizeSummary, type FinalizeRequestStatus } from '../ui/pages/BatchDetail';
import { ExperimentsPage, type ExperimentListItem } from '../ui/pages/Experiments';
import { EXPERIMENT_STATUSES } from '../lib/experiment-status';
import { ExperimentDetailPage, type ExperimentDetailData, type ExperimentJudgmentSummary } from '../ui/pages/ExperimentDetail';
import { ExperimentAbPage, type AbPair, type ExperimentAbData } from '../ui/pages/ExperimentAb';
import { judgedSeedsForPair } from '../lib/judgments';
import { BookmarksPage } from '../ui/pages/Bookmarks';
import { ComparePage, type CompareItem, type CompareSemantic } from '../ui/pages/Compare';
import { NotFoundPage } from '../ui/pages/NotFound';
import { renderFactsForJob } from '../lib/render-facts';
import type { AppEnv, ComfyJobRow, ExperimentRunRow, GenerationRow } from '../types';
import type { GenerationCardData } from '../ui/components/GenerationCard';
import type { BatchRowData } from '../ui/components/BatchRow';

export const pages = new Hono<AppEnv>();

pages.get('/', (c) => c.redirect('/gallery'));

function parseGalleryView(raw: string | undefined, defaultView: GalleryView): GalleryView {
  return raw === 'raw' || raw === 'refined' || raw === 'all' ? raw : defaultView;
}

pages.get('/gallery', async (c) => {
  const q = c.req.query();

  const view = parseGalleryView(q.view, 'raw');
  const bad = q.bad === '1';
  const ids = q.ids?.trim() || undefined;

  const filters: GalleryFilters = {
    view,
    bad,
    ids,
    tag: q.tag || undefined,
    rating: q.rating || undefined,
    bookmark: q.bookmark === 'true' ? 'true' : undefined,
  };

  const apiParams = new URLSearchParams();
  if (ids) {
    // ids が指定されたときは view / bad 非表示を無視し、指定した Generation だけを返す
    // (docs/ui.md「Gallery」)。
    apiParams.set('ids', ids);
  } else {
    if (view !== 'all') apiParams.set('origin', view);
    if (!bad) apiParams.set('exclude_rating', 'bad');
  }
  if (filters.tag) apiParams.set('tag', filters.tag);
  if (filters.rating) apiParams.set('rating', filters.rating);
  if (filters.bookmark) apiParams.set('bookmark', filters.bookmark);
  const limit = q.limit ? Math.min(Math.max(Number(q.limit) || 24, 1), 200) : 24;
  apiParams.set('limit', String(limit));
  if (q.cursor) apiParams.set('cursor', q.cursor);

  const genRes = await internalApiRequest(c, `/api/v1/generations?${apiParams.toString()}`);
  const genData = (await genRes.json()) as { items: GalleryItem[]; total: number; next_cursor: string | null };

  // ids が厳密に1件の既存 Generation に解決したときは detail へ直行する。
  if (ids && genData.total === 1 && genData.items[0]) {
    return c.redirect(`/g/${genData.items[0].short_id}`);
  }

  if (q.partial === '1') {
    return c.html(<GalleryCards items={genData.items} nextCursor={genData.next_cursor} filters={filters} />);
  }

  return c.html(<GalleryPage path={c.req.path} items={genData.items} nextCursor={genData.next_cursor} filters={filters} />);
});

pages.get('/batches', async (c) => {
  const bookmarkOnly = c.req.query('bookmark') === 'true';
  const params = new URLSearchParams();
  if (bookmarkOnly) params.set('bookmark', 'true');
  params.set('limit', '100');

  const res = await internalApiRequest(c, `/api/v1/batches?${params.toString()}`);
  const data = (await res.json()) as { items: BatchRowData[] };

  return c.html(<BatchesPage path={c.req.path} items={data.items} bookmarkOnly={bookmarkOnly} />);
});

pages.get('/b/:shortId', async (c) => {
  const shortId = c.req.param('shortId');
  const res = await internalApiRequest(c, `/api/v1/batches/${shortId}`);
  if (res.status === 404) {
    return c.html(<NotFoundPage what="Batch" />, 404);
  }
  const data = (await res.json()) as BatchDetailData;

  const experimentRunBatchIds = data.experiment_run
    ? [
        ...(data.experiment_run.parent ? [data.experiment_run.parent.batch_id] : []),
        ...data.experiment_run.children.map((ch) => ch.batch_id),
        ...data.experiment_run.siblings.map((s) => s.batch_id),
      ]
    : [];
  const referencedBatchIds = [
    ...data.relations.outgoing.map((r) => r.target_batch_id),
    ...data.relations.incoming.map((r) => r.source_batch_id),
    ...data.story_relations.map((r) => r.source_batch_id),
    ...data.story_relations.map((r) => r.target_batch_id),
    ...data.reference_children.map((r) => r.batch_id),
    ...data.siblings.map((s) => s.batch_id),
    ...data.siblings.filter((s) => s.via === 'refinement').map((s) => s.shared_id),
    ...experimentRunBatchIds,
  ];
  const referencedGenerationIds = [
    ...data.references.map((r) => r.source_generation_id),
    ...data.reference_children.map((r) => r.source_generation_id),
    ...data.siblings.filter((s) => s.via === 'reference').map((s) => s.shared_id),
  ];

  const miniMapStoryIds = Array.from(new Set(data.story_relations.map((r) => r.story_id)));
  // retry 元(親)の先頭を diff 基準にする。incoming は created_at ASC で並ぶ(routes/batches.ts)。
  const diffParentId = data.relations.incoming[0]?.source_batch_id ?? null;

  const [
    storyNames,
    generationTags,
    batchShortIds,
    generationShortIds,
    batchThumbnails,
    referenceLineageBatches,
    relationChainBatches,
    storyChainBatchesList,
    diffParentPrompts,
  ] = await Promise.all([
      (async () => {
        const names: Record<string, string> = {};
        await Promise.all(
          miniMapStoryIds.map(async (sid) => {
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
      resolveBatchThumbnails(c.env.DB, referencedBatchIds),
      getReferenceLineageBatches(c.env.DB, data.id),
      getRelationChainBatches(c.env.DB, data.id),
      Promise.all(miniMapStoryIds.map((sid) => getStoryChainBatches(c.env.DB, sid))),
      resolveBatchPrompts(c.env.DB, diffParentId ? [diffParentId] : []),
    ]);

  // Finalize all arms の状況表示: このBatch配下の全GenerationについてのfinalizeRequestをstatus別に集計する
  // (段階2のGUIはrequestsを積むことと状態を表示することだけを行う。worker-protocol.md参照)。
  const finalizeRequestsRes = await internalApiRequest(c, `/api/v1/requests?kind=finalize&batch_id=${data.id}&limit=200`);
  const finalizeRequestsData = (await finalizeRequestsRes.json()) as { items: { id: string; status: string }[] };
  const finalizeSummary: FinalizeSummary = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const r of finalizeRequestsData.items) {
    if (r.status === 'queued' || r.status === 'running' || r.status === 'done' || r.status === 'failed') {
      finalizeSummary[r.status] += 1;
    }
  }
  const finalizeRequests: FinalizeRequestStatus[] = finalizeRequestsData.items.map((r) => ({
    id: r.id,
    status: r.status as FinalizeRequestStatus['status'],
  }));

  const diffParentPrompt = diffParentId ? diffParentPrompts.get(diffParentId) ?? null : null;
  const diffParent = diffParentId && diffParentPrompt
    ? {
        shortId: batchShortIds.get(diffParentId) ?? diffParentId,
        prompt: diffParentPrompt.prompt,
        negative_prompt: diffParentPrompt.negative_prompt,
      }
    : null;

  const generationsWithTags = data.generations.map((g, i) => ({
    ...g,
    tags: (generationTags[i] ?? []).map((t) => t.name),
  }));

  // 系譜ミニマップ: 自Batchの参照系譜・再試行連結成分と、自Batchが属する各Storyの全Batch。
  const miniMapRows: MiniMapRow[] = [
    {
      label: 'References',
      items: referenceLineageBatches.map((b) => ({ short_id: b.short_id, is_current: b.id === data.id })),
    },
    {
      label: 'Retries',
      items: relationChainBatches.map((b) => ({ short_id: b.short_id, is_current: b.id === data.id })),
    },
    ...miniMapStoryIds.map((sid, i) => ({
      label: storyNames[sid] ?? sid,
      items: storyChainBatchesList[i]!.map((b) => ({ short_id: b.short_id, is_current: b.id === data.id })),
    })),
  ];

  return c.html(
    <BatchDetailPage
      path={c.req.path}
      batch={{ ...data, generations: generationsWithTags }}
      storyNames={storyNames}
      miniMapRows={miniMapRows}
      batchShortIds={batchShortIds}
      generationShortIds={generationShortIds}
      batchThumbnails={batchThumbnails}
      diffParent={diffParent}
      finalizeSummary={finalizeSummary}
      finalizeRequests={finalizeRequests}
    />,
  );
});

pages.get('/experiments', async (c) => {
  // 未知の status をそのまま転送すると API が 400 を返し、一覧が描画できなくなる。
  // GUI のフィルタなので、候補外の値は指定なしとして扱う。
  const statusParam = c.req.query('status');
  const status = statusParam && (EXPERIMENT_STATUSES as readonly string[]).includes(statusParam)
    ? statusParam
    : undefined;
  const bookmarkOnly = c.req.query('bookmark') === 'true';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (bookmarkOnly) params.set('bookmark', 'true');

  const res = await internalApiRequest(c, `/api/v1/experiments?${params.toString()}`);
  const data = (await res.json()) as { items: ExperimentListItem[] };
  return c.html(<ExperimentsPage path={c.req.path} items={data.items} status={status} />);
});

pages.get('/experiments/:id', async (c) => {
  const id = c.req.param('id');
  const res = await internalApiRequest(c, `/api/v1/experiments/${id}`);
  if (res.status === 404) {
    return c.html(<NotFoundPage what="Experiment" />, 404);
  }
  const data = (await res.json()) as ExperimentDetailData;
  const judgmentsRes = await internalApiRequest(c, `/api/v1/experiments/${id}/judgments/summary`);
  const judgments = (await judgmentsRes.json()) as ExperimentJudgmentSummary;
  const baseGenerationShortIds = await resolveGenerationShortIds(
    c.env.DB,
    data.base_generation_id ? [data.base_generation_id] : [],
  );
  const experiment: ExperimentDetailData = {
    ...data,
    base_generation_short_id: data.base_generation_id ? baseGenerationShortIds.get(data.base_generation_id) ?? null : null,
  };
  return c.html(<ExperimentDetailPage path={c.req.path} experiment={experiment} judgments={judgments} />);
});

pages.get('/experiments/:id/ab', async (c) => {
  const id = c.req.param('id');
  const experimentRes = await internalApiRequest(c, `/api/v1/experiments/${id}`);
  if (experimentRes.status === 404) {
    return c.html(<NotFoundPage what="Experiment" />, 404);
  }
  const experiment = (await experimentRes.json()) as ExperimentDetailData;

  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const baselineId = c.req.query('baseline');
  const armId = c.req.query('arm');

  let warning: string | null = null;
  let baselineRun: ExperimentRunRow | null = null;
  let armRun: ExperimentRunRow | null = null;

  if (!baselineId || !armId) {
    warning = 'Select a baseline and an arm run.';
  } else if (baselineId === armId) {
    warning = 'baseline and arm must be different runs.';
  } else {
    const [b, a] = await Promise.all([
      db.prepare('SELECT * FROM experiment_runs WHERE id = ?').bind(baselineId).first<ExperimentRunRow>(),
      db.prepare('SELECT * FROM experiment_runs WHERE id = ?').bind(armId).first<ExperimentRunRow>(),
    ]);
    if (!b || !a) {
      warning = 'Select a baseline and an arm run.';
    } else if (b.experiment_id !== experiment.id || a.experiment_id !== experiment.id) {
      warning = 'baseline / arm run belongs to a different experiment.';
    } else if (!b.batch_id || !a.batch_id) {
      warning = 'baseline and arm runs must both have a batch attached.';
    } else if (b.batch_id === a.batch_id) {
      warning = 'baseline and arm runs share the same batch.';
    } else {
      baselineRun = b;
      armRun = a;
    }
  }

  let pairs: AbPair[] = [];
  let judgedCount = 0;
  let totalSeeds = 0;

  if (baselineRun && armRun) {
    const seedRows = 'SELECT id, seed FROM generations WHERE batch_id = ? AND seed IS NOT NULL ORDER BY created_at ASC, id ASC';
    const [baselineGens, armGens, judgedSeeds] = await Promise.all([
      db.prepare(seedRows).bind(baselineRun.batch_id).all<{ id: string; seed: number }>(),
      db.prepare(seedRows).bind(armRun.batch_id).all<{ id: string; seed: number }>(),
      judgedSeedsForPair(db, baselineRun.id, armRun.id),
    ]);

    // multi-output job の複数枚は先頭の1枚 (created_at, id 昇順) だけを A/B の対象にする。
    const firstBySeed = (rows: { id: string; seed: number }[]): Map<number, string> => {
      const map = new Map<number, string>();
      for (const row of rows) {
        if (!map.has(row.seed)) map.set(row.seed, row.id);
      }
      return map;
    };
    const baselineBySeed = firstBySeed(baselineGens.results ?? []);
    const armBySeed = firstBySeed(armGens.results ?? []);

    const commonSeeds = Array.from(baselineBySeed.keys())
      .filter((seed) => armBySeed.has(seed))
      .sort((x, y) => x - y);

    totalSeeds = commonSeeds.length;
    judgedCount = judgedSeeds.size;

    pairs = commonSeeds
      .filter((seed) => !judgedSeeds.has(seed))
      .map((seed) => {
        const baselineGenId = baselineBySeed.get(seed)!;
        const armGenId = armBySeed.get(seed)!;
        // 表示の左右はブラウザに judgment を推測させないよう毎回サーバー側で決める。
        const baselineOnLeft = Math.random() < 0.5;
        const leftId = baselineOnLeft ? baselineGenId : armGenId;
        const rightId = baselineOnLeft ? armGenId : baselineGenId;
        return {
          seed,
          left: { id: leftId, image_url: generationImageUrl(origin, leftId) },
          right: { id: rightId, image_url: generationImageUrl(origin, rightId) },
        };
      });
  }

  const data: ExperimentAbData = {
    experiment: { id: experiment.id, short_id: experiment.short_id, name: experiment.name },
    baseline_run_id: baselineRun?.id ?? null,
    arm_run_id: armRun?.id ?? null,
    baseline_run_index: baselineRun?.run_index ?? null,
    arm_run_index: armRun?.run_index ?? null,
    warning,
    pairs,
    judged_count: judgedCount,
    total_seeds: totalSeeds,
  };

  return c.html(<ExperimentAbPage path={c.req.path} data={data} />);
});

pages.get('/bookmarks', async (c) => {
  const view = parseGalleryView(c.req.query('view'), 'refined');
  const genParams = new URLSearchParams({ bookmark: 'true', limit: '100' });
  if (view !== 'all') genParams.set('origin', view);

  const [genRes, batchRes, bookmarkedExperiments] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations?${genParams.toString()}`),
    internalApiRequest(c, '/api/v1/batches?bookmark=true&limit=100'),
    listBookmarkedExperiments(c.env.DB),
  ]);
  const genData = (await genRes.json()) as { items: GenerationCardData[] };
  const batchData = (await batchRes.json()) as { items: BatchRowData[] };

  return c.html(
    <BookmarksPage
      path={c.req.path}
      generations={genData.items}
      batches={batchData.items}
      experiments={bookmarkedExperiments}
      view={view}
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

  const jobIds = Array.from(new Set(rows.map(({ row }) => row.comfy_job_id)));
  const jobsById = new Map<string, ComfyJobRow>();
  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(', ');
    const { results } = await c.env.DB.prepare(`SELECT * FROM comfy_jobs WHERE id IN (${placeholders})`)
      .bind(...jobIds)
      .all<ComfyJobRow>();
    for (const j of results ?? []) jobsById.set(j.id, j);
  }
  const renderFactsByGenerationId = new Map(
    await Promise.all(
      rows.map(async ({ row }) => {
        const job = jobsById.get(row.comfy_job_id);
        return [row.id, job ? await renderFactsForJob(c.env.DB, job) : null] as const;
      }),
    ),
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
    render_facts: renderFactsByGenerationId.get(row.id) ?? null,
  }));

  return c.html(<ComparePage path={c.req.path} items={items} missingIds={missingIds} warning={warning} />);
});
