// REST routes (src/routes/experiments.ts) と MCP tools (src/mcp.ts) が同じ関数を呼び、guardrails/クエリの二重管理を避ける。

import {
  chunk,
  D1_MAX_BOUND_PARAMS,
  getExperimentByIdOrShortId,
  getGenerationByIdOrShortId,
  nowIso,
  resolveRequestThumbnails,
  resolveRunRequests,
  touchExperiment,
} from './db';
import { parseJsonObjectOrNull, type JsonObject } from './overrides';
import { badRequest, conflict, notFound } from './errors';
import { listTagsForTarget } from './tags';
import { isUuid, uuidv7 } from './uuidv7';
import { resolveRequestRenderFacts } from './render-facts';
import { buildRunRequestPayload, canonicalPayloadHash } from './requests';
import { pinPresets } from './presets';
import { createUniqueRequestShortId, createUniqueShortId } from './shortid';
import {
  generationPreviewUrl,
  serializeExperiment,
  serializeExperimentPromotion,
  serializeExperimentRun,
  serializeGenerationLight,
} from './serialize';
import type { ExperimentPromotionRow, ExperimentRow, ExperimentRunRow, ExperimentStatus, GenerationRow } from '../types';

export { touchExperiment };

export async function getExperimentOr404(db: D1Database, idOrShortId: string): Promise<ExperimentRow> {
  const row = await getExperimentByIdOrShortId(db, idOrShortId);
  if (!row) throw notFound('experiment');
  return row;
}

export async function getRunOr404(db: D1Database, id: string): Promise<ExperimentRunRow> {
  const row = await db.prepare('SELECT * FROM experiment_runs WHERE id = ?').bind(id).first<ExperimentRunRow>();
  if (!row) throw notFound('experiment run');
  return row;
}

export async function resolveGenerationOr404(db: D1Database, idOrShortId: string) {
  const generation = await getGenerationByIdOrShortId(db, idOrShortId);
  if (!generation) throw notFound(`generation '${idOrShortId}'`);
  return generation;
}

export async function assertCharacterExists(db: D1Database, characterId: string): Promise<void> {
  const found = await db.prepare('SELECT 1 FROM characters WHERE id = ?').bind(characterId).first();
  if (!found) throw notFound('character');
}

/** short_id / UUID どちらでも受け、他の FK と同様に UUID で保存する。 */
export async function resolveBaseGenerationId(db: D1Database, idOrShortId: string): Promise<string> {
  const generation = await getGenerationByIdOrShortId(db, idOrShortId);
  if (!generation) throw notFound('generation');
  return generation.id;
}

export interface CreateExperimentInput {
  name: string;
  description?: string;
  note?: string;
  base_recipe?: string;
  base_parameters?: JsonObject;
  base_generation_id?: string;
  character_id?: string;
}

