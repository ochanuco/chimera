import { isUuid } from './uuidv7';
import type { ExperimentRow, GenerationRow } from '../types';

export function nowIso(): string {
  return new Date().toISOString();
}

/** lib/experiments.ts と lib/requests.ts の両方が使うため、循環 import を避けてここに置く。 */
export async function touchExperiment(db: D1Database, experimentId: string, at: string): Promise<void> {
  await db.prepare('UPDATE experiments SET updated_at = ? WHERE id = ?').bind(at, experimentId).run();
}

/** D1 は 1 クエリあたり最大 100 個の bound parameter しか受け付けない。`IN (?, ?, ...)` を組み立てる
 * ヘルパーは id 配列を `chunk` でこのサイズ以下に割ってからクエリを複数回実行する。 */
export const D1_MAX_BOUND_PARAMS = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export async function getGenerationByIdOrShortId(
  db: D1Database,
  idOrShortId: string,
): Promise<GenerationRow | null> {
  const column = isUuid(idOrShortId) ? 'id' : 'short_id';
  return db
    .prepare(`SELECT * FROM generations WHERE ${column} = ?`)
    .bind(idOrShortId)
    .first<GenerationRow>();
}

export async function getExperimentByIdOrShortId(
  db: D1Database,
  idOrShortId: string,
): Promise<ExperimentRow | null> {
  const column = isUuid(idOrShortId) ? 'id' : 'short_id';
  return db
    .prepare(`SELECT * FROM experiments WHERE ${column} = ?`)
    .bind(idOrShortId)
    .first<ExperimentRow>();
}

export async function resolveGenerationShortIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, string>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id FROM generations WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<{ id: string; short_id: string }>();
    for (const r of results ?? []) map.set(r.id, r.short_id);
  }
  return map;
}

/** Resolves short_ids for a set of Request ids. Requests without a short_id are simply absent from the result. */
export async function resolveRequestShortIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, string>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id FROM requests WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<{ id: string; short_id: string | null }>();
    for (const r of results ?? []) if (r.short_id) map.set(r.id, r.short_id);
  }
  return map;
}

/**
 * Request id -> representative Generation's short_id: the first one by Job index, then output index
 * (created_at / id break ties). `/b/{short_id}` redirects here too.
 */
export async function resolveRequestThumbnails(db: D1Database, requestIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(requestIds));
  const map = new Map<string, string>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT request_id, short_id FROM (
           SELECT g.request_id, g.short_id,
             ROW_NUMBER() OVER (
               PARTITION BY g.request_id
               ORDER BY j.job_index ASC, g.comfy_output_index ASC, g.created_at ASC, g.id ASC
             ) AS rn
           FROM generations g
           JOIN comfy_jobs j ON j.id = g.comfy_job_id
           WHERE g.request_id IN (${placeholders})
         ) WHERE rn = 1`,
      )
      .bind(...part)
      .all<{ request_id: string; short_id: string }>();
    for (const r of results ?? []) map.set(r.request_id, r.short_id);
  }
  return map;
}

/**
 * `experiment_runs <alias>` の結果 Request の id を返す副問い合わせ。Run の結果は done の generate/import
 * Request (1 Run に done の generate Request は高々 1 件)。
 */
export function runRequestIdSql(alias: string): string {
  return `(SELECT x.id FROM requests x WHERE x.run_id = ${alias}.id AND x.status = 'done' AND x.kind IN ('generate', 'import') ORDER BY x.created_at DESC, x.id DESC LIMIT 1)`;
}

export interface RunRequestRef {
  id: string;
  short_id: string | null;
}

/** Run id -> その結果 Request (runRequestIdSql と同じ規則)。結果の無い Run は含まれない。 */
export async function resolveRunRequests(db: D1Database, runIds: string[]): Promise<Map<string, RunRequestRef>> {
  const unique = Array.from(new Set(runIds));
  const map = new Map<string, RunRequestRef>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT run_id, id, short_id FROM (
           SELECT x.run_id, x.id, x.short_id,
             ROW_NUMBER() OVER (PARTITION BY x.run_id ORDER BY x.created_at DESC, x.id DESC) AS rn
           FROM requests x
           WHERE x.run_id IN (${placeholders}) AND x.status = 'done' AND x.kind IN ('generate', 'import')
         ) WHERE rn = 1`,
      )
      .bind(...part)
      .all<{ run_id: string; id: string; short_id: string | null }>();
    for (const r of results ?? []) map.set(r.run_id, { id: r.id, short_id: r.short_id });
  }
  return map;
}

export interface Pagination {
  limit: number;
  offset: number;
}

export function parsePagination(
  query: Record<string, string | undefined>,
  defaultLimit = 50,
): Pagination {
  const limitRaw = query.limit ? Number(query.limit) : defaultLimit;
  const offsetRaw = query.offset ? Number(query.offset) : 0;
  const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : defaultLimit;
  const offset = Number.isSafeInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  return { limit, offset };
}

/** Normalizes `from`/`to` date-only query params to inclusive ISO8601 bounds. */
export function normalizeDateRange(from?: string, to?: string): { from?: string; to?: string } {
  const result: { from?: string; to?: string } = {};
  if (from) {
    result.from = from.length <= 10 ? `${from}T00:00:00.000Z` : from;
  }
  if (to) {
    result.to = to.length <= 10 ? `${to}T23:59:59.999Z` : to;
  }
  return result;
}
