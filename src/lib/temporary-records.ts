// Experiment / ExperimentRun / Observation は一回のラウンドの作業記憶で、最後に触られてから
// TEMPORARY_RECORD_RETENTION_DAYS 日で消す。永続側（Generation、PairwiseJudgment、Request）からの参照は
// 消す前に NULL にし、Generation と R2 の画像には触らない。

export const TEMPORARY_RECORD_RETENTION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 1 回の batch で消す Experiment の数。各文が id を束縛するので D1 の 100 個制限より下に置く。 */
const EXPERIMENT_BATCH_SIZE = 25;

const OBSERVATION_BATCH_SIZE = 500;

/** cron 1 回あたりの batch 数の上限（種類ごと）。D1 のクエリ数上限に収め、残りは次の tick に回す。 */
const MAX_BATCHES_PER_TICK = 4;

export interface ExpiryResult {
  experiments: number;
  runs: number;
  observations: number;
}

export function retentionCutoff(nowMs: number): string {
  return new Date(nowMs - TEMPORARY_RECORD_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Experiment の最終操作は experiments.updated_at（touchExperiment が Run・judgment・Request 完了で進める）。
 * Run 自身の updated_at が新しい Experiment も残す。 */
async function staleExperimentIds(db: D1Database, cutoff: string, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id FROM experiments e
       WHERE e.updated_at < ?1
         AND NOT EXISTS (SELECT 1 FROM experiment_runs r WHERE r.experiment_id = e.id AND r.updated_at >= ?1)
       ORDER BY e.updated_at ASC, e.id ASC
       LIMIT ?2`,
    )
    .bind(cutoff, limit)
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

async function deleteExperiments(db: D1Database, ids: string[]): Promise<number> {
  const placeholders = ids.map(() => '?').join(', ');
  const runs = `SELECT id FROM experiment_runs WHERE experiment_id IN (${placeholders})`;
  const stmt = (sql: string) => db.prepare(sql).bind(...ids);
  const results = await db.batch([
    stmt(`UPDATE requests SET run_id = NULL WHERE run_id IN (${runs})`),
    stmt(`UPDATE pairwise_judgments SET baseline_run_id = NULL WHERE baseline_run_id IN (${runs})`),
    stmt(`UPDATE pairwise_judgments SET arm_run_id = NULL WHERE arm_run_id IN (${runs})`),
    stmt(`UPDATE pairwise_judgments SET experiment_id = NULL WHERE experiment_id IN (${placeholders})`),
    stmt(`UPDATE experiment_runs SET parent_run_id = NULL WHERE parent_run_id IN (${runs})`),
    stmt(`UPDATE experiment_promotions SET source_run_id = NULL WHERE source_run_id IN (${runs})`),
    stmt(`DELETE FROM experiment_promotions WHERE experiment_id IN (${placeholders})`),
    stmt(`DELETE FROM experiment_tags WHERE experiment_id IN (${placeholders})`),
    stmt(`DELETE FROM experiment_runs WHERE experiment_id IN (${placeholders})`),
    stmt(`DELETE FROM experiments WHERE id IN (${placeholders})`),
  ]);
  return results[8]!.meta.changes;
}

/** Observation の最終操作は created_at（Observation は書き換えない）。 */
async function deleteStaleObservations(db: D1Database, cutoff: string): Promise<number> {
  const results = await db.batch([
    db
      .prepare(
        'UPDATE observations SET supersedes_id = NULL WHERE supersedes_id IN (SELECT id FROM observations WHERE created_at < ?)',
      )
      .bind(cutoff),
    db
      .prepare(
        'DELETE FROM observations WHERE id IN (SELECT id FROM observations WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?)',
      )
      .bind(cutoff, OBSERVATION_BATCH_SIZE),
  ]);
  return results[1]!.meta.changes;
}

/** Cron: 期限切れの一時記録を上限つきで消す。消し切れなかった分は次の tick が拾う。 */
export async function expireTemporaryRecords(db: D1Database, nowMs: number): Promise<ExpiryResult> {
  const cutoff = retentionCutoff(nowMs);
  const result: ExpiryResult = { experiments: 0, runs: 0, observations: 0 };
  for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
    const ids = await staleExperimentIds(db, cutoff, EXPERIMENT_BATCH_SIZE);
    if (ids.length === 0) break;
    result.runs += await deleteExperiments(db, ids);
    result.experiments += ids.length;
    if (ids.length < EXPERIMENT_BATCH_SIZE) break;
  }

  for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
    const deleted = await deleteStaleObservations(db, cutoff);
    result.observations += deleted;
    if (deleted < OBSERVATION_BATCH_SIZE) break;
  }

  return result;
}