/** POST /api/v1/experiments と create_experiment MCP tool が共有する。常に status 'active' で作る。 */
export async function createExperiment(db: D1Database, body: CreateExperimentInput): Promise<ExperimentRow> {
  if (body.character_id) await assertCharacterExists(db, body.character_id);
  const baseGenerationId = body.base_generation_id ? await resolveBaseGenerationId(db, body.base_generation_id) : null;

  const now = nowIso();
  const row: ExperimentRow = {
    id: uuidv7(),
    short_id: await createUniqueShortId(db, 'experiments'),
    name: body.name,
    description: body.description ?? null,
    note: body.note ?? null,
    status: 'active',
    base_recipe: body.base_recipe ?? null,
    base_parameters_json: body.base_parameters ? JSON.stringify(body.base_parameters) : null,
    base_generation_id: baseGenerationId,
    character_id: body.character_id ?? null,
    bookmark: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  await db
    .prepare(
      `INSERT INTO experiments
         (id, short_id, name, description, note, status, base_recipe, base_parameters_json, base_generation_id, character_id, bookmark, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.short_id,
      row.name,
      row.description,
      row.note,
      row.status,
      row.base_recipe,
      row.base_parameters_json,
      row.base_generation_id,
      row.character_id,
      row.bookmark,
      row.created_at,
      row.updated_at,
      row.completed_at,
    )
    .run();
  return row;
}

export async function listRuns(db: D1Database, experimentId: string): Promise<ExperimentRunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM experiment_runs WHERE experiment_id = ? ORDER BY run_index ASC')
    .bind(experimentId)
    .all<ExperimentRunRow>();
  return results ?? [];
}

export async function listPromotions(db: D1Database, experimentId: string): Promise<ExperimentPromotionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM experiment_promotions WHERE experiment_id = ? ORDER BY created_at ASC')
    .bind(experimentId)
    .all<ExperimentPromotionRow>();
  return results ?? [];
}

/** 一覧の「latest result」用。Run 1件あたりの評価全文は返さず overall だけ拾う。 */
export function evaluationOverall(run: ExperimentRunRow): string | null {
  if (!run.evaluation_json) return null;
  try {
    const parsed = JSON.parse(run.evaluation_json) as { overall?: unknown };
    return typeof parsed.overall === 'string' ? parsed.overall : null;
  } catch {
    return null;
  }
}

export async function latestRunByExperiment(
  db: D1Database,
  experimentIds: string[],
): Promise<Map<string, ExperimentRunRow>> {
  const unique = Array.from(new Set(experimentIds));
  const map = new Map<string, ExperimentRunRow>();
  // ROW_NUMBER() は experiment_id ごとに独立して振られるため、チャンク分割しても結果は変わらない。
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT * FROM (
           SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.experiment_id ORDER BY r.run_index DESC) AS rn
           FROM experiment_runs r
           WHERE r.experiment_id IN (${placeholders})
         ) WHERE rn = 1`,
      )
      .bind(...part)
      .all<ExperimentRunRow>();
    for (const r of results ?? []) map.set(r.experiment_id, r);
  }
  return map;
}

