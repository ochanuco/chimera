import { isUuid } from './uuidv7';
import type { BatchRow, GenerationRow } from '../types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

/** Resolves a Batch by its UUID or short_id (path {id} accepts both). */
export async function getBatchByIdOrShortId(
  db: D1Database,
  idOrShortId: string,
): Promise<BatchRow | null> {
  const column = isUuid(idOrShortId) ? 'id' : 'short_id';
  return db
    .prepare(`SELECT * FROM batches WHERE ${column} = ?`)
    .bind(idOrShortId)
    .first<BatchRow>();
}

/** Resolves a Generation by its UUID or short_id (path {id} accepts both). */
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

/** Resolves short_ids for a set of Batch UUIDs, for display in reference links. Missing ids are simply absent from the result. */
export async function resolveBatchShortIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT id, short_id FROM batches WHERE id IN (${placeholders})`)
    .bind(...unique)
    .all<{ id: string; short_id: string }>();
  return new Map((results ?? []).map((r) => [r.id, r.short_id]));
}

/** Resolves short_ids for a set of Generation UUIDs, for display in reference links. Missing ids are simply absent from the result. */
export async function resolveGenerationShortIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT id, short_id FROM generations WHERE id IN (${placeholders})`)
    .bind(...unique)
    .all<{ id: string; short_id: string }>();
  return new Map((results ?? []).map((r) => [r.id, r.short_id]));
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
