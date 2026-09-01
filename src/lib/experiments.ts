// Experiment / ExperimentRun のクエリと更新ロジック。REST routes (src/routes/experiments.ts)
// と MCP tools (src/mcp.ts) の両方が同じ関数を呼ぶことで、guardrails (409/404) や
// クエリを二重に持たないようにする。

import {
  getBatchByIdOrShortId,
  getExperimentByIdOrShortId,
  getGenerationByIdOrShortId,
  nowIso,
  resolveBatchThumbnails,
} from './db';
import { parseJsonObjectOrNull, type JsonObject } from './overrides';
import { badRequest, conflict, notFound } from './errors';
import { listTagsForTarget } from './tags';
import { isUuid, uuidv7 } from './uuidv7';
import {
  generationImageUrl,
  serializeExperiment,
  serializeExperimentPromotion,
  serializeExperimentRun,
  serializeGenerationLight,
} from './serialize';
import type { ExperimentPromotionRow, ExperimentRow, ExperimentRunRow, ExperimentStatus, GenerationRow } from '../types';

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

/** Run / Promotion の追加・更新も Experiment の「最終活動時刻」なので updated_at を進める。 */
export async function touchExperiment(db: D1Database, experimentId: string, at: string): Promise<void> {
  await db.prepare('UPDATE experiments SET updated_at = ? WHERE id = ?').bind(at, experimentId).run();
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
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.experiment_id ORDER BY r.run_index DESC) AS rn
         FROM experiment_runs r
         WHERE r.experiment_id IN (${placeholders})
       ) WHERE rn = 1`,
    )
    .bind(...unique)
    .all<ExperimentRunRow>();
  return new Map((results ?? []).map((r) => [r.experiment_id, r]));
}

/**
 * Run に紐づく Batch / Generation を1回のクエリずつで解決する。Generation
 * 未 attach でも Batch の代表 Generation をサムネイルに使えるようにする。
 */
export async function decorateRuns(db: D1Database, runs: ExperimentRunRow[], org: string) {
  const batchIds = runs.map((r) => r.batch_id).filter((id): id is string => id !== null);
  const generationIds = runs.map((r) => r.generation_id).filter((id): id is string => id !== null);

  const batchMap = new Map<string, { id: string; short_id: string }>();
  if (batchIds.length > 0) {
    const placeholders = batchIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id FROM batches WHERE id IN (${placeholders})`)
      .bind(...batchIds)
      .all<{ id: string; short_id: string }>();
    for (const row of results ?? []) batchMap.set(row.id, row);
  }

  const generationMap = new Map<string, GenerationRow>();
  if (generationIds.length > 0) {
    const placeholders = generationIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM generations WHERE id IN (${placeholders})`)
      .bind(...generationIds)
      .all<GenerationRow>();
    for (const row of results ?? []) generationMap.set(row.id, row);
  }

  const batchThumbnails = await resolveBatchThumbnails(db, batchIds);

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
}

/** POST /api/v1/experiments/{id}/runs と create_run MCP tool が共有する。 */
export async function createExperimentRun(
  db: D1Database,
  experiment: ExperimentRow,
  body: CreateExperimentRunInput,
): Promise<ExperimentRunRow> {
  let parentRunId: string | null = null;
  if (body.parent_run_id) {
    const parent = await getRunOr404(db, body.parent_run_id);
    if (parent.experiment_id !== experiment.id) {
      throw badRequest('parent_run_id belongs to a different experiment');
    }
    parentRunId = parent.id;
  }

  const batchId = body.batch_id ? (await resolveBatchOr404(db, body.batch_id)).id : null;
  const generationId = body.generation_id ? (await resolveGenerationOr404(db, body.generation_id)).id : null;

  const next = await db
    .prepare('SELECT COALESCE(MAX(run_index), 0) + 1 AS next FROM experiment_runs WHERE experiment_id = ?')
    .bind(experiment.id)
    .first<{ next: number }>();

  const now = nowIso();
  const row: ExperimentRunRow = {
    id: uuidv7(),
    experiment_id: experiment.id,
    run_index: next?.next ?? 1,
    parent_run_id: parentRunId,
    batch_id: batchId,
    generation_id: generationId,
    overrides_json: JSON.stringify(body.overrides ?? {}),
    objective: body.objective ?? null,
    evaluation_json: body.evaluation ? JSON.stringify(body.evaluation) : null,
    decision_json: body.decision ? JSON.stringify(body.decision) : null,
    note: body.note ?? null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO experiment_runs
         (id, experiment_id, run_index, parent_run_id, batch_id, generation_id, overrides_json,
          objective, evaluation_json, decision_json, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.experiment_id,
      row.run_index,
      row.parent_run_id,
      row.batch_id,
      row.generation_id,
      row.overrides_json,
      row.objective,
      row.evaluation_json,
      row.decision_json,
      row.note,
      row.created_at,
      row.updated_at,
    )
    .run();
  await touchExperiment(db, experiment.id, now);

  return row;
}

export interface UpdateExperimentRunInput {
  overrides?: JsonObject;
  objective?: string | null;
  batch_id?: string;
  generation_id?: string;
  evaluation?: JsonObject | null;
  decision?: JsonObject | null;
  note?: string | null;
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
  if (body.batch_id !== undefined) {
    const batch = await resolveBatchOr404(db, body.batch_id);
    if (run.batch_id && run.batch_id !== batch.id) {
      throw conflict('run already has a batch attached');
    }
    assign('batch_id', batch.id);
  }
  if (body.generation_id !== undefined) {
    const generation = await resolveGenerationOr404(db, body.generation_id);
    if (run.generation_id && run.generation_id !== generation.id) {
      throw conflict('run already has a generation attached');
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
 * GET /api/v1/experiment-runs?pending=true の唯一の実装。batch_id が付いていない
 * Run を Experiment 横断で拾う runner の作業キュー。abandoned / promoted な
 * Experiment の Run は拾わない（docs/experiment-agent.md 参照）。
 */
export async function listPendingRuns(db: D1Database, limit: number, offset: number): Promise<PendingRunRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, e.short_id AS experiment_short_id, e.name AS experiment_name, e.status AS experiment_status,
         e.base_recipe AS experiment_base_recipe, e.base_parameters_json AS experiment_base_parameters_json
       FROM experiment_runs r
       JOIN experiments e ON e.id = r.experiment_id
       WHERE r.batch_id IS NULL AND e.status IN ('active', 'stabilized')
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