/** Run に紐づく結果 Request / Generation を1回のクエリずつで解決する。Generation 未 attach でも Request のサムネイルは出す。 */
export async function decorateRuns(db: D1Database, runs: ExperimentRunRow[], org: string) {
  const generationIds = runs.map((r) => r.generation_id).filter((id): id is string => id !== null);
  const requestByRunId = await resolveRunRequests(
    db,
    runs.map((r) => r.id),
  );
  const requestIds = Array.from(requestByRunId.values()).map((r) => r.id);

  const generationMap = new Map<string, GenerationRow>();
  for (const part of chunk(generationIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM generations WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<GenerationRow>();
    for (const row of results ?? []) generationMap.set(row.id, row);
  }

  const requestThumbnails = await resolveRequestThumbnails(db, requestIds);
  const renderFactsByRequest = await resolveRequestRenderFacts(db, requestIds);

  return runs.map((run) => {
    const request = requestByRunId.get(run.id) ?? null;
    const thumbShortId = request ? requestThumbnails.get(request.id) ?? null : null;
    const generation = run.generation_id ? generationMap.get(run.generation_id) ?? null : null;
    return {
      ...serializeExperimentRun(run),
      request: request
        ? {
            id: request.id,
            short_id: request.short_id,
            thumbnail_url: thumbShortId ? generationPreviewUrl(org, thumbShortId) : null,
            thumbnail_generation_short_id: thumbShortId,
          }
        : null,
      generation: generation ? serializeGenerationLight(generation, org) : null,
      render_facts: request ? renderFactsByRequest.get(request.id) ?? null : null,
    };
  });
}

/** GET /api/v1/experiments/{id} と get_experiment MCP tool が共有する detail 組み立て。 */
export async function getExperimentDetail(db: D1Database, experiment: ExperimentRow, org: string) {
  const [runRows, promotionRows, tags, character] = await Promise.all([
    listRuns(db, experiment.id),
    listPromotions(db, experiment.id),
    listTagsForTarget(db, 'experiment_tags', experiment.id),
    experiment.character_id
      ? db
          .prepare('SELECT id, name FROM characters WHERE id = ?')
          .bind(experiment.character_id)
          .first<{ id: string; name: string }>()
      : Promise.resolve(null),
  ]);

  return {
    ...serializeExperiment(experiment),
    character: character ?? null,
    tags: tags.map((t) => t.name),
    run_count: runRows.length,
    runs: await decorateRuns(db, runRows, org),
    promotions: promotionRows.map(serializeExperimentPromotion),
  };
}

export interface ExperimentRunFamilyMember {
  run_id: string;
  run_index: number;
  request_id: string;
}

export interface ExperimentRunFamily {
  experiment: { id: string; short_id: string; name: string };
  run: { id: string; run_index: number };
  parent: ExperimentRunFamilyMember | null;
  children: ExperimentRunFamilyMember[];
  siblings: ExperimentRunFamilyMember[];
}

/**
 * Generation Detail 用の ExperimentRun 由来の display-only な派生 (`experiment`)。素材参照 / 仕上げ元とは別で、行は作らない。
 * 結果 Request の無い Run はリンク先が無いため親/子/兄弟から除外する。`requestId` がその Run の結果 Request でなければ null。
 */
export async function getExperimentRunFamily(db: D1Database, requestId: string): Promise<ExperimentRunFamily | null> {
  const run = await db
    .prepare(
      `SELECT r.id, r.run_index, r.parent_run_id, r.experiment_id,
         e.short_id AS experiment_short_id, e.name AS experiment_name
       FROM requests x
       JOIN experiment_runs r ON r.id = x.run_id
       JOIN experiments e ON e.id = r.experiment_id
       WHERE x.id = ? AND x.kind IN ('generate', 'import')
       LIMIT 1`,
    )
    .bind(requestId)
    .first<{
      id: string;
      run_index: number;
      parent_run_id: string | null;
      experiment_id: string;
      experiment_short_id: string;
      experiment_name: string;
    }>();
  if (!run) return null;

  const { results } = await db
    .prepare('SELECT id, run_index, parent_run_id FROM experiment_runs WHERE experiment_id = ? ORDER BY run_index ASC')
    .bind(run.experiment_id)
    .all<{ id: string; run_index: number; parent_run_id: string | null }>();
  const allRuns = results ?? [];
  const resultByRun = await resolveRunRequests(db, allRuns.map((r) => r.id));
  if (resultByRun.get(run.id)?.id !== requestId) return null;

  const member = (r: { id: string; run_index: number }): ExperimentRunFamilyMember | null => {
    const result = resultByRun.get(r.id);
    return result ? { run_id: r.id, run_index: r.run_index, request_id: result.id } : null;
  };
  const byId = new Map(allRuns.map((r) => [r.id, r]));

  const parentRow = run.parent_run_id ? byId.get(run.parent_run_id) : undefined;
  const parent = parentRow ? member(parentRow) : null;
  const children = allRuns
    .filter((r) => r.parent_run_id === run.id)
    .map(member)
    .filter((m): m is ExperimentRunFamilyMember => m !== null);
  const excludedIds = new Set([run.id, parent?.run_id, ...children.map((c) => c.run_id)].filter((id): id is string => !!id));
  const siblings = allRuns
    .filter((r) => !excludedIds.has(r.id))
    .map(member)
    .filter((m): m is ExperimentRunFamilyMember => m !== null);

  return {
    experiment: { id: run.experiment_id, short_id: run.experiment_short_id, name: run.experiment_name },
    run: { id: run.id, run_index: run.run_index },
    parent,
    children,
    siblings,
  };
}

export interface ExperimentListFilters {
  status?: ExperimentStatus;
  character?: string;
  bookmark?: boolean;
}

export type ExperimentListRow = ExperimentRow & { character_name: string | null; run_count: number };

/** GET /api/v1/experiments と list_experiments MCP tool が共有するクエリ。 */
export async function queryExperiments(
  db: D1Database,
  filters: ExperimentListFilters,
  limit: number,
  offset: number,
): Promise<ExperimentListRow[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (filters.status) {
    conditions.push('e.status = ?');
    binds.push(filters.status);
  }
  if (filters.character) {
    if (isUuid(filters.character)) {
      conditions.push('e.character_id = ?');
      binds.push(filters.character);
    } else {
      conditions.push('e.character_id IN (SELECT id FROM characters WHERE name = ?)');
      binds.push(filters.character);
    }
  }
  if (filters.bookmark) conditions.push('e.bookmark = 1');
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await db
    .prepare(
      `SELECT e.*, ch.name AS character_name,
         (SELECT COUNT(*) FROM experiment_runs r WHERE r.experiment_id = e.id) AS run_count
       FROM experiments e
       LEFT JOIN characters ch ON ch.id = e.character_id
       ${where}
       ORDER BY e.updated_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<ExperimentListRow>();
  return results ?? [];
}

/** run + 所属 Experiment の軽量コンテキスト。REST GET /experiment-runs/{id} と get_run MCP tool が共有する。 */
export async function getRunWithExperimentContext(db: D1Database, run: ExperimentRunRow, org: string) {
  const experiment = await getExperimentOr404(db, run.experiment_id);
  const [decorated] = await decorateRuns(db, [run], org);
  return { decorated: decorated!, experiment };
}

/** Run の結果 Request に属する Generation の軽量表現一覧（get_run MCP tool 用）。 */
export async function listGenerationsLightForRun(db: D1Database, runId: string, org: string) {
  const { results } = await db
    .prepare(
      `SELECT * FROM generations
       WHERE request_id = (SELECT x.id FROM requests x WHERE x.run_id = ?1 AND x.status = 'done' AND x.kind IN ('generate', 'import')
                           ORDER BY x.created_at DESC, x.id DESC LIMIT 1)
       ORDER BY created_at ASC`,
    )
    .bind(runId)
    .all<GenerationRow>();
  return (results ?? []).map((g) => serializeGenerationLight(g, org));
}

export interface CreateExperimentRunInput {
  overrides?: JsonObject;
  objective?: string;
  parent_run_id?: string;
  generation_id?: string;
  evaluation?: JsonObject;
  decision?: JsonObject;
  note?: string;
  idempotency_key?: string;
  variables?: Record<string, string | number>;
}

export interface CreateExperimentRunResult {
  row: ExperimentRunRow;
  /** false ならキーの再送で既存 Run をそのまま返した（何も作成・更新していない）。 */
  created: boolean;
  /** 自動起票された requests 行の id。base_recipe の無い Experiment では null。 */
  request_id: string | null;
}

async function findRunByIdempotencyKey(db: D1Database, key: string): Promise<ExperimentRunRow | null> {
  return db.prepare('SELECT * FROM experiment_runs WHERE idempotency_key = ?').bind(key).first<ExperimentRunRow>();
}

/** Run 作成時に自動起票された requests 行（あれば1件だけ、`run:{run_id}` が unique）。 */
async function findAutoRequestIdForRun(db: D1Database, runId: string): Promise<string | null> {
  const row = await db.prepare('SELECT id FROM requests WHERE run_id = ? LIMIT 1').bind(runId).first<{ id: string }>();
  return row?.id ?? null;
}

/** POST /api/v1/experiments/{id}/runs と create_run MCP tool が共有する。 */
export interface CreateExperimentRunOptions {
  /** 自動起票する requests 行の recipe_ref。呼び出し側が defaultRecipeRef(env) を渡す。 */
  recipeRef?: string;
}

export async function createExperimentRun(
  db: D1Database,
  experiment: ExperimentRow,
  body: CreateExperimentRunInput,
  options: CreateExperimentRunOptions = {},
): Promise<CreateExperimentRunResult> {
  if (body.idempotency_key) {
    const existing = await findRunByIdempotencyKey(db, body.idempotency_key);
    if (existing) {
      // 別 Experiment の Run で使われ済みのキーは黙って再利用せず衝突として拒否する。
      if (existing.experiment_id !== experiment.id) {
        throw conflict(
          `idempotency_key already used by a run under a different experiment (${existing.experiment_id})`,
        );
      }
      return { row: existing, created: false, request_id: await findAutoRequestIdForRun(db, existing.id) };
    }
  }

  let parentRunId: string | null = null;
  if (body.parent_run_id) {
    const parent = await getRunOr404(db, body.parent_run_id);
    if (parent.experiment_id !== experiment.id) {
      throw badRequest('parent_run_id belongs to a different experiment');
    }
    parentRunId = parent.id;
  }

  // 代表 Generation は Run の結果 Request から出たものに限る。作成時点の Run には結果がまだ無いので、後から PATCH で付ける。
  if (body.generation_id) {
    await resolveGenerationOr404(db, body.generation_id);
    throw conflict('run has no request result yet; attach a generation after the run request is done');
  }

  const now = nowIso();
  const id = uuidv7();

  // docs/worker-protocol.md「ExperimentRun 由来の generate」。既存 Run へは遡って起票しない。
  const shouldAutoCreateRequest =
    experiment.base_recipe !== null &&
    (experiment.status === 'active' || experiment.status === 'stabilized');
  let requestId: string | null = null;
  let requestShortId: string | null = null;
  let requestPayloadJson: string | null = null;
  let requestPayloadHash: string | null = null;
  if (shouldAutoCreateRequest) {
    // run_index は下の INSERT ... SELECT が確定する採番の正本。ここでの概算値は payload の
    // instruction フォールバックにしか使わないため、同時作成によるズレは許容する。
    const countRow = await db
      .prepare('SELECT COUNT(*) AS c FROM experiment_runs WHERE experiment_id = ?')
      .bind(experiment.id)
      .first<{ c: number }>();
    const approxRunForPayload: ExperimentRunRow = {
      id,
      experiment_id: experiment.id,
      run_index: (countRow?.c ?? 0) + 1,
      parent_run_id: parentRunId,
      generation_id: null,
      overrides_json: JSON.stringify(body.overrides ?? {}),
      objective: body.objective ?? null,
      evaluation_json: null,
      decision_json: null,
      note: body.note ?? null,
      idempotency_key: body.idempotency_key ?? null,
      variables_json: null,
      created_at: now,
      updated_at: now,
    };
    // pinPresets は payload_hash を取る前に適用する（docs/worker-protocol.md「preset の pin」、createRequest と同じ規則でないと同内容が別 hash になる）。
    const payload = await pinPresets(db, buildRunRequestPayload(experiment, approxRunForPayload));
    requestId = uuidv7();
    requestShortId = await createUniqueRequestShortId(db);
    requestPayloadJson = JSON.stringify(payload);
    requestPayloadHash = await canonicalPayloadHash('generate', payload);
  }

  // 採番を SELECT MAX → INSERT の2ステップに分けると同時 create が同じ次番号を読み UNIQUE 違反になるため、1文の atomic statement にする。
  const runInsertStatement = db
    .prepare(
      `INSERT INTO experiment_runs
         (id, experiment_id, run_index, parent_run_id, generation_id, overrides_json,
          objective, evaluation_json, decision_json, note, idempotency_key, variables_json, created_at, updated_at)
       SELECT ?, ?, COALESCE(MAX(run_index), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM experiment_runs WHERE experiment_id = ?`,
    )
    .bind(
      id,
      experiment.id,
      parentRunId,
      null,
      JSON.stringify(body.overrides ?? {}),
      body.objective ?? null,
      body.evaluation ? JSON.stringify(body.evaluation) : null,
      body.decision ? JSON.stringify(body.decision) : null,
      body.note ?? null,
      body.idempotency_key ?? null,
      body.variables ? JSON.stringify(body.variables) : null,
      now,
      now,
      experiment.id,
    );

  const statements = [runInsertStatement];
  if (shouldAutoCreateRequest && requestId && requestPayloadJson && requestPayloadHash) {
    statements.push(
      db
        .prepare(
          `INSERT INTO requests (
             id, kind, status, payload_json, payload_hash, recipe_ref, run_id, worker_id, attempt, max_attempts,
             claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at,
             short_id
           ) VALUES (?, 'generate', 'queued', ?, ?, ?, ?, NULL, 0, 3, NULL, NULL, NULL, NULL, NULL, ?, 'system', ?, ?, ?)`,
        )
        .bind(requestId, requestPayloadJson, requestPayloadHash, options.recipeRef ?? 'production', id, `run:${id}`, now, now, requestShortId),
    );
  }

  try {
    // Run の INSERT と requests 行の INSERT を1つの db.batch (= 1トランザクション) に
    // することで、片方だけが残る状態を作らない。
    await db.batch(statements);
  } catch (err) {
    // 同じキーでの同時 create が両方この INSERT まで進み、片方が UNIQUE
    // (idempotency_key) で失敗するレース。先に確定した側の行を読み直して返す。
    if (body.idempotency_key && err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      const raced = await findRunByIdempotencyKey(db, body.idempotency_key);
      if (raced) return { row: raced, created: false, request_id: await findAutoRequestIdForRun(db, raced.id) };
    }
    throw err;
  }
  await touchExperiment(db, experiment.id, now);

  return { row: await getRunOr404(db, id), created: true, request_id: requestId };
}

export interface ExperimentArmInput {
  label: string;
  instruction?: string;
  patches?: JsonObject[];
}

export interface CreateExperimentWithArmsInput {
  experiment: CreateExperimentInput;
  arms: ExperimentArmInput[];
  /** arm ごとの Run には `${idempotency_key}:arm:${index}` を使う。 */
  idempotency_key: string;
}

export interface ExperimentArmRun {
  row: ExperimentRunRow;
  arm: string;
  request_id: string | null;
  /** この呼び出しで新規に作った Run か（通知対象の判定に使う）。 */
  created: boolean;
}

function armIdempotencyKey(key: string, index: number): string {
  return `${key}:arm:${index}`;
}

/** 既存 Run の variables.arm。arm 由来でない Run は null。 */
function armLabelOf(run: ExperimentRunRow): string | null {
  const variables = parseJsonObjectOrNull(run.variables_json);
  return typeof variables?.arm === 'string' ? variables.arm : null;
}

/**
 * create_experiment MCP tool の本体: Experiment を作り、arm ごとに Run を1件ずつ順に作る（Run 作成が request を自動起票する）。
 * arm 0 の Run が既にあれば再送とみなし、Experiment を作り直さずに足りない arm だけを補う。
 * 既存の arm 構成が今回の arms と食い違うなら 409。
 */
export async function createExperimentWithArms(
  db: D1Database,
  input: CreateExperimentWithArmsInput,
  options: CreateExperimentRunOptions = {},
): Promise<{ experiment: ExperimentRow; runs: ExperimentArmRun[]; created: boolean }> {
  const { arms, idempotency_key: key } = input;
  const first = await findRunByIdempotencyKey(db, armIdempotencyKey(key, 0));

  let experiment: ExperimentRow;
  if (first) {
    experiment = await getExperimentOr404(db, first.experiment_id);
    const prefix = `${key}:arm:`;
    const armRuns = (await listRuns(db, experiment.id)).filter((r) => r.idempotency_key?.startsWith(prefix));
    const existingByKey = new Map(armRuns.map((r) => [r.idempotency_key, r]));
    const matches =
      existingByKey.size <= arms.length &&
      arms.every((arm, i) => {
        const existing = existingByKey.get(armIdempotencyKey(key, i));
        return !existing || armLabelOf(existing) === arm.label;
      }) &&
      Array.from(existingByKey.keys()).every((k) => arms.some((_, i) => armIdempotencyKey(key, i) === k));
    if (!matches) {
      throw conflict(`idempotency_key '${key}' was already used for a different set of arms`);
    }
  } else {
    experiment = await createExperiment(db, input.experiment);
  }

  const runs: ExperimentArmRun[] = [];
  for (const [index, arm] of arms.entries()) {
    const result = await createExperimentRun(
      db,
      experiment,
      {
        overrides: { patches: arm.patches ?? [] },
        objective: arm.instruction ?? arm.label,
        variables: { arm: arm.label },
        idempotency_key: armIdempotencyKey(key, index),
      },
      options,
    );
    runs.push({ row: result.row, arm: arm.label, request_id: result.request_id, created: result.created });
  }
  return { experiment, runs, created: first === null };
}

export interface UpdateExperimentRunInput {
  overrides?: JsonObject;
  objective?: string | null;
  generation_id?: string;
  evaluation?: JsonObject | null;
  decision?: JsonObject | null;
  note?: string | null;
  variables?: Record<string, string | number> | null;
}

/**
 * PATCH /api/v1/experiment-runs/{id} と attach_generation / set_evaluation / set_decision MCP tools が共有する。
 * undefined は「変更しない」の意味（REST の PATCH と同じ）。
 */
export async function updateExperimentRun(
  db: D1Database,
  run: ExperimentRunRow,
  body: UpdateExperimentRunInput,
): Promise<ExperimentRunRow> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if (body.overrides !== undefined) {
    // 生成結果が付いた Run の overrides を書き換えると「何がその画像を生んだか」の
    // 記録が失われる。付け替えたい場合は新しい Run を作る。
    if (run.generation_id || (await resolveRunRequests(db, [run.id])).has(run.id)) {
      throw conflict('overrides cannot be changed after a request result or generation is attached; create a new run instead');
    }
    assign('overrides_json', JSON.stringify(body.overrides));
  }
  if (body.generation_id !== undefined) {
    const generation = await resolveGenerationOr404(db, body.generation_id);
    if (run.generation_id && run.generation_id !== generation.id) {
      throw conflict('run already has a generation attached');
    }
    const owner = await db
      .prepare('SELECT run_id FROM requests WHERE id = ?')
      .bind(generation.request_id)
      .first<{ run_id: string | null }>();
    if (owner?.run_id !== run.id) {
      const resolved = await resolveRunRequests(db, [run.id]);
      throw conflict(
        resolved.has(run.id)
          ? `generation belongs to request ${generation.request_id}, not the run's request`
          : 'run has no request result yet; attach a generation after the run request is done',
      );
    }
    assign('generation_id', generation.id);
  }
  if (body.objective !== undefined) assign('objective', body.objective);
  if (body.evaluation !== undefined) {
    assign('evaluation_json', body.evaluation === null ? null : JSON.stringify(body.evaluation));
  }
  if (body.decision !== undefined) {
    assign('decision_json', body.decision === null ? null : JSON.stringify(body.decision));
  }
  if (body.note !== undefined) assign('note', body.note);
  // overrides と違い、variables は「グラフに現れない factor の注記」であって provenance
  // ではないので generation 付与後も自由に書き換えられる。
  if (body.variables !== undefined) {
    assign('variables_json', body.variables === null ? null : JSON.stringify(body.variables));
  }

  const now = nowIso();
  assign('updated_at', now);
  binds.push(run.id);
  await db.prepare(`UPDATE experiment_runs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  await touchExperiment(db, run.experiment_id, now);

  return getRunOr404(db, run.id);
}

export interface PendingRunRow extends ExperimentRunRow {
  experiment_short_id: string;
  experiment_name: string;
  experiment_status: ExperimentStatus;
  experiment_base_recipe: string | null;
  experiment_base_parameters_json: string | null;
  experiment_base_generation_id: string | null;
}

/**
 * GET /api/v1/experiment-runs?pending=true の唯一の実装。requests が自動起票されなかった
 * Run を Experiment 横断で拾う。abandoned / promoted な Experiment の Run は除く。
 */
export async function listPendingRuns(db: D1Database, limit: number, offset: number): Promise<PendingRunRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, e.short_id AS experiment_short_id, e.name AS experiment_name, e.status AS experiment_status,
         e.base_recipe AS experiment_base_recipe, e.base_parameters_json AS experiment_base_parameters_json,
         e.base_generation_id AS experiment_base_generation_id
       FROM experiment_runs r
       JOIN experiments e ON e.id = r.experiment_id
       WHERE e.status IN ('active', 'stabilized')
         AND NOT EXISTS (SELECT 1 FROM requests q WHERE q.run_id = r.id)
       ORDER BY r.created_at ASC, r.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<PendingRunRow>();
  return results ?? [];
}

export function serializePendingRun(row: PendingRunRow) {
  return {
    ...serializeExperimentRun(row),
    experiment: {
      id: row.experiment_id,
      short_id: row.experiment_short_id,
      name: row.experiment_name,
      status: row.experiment_status,
      base_recipe: row.experiment_base_recipe,
      base_parameters: parseJsonObjectOrNull(row.experiment_base_parameters_json),
      base_generation_id: row.experiment_base_generation_id,
    },
  };
}
