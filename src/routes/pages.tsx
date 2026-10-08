import { Hono, type Context } from 'hono';
import { internalApiRequest } from '../lib/internal-api';
import { getGenerationByIdOrShortId, resolveGenerationShortIds, resolveRequestThumbnails, resolveRunRequests } from '../lib/db';
import { generationImageUrl, generationPreviewUrl } from '../lib/serialize';
import { listBookmarkedExperiments, listWorkSources, WORK_SOURCES_PAGE_SIZE } from '../lib/ui-queries';
import { GalleryPage, GalleryCards, GallerySlotCards, type GalleryFilters, type GalleryItem } from '../ui/pages/Gallery';
import type { GalleryView } from '../ui/components/ViewSwitch';
import { ExperimentsPage, type ExperimentListItem } from '../ui/pages/Experiments';
import { EXPERIMENT_STATUSES } from '../lib/experiment-status';
import { ExperimentDetailPage, type ExperimentDetailData, type ExperimentJudgmentSummary } from '../ui/pages/ExperimentDetail';
import { ExperimentAbPage, type AbPair, type ExperimentAbData } from '../ui/pages/ExperimentAb';
import { judgedSeedsForPair } from '../lib/judgments';
import { BookmarksPage } from '../ui/pages/Bookmarks';
import { ComparePage } from '../ui/pages/Compare';
import { NotFoundPage } from '../ui/pages/NotFound';
import { WorkSourcesPage } from '../ui/pages/WorkSources';
import { WorkbenchPage, type WorkbenchData, type WorkbenchPart } from '../ui/pages/Workbench';
import { buildWorkbenchTree, findRootGeneration, getWorkbench } from '../lib/workbench';
import { StyleCheckPage, type StyleCheckRowView } from '../ui/pages/StyleCheck';
import { decodeCursor, queryGenerations, queryTimeline } from '../lib/generations';
import { slotEndIso, slotStartIso } from '../lib/timeline';
import { buildCompareItems, buildExperimentCompare, parseSeedQuery } from '../lib/compare-items';
import { defaultRecipeRef } from '../lib/requests';
import { STYLE_CHECK_RECIPE, loadStyleCheckRows } from '../lib/style-check';
import {
  findBackdrops,
  findCatalogPose,
  findDeliverBackdropColor,
  findDeliverDefaults,
  findDeliverOutlines,
  findDof,
  findRedrawDefaults,
  findRedrawDials,
  findRedrawLight,
  getCatalog,
} from '../lib/catalogs';
import type { RecipeCatalogDoc } from '../schemas/catalogs';
import type { AppEnv, ExperimentRunRow, GenerationRow } from '../types';
import type { GenerationCardData } from '../ui/components/GenerationCard';

export const pages = new Hono<AppEnv>();

pages.get('/', (c) => c.redirect('/gallery'));

function parseGalleryView(raw: string | undefined, defaultView: GalleryView): GalleryView {
  return raw === 'raw' || raw === 'refined' || raw === 'all' ? raw : defaultView;
}

/** Back 復元で一度に返す件数の上限 (docs/ui.md「Gallery」)。 */
const GALLERY_RESTORE_MAX_ITEMS = 2000;
const GALLERY_RESTORE_CHUNK = 200;
/** `until` にこの値を渡すと、末尾まで読み込み済みだったことを表す (上限までページングする)。 */
const GALLERY_UNTIL_END = 'end';

/**
 * `cursor` から、`until` のカーソルが指す Generation までを1つの結果として返す。
 * `until` は元のページングで使われた next_cursor で、そのカーソルの Generation を含めて返し、
 * 続きの next_cursor は `until` 自身になる。上限に達したらそこまでを返す。
 */
