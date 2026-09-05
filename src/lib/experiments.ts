// Experiment / ExperimentRun のクエリと更新ロジック。REST routes (src/routes/experiments.ts)
// と MCP tools (src/mcp.ts) の両方が同じ関数を呼ぶことで、guardrails (409/404) や
// クエリを二重に持たないようにする。

import {
  chunk,
  D1_MAX_BOUND_PARAMS,
  getBatchByIdOrShortId,
  getExperimentByIdOrShortId,
  getGenerationByIdOrShortId,
  nowIso,
  resolveBatchThumbnails,
  touchExperiment,
} from './db';
import { parseJsonObjectOrNull, type JsonObject } from './overrides';
import { badRequest, conflict, notFound } from './errors';
import { listTagsForTarget } from './tags';
import { isUuid, uuidv7 } from './uuidv7';
import { resolveBatchRenderFacts } from './render-facts';
import { buildRunRequestPayload, canonicalPayloadHash } from './requests';
import {
  generationImageUrl,
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

export async function resolveBatchOr404(db: D1Database, idOrShortId: string) {
  const batch = await getBatchByIdOrShortId(db, idOrShortId);
  if (!batch) throw notFound(`batch '${idOrShortId}'`);
  return batch;
}

export async function resolveGenerationOr404(db: D1Database, idOrShortId: string) {
  const generation = await getGenerationByIdOrShortId(db, idOrShortId);
  if (!generation) throw notFound(`generation '${idOrShortId}'`);
  return generation;
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
  // ROW_NUMBER() は experiment_id ごとに独立して振られるので、チャンクをまたいでも
  // (互いに素な experiment_id の集合を投げているため) 結果は変わらない。
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

/**
 * Run に紐づく Batch / Generation を1回のクエリずつで解決する。Generation
 * 未 attach でも Batch の代表 Generation をサムネイルに使えるようにする。
 */
export async function decorateRuns(db: D1Database, runs: ExperimentRunRow[], org: string) {
  const batchIds = runs.map((r) => r.batch_id).filter((id): id is string => id !== null);
  const generationIds = runs.map((r) => r.generation_id).filter((id): id is string => id !== null);

  const batchMap = new Map<string, { id: string; short_id: string }>();
  for (const part of chunk(batchIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id FROM batches WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<{ id: string; short_id: string }>();
    for (const row of results ?? []) batchMap.set(row.id, row);
  }

  const generationMap = new Map<string, GenerationRow>();
  for (const part of chunk(generationIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM generations WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<GenerationRow>();
    for (const row of results ?? []) generationMap.set(row.id, row);
  }

  const batchThumbnails = await resolveBatchThumbnails(db, batchIds);
  const renderFactsByBatch = await resolveBatchRenderFacts(db, batchIds);

  return runs.map((run) => {
    const batch = run.batch_id ? batchMap.get(run.batch_id) ?? null : null;
    const thumbShortId = run.batch_id ? batchThumbnails.get(run.batch_id) ?? null : null;
    const generation = run.generation_id ? generationMap.get(run.generation_id) ?? null : null;
    return {
      ...serializeExperimentRun(run),
      batch: batch
        ? {
            id: batch.id,
            short_id: batch.short_id,
            thumbnail_url: thumbShortId ? generationImageUrl(org, thumbShortId) : null,
          }
        : null,
      generation: generation ? serializeGenerationLight(generation, org) : null,
      render_facts: run.batch_id ? renderFactsByBatch.get(run.batch_id) ?? null : null,
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

/** Batch に属する Generation の軽量表現一覧（get_run MCP tool 用）。 */
export async function listGenerationsLightForBatch(db: D1Database, batchId: string, org: string) {
  const { results } = await db
    .prepare('SELECT * FROM generations WHERE batch_id = ? ORDER BY created_at ASC')
    .bind(batchId)
    .all<GenerationRow>();
  return (results ?? []).map((g) => serializeGenerationLight(g, org));
}

export interface CreateExperimentRunInput {
  overrides?: JsonObject;
  objective?: string;
  parent_run_id?: string;
  batch_id?: string;
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
export async function createExperimentRun(
  db: D1Database,
  experiment: ExperimentRow,
  body: CreateExperimentRunInput,
): Promise<CreateExperimentRunResult> {
  if (body.idempotency_key) {
    const existing = await findRunByIdempotencyKey(db, body.idempotency_key);
    if (existing) {
      // このキーは既に別の Experiment の Run で使われている。「無ければ作る」の
      // 意味論を保つには、ここで黙って再利用するのではなく衝突として拒否する。
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

  const batchId = body.batch_id ? (await resolveBatchOr404(db, body.batch_id)).id : null;
  // 代表 Generation は Run 自身の Batch から選ぶもの。updateExperimentRun と同じ規則を
  // 作成時にも適用しないと、こちらの経路から provenance の合わない紐付けが入る。
  let generationId: string | null = null;
  if (body.generation_id) {
    const generation = await resolveGenerationOr404(db, body.generation_id);
    if (!batchId) {
      throw conflict('run has no batch attached; attach a batch before attaching a generation');
    }
    if (generation.batch_id !== batchId) {
      throw conflict(
        `generation belongs to batch ${generation.batch_id}, not the run's batch ${batchId}`,
      );
    }
    generationId = generation.id;
  }

  const now = nowIso();
  const id = uuidv7();

  // base_recipe があり status が active/stabilized の Experiment だけ、Run 作成と
  // 同じトランザクションで kind=generate の requests 行を自動起票する
  // (worker-protocol.md「ExperimentRun 由来の generate」)。base_recipe の無い
  // Experiment に後から付けても、既存 Run へは遡って起票しない。batch_id 付きで
  // 作られた Run は実行済みの記録なので起票しない。
  const shouldAutoCreateRequest =
    experiment.base_recipe !== null &&
    batchId === null &&
    (experiment.status === 'active' || experiment.status === 'stabilized');
  let requestId: string | null = null;
  let requestPayloadJson: string | null = null;
  let requestPayloadHash: string | null = null;
  if (shouldAutoCreateRequest) {
    // run_index は下の INSERT ... SELECT が確定する採番の正本。ここでの概算値は
    // 自動起票する payload の instruction 文言 (objective 未指定時のフォールバック)
    // にしか使わないため、同時作成による多少のズレは許容する。
    const countRow = await db
      .prepare('SELECT COUNT(*) AS c FROM experiment_runs WHERE experiment_id = ?')
      .bind(experiment.id)
      .first<{ c: number }>();
    const approxRunForPayload: ExperimentRunRow = {
      id,
      experiment_id: experiment.id,
      run_index: (countRow?.c ?? 0) + 1,
      parent_run_id: parentRunId,
      batch_id: batchId,
      generation_id: generationId,
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
    const payload = buildRunRequestPayload(experiment, approxRunForPayload);
    requestId = uuidv7();
    requestPayloadJson = JSON.stringify(payload);
    requestPayloadHash = await canonicalPayloadHash('generate', payload);
  }

  // run_index の採番を SELECT MAX(...) → INSERT の2ステップに分けると、同じ Experiment への
  // 同時 create が同じ次番号を読み、片方が UNIQUE (experiment_id, run_index) で失敗する。
  // 採番を INSERT ... SELECT の1文に埋め込み、MAX の読み取りと確定を単一の atomic statement にする。
  const runInsertStatement = db
    .prepare(
      `INSERT INTO experiment_runs
         (id, experiment_id, run_index, parent_run_id, batch_id, generation_id, overrides_json,
          objective, evaluation_json, decision_json, note, idempotency_key, variables_json, created_at, updated_at)
       SELECT ?, ?, COALESCE(MAX(run_index), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM experiment_runs WHERE experiment_id = ?`,
    )
    .bind(
      id,
      experiment.id,
      parentRunId,
      batchId,
      generationId,
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
             claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at
           ) VALUES (?, 'generate', 'queued', ?, ?, 'production', ?, NULL, 0, 3, NULL, NULL, NULL, NULL, NULL, ?, 'system', ?, ?)`,
        )
        .bind(requestId, requestPayloadJson, requestPayloadHash, id, `run:${id}`, now, now),
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

export interface UpdateExperimentRunInput {
  overrides?: JsonObject;
  objective?: string | null;
  batch_id?: string;
  generation_id?: string;
  evaluation?: JsonObject | null;
  decision?: JsonObject | null;
  note?: string | null;
  variables?: Record<string, string | number> | null;
}

/**
 * PATCH /api/v1/experiment-runs/{id} と attach_generation / set_evaluation / set_decision
 * MCP tools が共有する。呼び出し側は「更新したいフィールドだけ」を渡す
 * （undefined は「このフィールドは変更しない」の意味、REST の PATCH と同じ）。
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
    if (run.batch_id || run.generation_id) {
      throw conflict('overrides cannot be changed after a batch or generation is attached; create a new run instead');
    }
    assign('overrides_json', JSON.stringify(body.overrides));
  }
  // generation_id の妥当性チェックは batch_id の解決後に行う必要がある: 同じ PATCH で
  // batch_id と generation_id を両方渡した場合、Generation は「これから設定される Batch」
  // (= effectiveBatchId) に対して検証されるべきで、Run に元々ついていた Batch ではない。
  let effectiveBatchId = run.batch_id;
  if (body.batch_id !== undefined) {
    const batch = await resolveBatchOr404(db, body.batch_id);
    if (run.batch_id && run.batch_id !== batch.id) {
      throw conflict('run already has a batch attached');
    }
    assign('batch_id', batch.id);
    effectiveBatchId = batch.id;
  }
  if (body.generation_id !== undefined) {
    const generation = await resolveGenerationOr404(db, body.generation_id);
    if (run.generation_id && run.generation_id !== generation.id) {
      throw conflict('run already has a generation attached');
    }
    // Run の代表 Generation はその Run 自身の Batch から出たものでなければ、
    // 何が何を生んだかという provenance が壊れる。
    if (!effectiveBatchId) {
      throw conflict('run has no batch attached; attach a batch before attaching a generation');
    }
    if (generation.batch_id !== effectiveBatchId) {
      throw conflict(
        `generation belongs to batch ${generation.batch_id}, not the run's batch ${effectiveBatchId}`,
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
  // ではないので batch/generation 付与後も自由に書き換えられる。
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
}

/**
 * GET /api/v1/experiment-runs?pending=true の唯一の実装。`batch_id` が null かつ
 * requests 行を持たない Run を Experiment 横断で拾う（base_recipe の無い
 * Experiment の Run など、requests が自動起票されなかったもの）。abandoned /
 * promoted な Experiment の Run は拾わない（docs/experiment-agent.md 参照）。
 */
export async function listPendingRuns(db: D1Database, limit: number, offset: number): Promise<PendingRunRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, e.short_id AS experiment_short_id, e.name AS experiment_name, e.status AS experiment_status,
         e.base_recipe AS experiment_base_recipe, e.base_parameters_json AS experiment_base_parameters_json
       FROM experiment_runs r
       JOIN experiments e ON e.id = r.experiment_id
       WHERE r.batch_id IS NULL AND e.status IN ('active', 'stabilized')
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
    },
  };
}