async function loadGalleryThrough(
  c: Context<AppEnv>,
  baseParams: URLSearchParams,
  cursor: string,
  until: string,
): Promise<{ items: GalleryItem[]; total: number; next_cursor: string | null } | Response> {
  const untilId = until === GALLERY_UNTIL_END ? null : decodeCursor(until).id;
  const items: GalleryItem[] = [];
  let total = 0;
  let next: string | null = cursor;
  while (next) {
    const params = new URLSearchParams(baseParams);
    params.set('cursor', next);
    params.set('limit', String(Math.min(GALLERY_RESTORE_CHUNK, GALLERY_RESTORE_MAX_ITEMS - items.length)));
    const res = await internalApiRequest(c, `/api/v1/generations?${params.toString()}`);
    if (!res.ok) return res;
    const data = (await res.json()) as { items: GalleryItem[]; total: number; next_cursor: string | null };
    total = data.total;
    const hit = untilId ? data.items.findIndex((g) => g.id === untilId) : -1;
    if (hit !== -1) {
      items.push(...data.items.slice(0, hit + 1));
      const more = hit < data.items.length - 1 || data.next_cursor !== null;
      return { items, total, next_cursor: more ? until : null };
    }
    items.push(...data.items);
    next = data.next_cursor;
    if (items.length >= GALLERY_RESTORE_MAX_ITEMS) break;
  }
  return { items, total, next_cursor: next };
}

/** 枠範囲 (`slot_from`〜`slot_to`) のカードを新しい順に全件返す。1枠が200件を超えても `GALLERY_RESTORE_MAX_ITEMS` までカーソルで続ける。 */
async function loadGallerySlotRange(
  c: Context<AppEnv>,
  baseParams: URLSearchParams,
  fromIso: string,
  toIso: string,
): Promise<{ items: GalleryItem[] } | Response> {
  const items: GalleryItem[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams(baseParams);
    params.set('from', fromIso);
    params.set('to', toIso);
    params.set('limit', String(Math.min(GALLERY_RESTORE_CHUNK, GALLERY_RESTORE_MAX_ITEMS - items.length)));
    if (cursor) params.set('cursor', cursor);
    const res = await internalApiRequest(c, `/api/v1/generations?${params.toString()}`);
    if (!res.ok) return res;
    const data = (await res.json()) as { items: GalleryItem[]; next_cursor: string | null };
    items.push(...data.items);
    cursor = data.next_cursor;
  } while (cursor && items.length < GALLERY_RESTORE_MAX_ITEMS);
  return { items };
}

pages.get('/gallery', async (c) => {
  const q = c.req.query();

  const view = parseGalleryView(q.view, 'all');
  const bad = q.bad === '1';
  const ids = q.ids?.trim() || undefined;

  const filters: GalleryFilters = {
    view,
    bad,
    ids,
    tag: q.tag || undefined,
    rating: q.rating || undefined,
    bookmark: q.bookmark === 'true' ? 'true' : undefined,
    published: q.published === 'true' ? 'true' : undefined,
    reference: q.reference === 'true' ? 'true' : undefined,
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
  if (filters.published) apiParams.set('published', filters.published);
  if (filters.reference) apiParams.set('reference', filters.reference);
  // タイムライン (docs/ui.md「Gallery」) は一覧と同じ絞り込みで枚数を数える。ids 指定では出さない。
  const timelineQuery = ids ? undefined : apiParams.toString();
  if (!ids && q.partial === '1' && (q.slot_from || q.slot_to)) {
    const fromIso = slotStartIso(q.slot_from ?? '');
    const lastSlotEnd = slotEndIso(q.slot_to ?? '');
    if (!fromIso || !lastSlotEnd || !q.slot_from || !q.slot_to || q.slot_from > q.slot_to) {
      return c.text('slot_from / slot_to must be slot keys (YYYY-MM-DDTHH:MM, slot_from <= slot_to)', 400);
    }
    const toIso = new Date(Date.parse(lastSlotEnd) - 1).toISOString();
    const range = await loadGallerySlotRange(c, apiParams, fromIso, toIso);
    if (range instanceof Response) return range;
    return c.html(<GallerySlotCards items={range.items} />);
  }
  const limit = q.limit ? Math.min(Math.max(Number(q.limit) || 24, 1), 200) : 24;
  apiParams.set('limit', String(limit));
  // after は新しい方向のページ、at は枠の終端より前から始める先頭ページ。どちらも cursor とは併用しない。
  const atEnd = !ids && !q.cursor && !q.after && q.at ? slotEndIso(q.at) : null;
  if (q.after) apiParams.set('after', q.after);
  else if (q.cursor) apiParams.set('cursor', q.cursor);
  else if (atEnd) apiParams.set('created_before', atEnd);

  type GalleryPageData = { items: GalleryItem[]; total: number; next_cursor: string | null; newer_cursor?: string | null };
  let genData: GalleryPageData;
  if (q.cursor && q.until && !q.after) {
    const restored = await loadGalleryThrough(c, apiParams, q.cursor, q.until);
    if (restored instanceof Response) return restored;
    genData = restored;
  } else {
    const genRes = await internalApiRequest(c, `/api/v1/generations?${apiParams.toString()}`);
    if (!genRes.ok) return genRes;
    genData = (await genRes.json()) as GalleryPageData;
  }

  // ids が厳密に1件の既存 Generation に解決したときは detail へ直行する。
  if (ids && genData.total === 1 && genData.items[0]) {
    return c.redirect(`/g/${genData.items[0].short_id}`);
  }

  if (q.partial === '1') {
    return c.html(
      <GalleryCards items={genData.items} nextCursor={genData.next_cursor} newerCursor={genData.newer_cursor ?? null} filters={filters} />,
    );
  }

  const timeline = timelineQuery === undefined ? undefined : await queryTimeline(c.env.DB, Object.fromEntries(new URLSearchParams(timelineQuery)));

  return c.html(
    <GalleryPage
      path={c.req.path}
      items={genData.items}
      nextCursor={genData.next_cursor}
      newerCursor={genData.newer_cursor ?? null}
      filters={filters}
      timelineQuery={timelineQuery}
      timeline={timeline}
      at={atEnd ? q.at : undefined}
    />,
  );
});

// 廃止した Batch ページの URL (Discord などに貼られたもの) を壊さない。Request の short_id から最初の Generation へ飛ばす。
pages.get('/b/:shortId', async (c) => {
  const request = await c.env.DB.prepare('SELECT id FROM requests WHERE short_id = ?')
    .bind(c.req.param('shortId'))
    .first<{ id: string }>();
  const firstGenerationShortId = request ? (await resolveRequestThumbnails(c.env.DB, [request.id])).get(request.id) : undefined;
  if (!firstGenerationShortId) return c.html(<NotFoundPage what="Request" />, 404);
  return c.redirect(`/g/${firstGenerationShortId}`, 302);
});

pages.get('/experiments', async (c) => {
  // 未知の status を転送すると API が 400 を返し描画できなくなるため、候補外は指定なし扱いにする。
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
  const compare = await buildExperimentCompare(
    c.env.DB,
    experiment.runs,
    experiment.base_parameters,
    parseSeedQuery(c.req.query('seed')),
    new URL(c.req.url).origin,
  );
  return c.html(<ExperimentDetailPage path={c.req.path} experiment={experiment} judgments={judgments} compare={compare} />);
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
  let baselineRequestId: string | null = null;
  let armRequestId: string | null = null;

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
    } else {
      const requestByRunId = await resolveRunRequests(db, [b.id, a.id]);
      baselineRequestId = requestByRunId.get(b.id)?.id ?? null;
      armRequestId = requestByRunId.get(a.id)?.id ?? null;
      if (!baselineRequestId || !armRequestId) {
        warning = 'baseline and arm runs must both have a request attached.';
      } else if (baselineRequestId === armRequestId) {
        warning = 'baseline and arm runs share the same request.';
      } else {
        baselineRun = b;
        armRun = a;
      }
    }
  }

  let pairs: AbPair[] = [];
  let judgedCount = 0;
  let totalSeeds = 0;

  if (baselineRun && armRun) {
    const seedRows =
      'SELECT id, seed, original_purged_at FROM generations WHERE request_id = ? AND seed IS NOT NULL ORDER BY created_at ASC, id ASC';
    const [baselineGens, armGens, judgedSeeds] = await Promise.all([
      db.prepare(seedRows).bind(baselineRequestId).all<{ id: string; seed: number; original_purged_at: string | null }>(),
      db.prepare(seedRows).bind(armRequestId).all<{ id: string; seed: number; original_purged_at: string | null }>(),
      judgedSeedsForPair(db, baselineRun.id, armRun.id),
    ]);

    // multi-output job の複数枚は先頭の1枚 (created_at, id 昇順) だけを A/B の対象にする。
    const firstBySeed = (
      rows: { id: string; seed: number; original_purged_at: string | null }[],
    ): Map<number, { id: string; purged: boolean }> => {
      const map = new Map<number, { id: string; purged: boolean }>();
      for (const row of rows) {
        if (!map.has(row.seed)) map.set(row.seed, { id: row.id, purged: row.original_purged_at !== null });
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

    const imageUrlFor = (gen: { id: string; purged: boolean }) =>
      gen.purged ? generationPreviewUrl(origin, gen.id) : generationImageUrl(origin, gen.id);

    pairs = commonSeeds
      .filter((seed) => !judgedSeeds.has(seed))
      .map((seed) => {
        const baselineGen = baselineBySeed.get(seed)!;
        const armGen = armBySeed.get(seed)!;
        // 表示の左右はブラウザに judgment を推測させないよう毎回サーバー側で決める。
        const baselineOnLeft = Math.random() < 0.5;
        const leftGen = baselineOnLeft ? baselineGen : armGen;
        const rightGen = baselineOnLeft ? armGen : baselineGen;
        return {
          seed,
          left: { id: leftGen.id, image_url: imageUrlFor(leftGen) },
          right: { id: rightGen.id, image_url: imageUrlFor(rightGen) },
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

  const [genRes, bookmarkedExperiments] = await Promise.all([
    internalApiRequest(c, `/api/v1/generations?${genParams.toString()}`),
    listBookmarkedExperiments(c.env.DB),
  ]);
  const genData = (await genRes.json()) as { items: GenerationCardData[] };

  return c.html(
    <BookmarksPage
      path={c.req.path}
      generations={genData.items}
      experiments={bookmarkedExperiments}
      view={view}
    />,
  );
});

/** result_json.generation_ids[0] の解決結果を絵柄チェックの GenerationCardData に写す。result_json の形が壊れていても行は落とさず null (「まだ描いていない」と区別するのは呼び出し側)。 */
function resolveDoneGenerationId(request: { status: string; result_json: string | null }): string | null {
  if (request.status !== 'done' || !request.result_json) return null;
  try {
    const parsed = JSON.parse(request.result_json) as { generation_ids?: string[] };
    return parsed.generation_ids?.[0] ?? null;
  } catch {
    return null;
  }
}

pages.get('/check', async (c) => {
  const recipe = STYLE_CHECK_RECIPE;
  const recipeRef = defaultRecipeRef(c.env);
  const catalog = await getCatalog(c.env.DB, recipeRef);
  const gitCommit = catalog?.row.git_commit ?? null;

  const rows = await loadStyleCheckRows(c.env.DB, recipe, recipeRef);

  const pinGenerationIds = rows.map((r) => r.pin?.generation_id).filter((id): id is string => Boolean(id));
  const resultGenerationIds = rows.map((r) => (r.request ? resolveDoneGenerationId(r.request) : null)).filter((id): id is string => Boolean(id));
  const cardIds = Array.from(new Set([...pinGenerationIds, ...resultGenerationIds]));

  const origin = new URL(c.req.url).origin;
  const cardData = cardIds.length > 0 ? await queryGenerations(c.env.DB, { ids: cardIds.join(',') }, origin) : { items: [] };
  const cardById = new Map(cardData.items.map((item) => [item.id, item]));

  const viewRows: StyleCheckRowView[] = rows.map((row) => {
    const pinCard = row.pin ? cardById.get(row.pin.generation_id) ?? null : null;
    let request: StyleCheckRowView['request'] = null;
    if (row.request) {
      const resultId = resolveDoneGenerationId(row.request);
      request = {
        id: row.request.id,
        status: row.request.status,
        error: row.request.error,
        resultCard: resultId ? cardById.get(resultId) ?? null : null,
      };
    }
    return { framing: row.framing, pose: row.pose, pin: pinCard, request };
  });

  return c.html(<StyleCheckPage path={c.req.path} recipe={recipe} gitCommit={gitCommit} rows={viewRows} />);
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

  const missingIds: string[] = [];
  const origin = new URL(c.req.url).origin;

  const rows: GenerationRow[] = [];
  for (const id of idsToUse) {
    const row = await getGenerationByIdOrShortId(c.env.DB, id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    rows.push(row);
  }

  const items = await buildCompareItems(c.env.DB, rows, origin);

  return c.html(<ComparePage path={c.req.path} items={items} missingIds={missingIds} warning={warning} />);
});

pages.get('/work', async (c) => {
  const stateQuery = c.req.query('state');
  const state = stateQuery === 'wip' || stateQuery === 'done' ? stateQuery : undefined;
  const recipe = c.req.query('recipe') || undefined;
  const page = Math.max(Number(c.req.query('page')) || 1, 1);
  const sources = await listWorkSources(c.env.DB, { state, recipe, offset: (page - 1) * WORK_SOURCES_PAGE_SIZE });
  return c.html(
    <WorkSourcesPage path={c.req.path} items={sources.items} recipes={sources.recipes} filters={{ state, recipe, page }} hasMore={sources.hasMore} />,
  );
});

/** The parts of the pose that drew `generationId`, with each part's text when the pose record carries it. */
function workbenchParts(doc: RecipeCatalogDoc, recipe: string, pose: string | null): WorkbenchPart[] {
  const recipeDoc = doc.recipes.find((r: unknown) => (r as { name?: unknown }).name === recipe) as { parts?: unknown } | undefined;
  const names = Array.isArray(recipeDoc?.parts) ? recipeDoc.parts.filter((p): p is string => typeof p === 'string') : [];
  const poseRecord = pose ? (findCatalogPose(doc, recipe, pose) as { parts?: unknown } | null) : null;
  const texts = new Map<string, string>();
  if (poseRecord && Array.isArray(poseRecord.parts)) {
    for (const part of poseRecord.parts as { name?: unknown; text?: unknown }[]) {
      if (part && typeof part.name === 'string' && typeof part.text === 'string') texts.set(part.name, part.text.replace(/[\s,]+$/, '').trim());
    }
  }
  return names.map((name) => ({ name, text: texts.get(name) || null }));
}

pages.get('/work/:shortId', async (c) => {
  const db = c.env.DB;
  const shortId = c.req.param('shortId');
  const generation = await getGenerationByIdOrShortId(db, shortId);
  if (!generation) return c.html(<NotFoundPage what="Generation" />, 404);
  if (generation.refines_generation_id) {
    const root = await findRootGeneration(db, generation);
    return c.redirect(`/work/${root.short_id}?at=${generation.short_id}`);
  }

  const [tree, workbench, detailRes] = await Promise.all([
    buildWorkbenchTree(db, generation),
    getWorkbench(db, generation.id),
    internalApiRequest(c, `/api/v1/generations/${generation.id}`),
  ]);
  const detail = (await detailRes.json()) as { request: { recipe: string | null; drawn_pose: { pose: string } | null } | null };
  const recipe = detail.request?.recipe ?? null;
  const recipeRef = recipe ? defaultRecipeRef(c.env) : null;
  const catalog = recipeRef ? await getCatalog(db, recipeRef) : null;
  const doc = catalog && recipe ? catalog.doc : null;
  const deliverDefaults = doc && recipe ? findDeliverDefaults(doc, recipe) : null;
  const catalogStroke = typeof deliverDefaults?.stroke_light === 'string' ? deliverDefaults.stroke_light : 'even';
  const lightFrom = doc && recipe ? findRedrawLight(doc, recipe) : null;
  const strokeDefault = catalogStroke === 'even' || ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(catalogStroke) ? catalogStroke : 'even';

  const data: WorkbenchData = {
    root: { id: generation.id, short_id: generation.short_id },
    tree,
    picks: workbench.picks,
    at: c.req.query('at') || null,
    redrawDefaults: doc && recipe ? findRedrawDefaults(doc, recipe) : null,
    redrawDials: doc && recipe ? findRedrawDials(doc, recipe) : null,
    light: lightFrom,
    deliverDefaults,
    outlines: doc && recipe ? findDeliverOutlines(doc, recipe) : null,
    strokeDefault,
    backdrops: doc ? findBackdrops(doc).map(({ name, label }) => ({ name, label })) : [],
    recipeRef,
    catalogVersion: catalog?.row.updated_at ?? null,
    backdropColor: doc && recipe ? findDeliverBackdropColor(doc, recipe) : null,
    dof: doc ? findDof(doc) : null,
    parts: doc && recipe ? workbenchParts(doc, recipe, detail.request?.drawn_pose?.pose ?? null) : [],
  };
  return c.html(<WorkbenchPage path={c.req.path} data={data} />);
});
