import { isUuid } from './uuidv7';
import type { BatchRow, ExperimentRow, GenerationRow } from '../types';

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

/** Resolves short_ids for a set of Batch UUIDs, for display in reference links. Missing ids are simply absent from the result. */
export async function resolveBatchShortIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, string>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id FROM batches WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<{ id: string; short_id: string }>();
    for (const r of results ?? []) map.set(r.id, r.short_id);
  }
  return map;
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

/**
 * Batch id -> representative Generation's short_id (family-card thumbnail). No per-Batch
 * "designated thumbnail" column exists; this mirrors the first-created Generation, the same
 * ROW_NUMBER pattern graph.ts and stories.ts use for the same purpose.
 */
export async function resolveBatchThumbnails(db: D1Database, batchIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(batchIds));
  const map = new Map<string, string>();
  // ROW_NUMBER() は batch_id ごとに独立して振られるため、チャンク分割しても結果は変わらない。
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT batch_id, short_id FROM (
           SELECT batch_id, short_id,
             ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY created_at ASC, id ASC) AS rn
           FROM generations
           WHERE batch_id IN (${placeholders})
         ) WHERE rn = 1`,
      )
      .bind(...part)
      .all<{ batch_id: string; short_id: string }>();
    for (const r of results ?? []) map.set(r.batch_id, r.short_id);
  }
  return map;
}

export interface ChainBatch {
  id: string;
  short_id: string;
  created_at: string;
}

/** Resolves prompt / negative_prompt for a set of Batch UUIDs (retry-parent diff base lookup). Missing ids are simply absent from the result. */
export async function resolveBatchPrompts(
  db: D1Database,
  ids: string[],
): Promise<Map<string, { prompt: string | null; negative_prompt: string | null }>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, { prompt: string | null; negative_prompt: string | null }>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, prompt, negative_prompt FROM batches WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<{ id: string; prompt: string | null; negative_prompt: string | null }>();
    for (const r of results ?? []) map.set(r.id, { prompt: r.prompt, negative_prompt: r.negative_prompt });
  }
  return map;
}

/**
 * Retry-chain connected component containing `batchId` (undirected walk over BatchRelation
 * edges), including `batchId` itself even with no edges. Capped at 100 as a recursion safety net.
 */
export async function getRelationChainBatches(db: D1Database, batchId: string): Promise<ChainBatch[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE chain(id) AS (
         SELECT ?
         UNION
         SELECT br.target_batch_id FROM chain JOIN batch_relations br ON br.source_batch_id = chain.id
         UNION
         SELECT br.source_batch_id FROM chain JOIN batch_relations br ON br.target_batch_id = chain.id
       )
       SELECT b.id, b.short_id, b.created_at
       FROM batches b
       JOIN chain c ON c.id = b.id
       ORDER BY b.created_at ASC, b.id ASC
       LIMIT 100`,
    )
    .bind(batchId)
    .all<ChainBatch>();
  return results ?? [];
}

/** Every Batch in `storyId`'s StoryRelation rows. Unlike getRelationChainBatches this isn't a graph walk -- the rows already name every Batch on the timeline directly. */
export async function getStoryChainBatches(db: D1Database, storyId: string): Promise<ChainBatch[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT b.id, b.short_id, b.created_at
       FROM batches b
       WHERE b.id IN (
         SELECT source_batch_id FROM story_relations WHERE story_id = ?
         UNION
         SELECT target_batch_id FROM story_relations WHERE story_id = ?
       )
       ORDER BY b.created_at ASC, b.id ASC
       LIMIT 100`,
    )
    .bind(storyId, storyId)
    .all<ChainBatch>();
  return results ?? [];
}

/**
 * Reference (material) lineage of `batchId`: ancestors + descendants via generations.batch_id,
 * plus `batchId` itself. Directed reachability only, so unrelated branches of a shared ancestor
 * stay out. Capped at 100 as a recursion safety net.
 */
export async function getReferenceLineageBatches(db: D1Database, batchId: string): Promise<ChainBatch[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(id) AS (
         SELECT ?
         UNION
         SELECT g.batch_id
         FROM up
         JOIN batch_references br ON br.target_batch_id = up.id
         JOIN generations g ON g.id = br.source_generation_id
       ),
       down(id) AS (
         SELECT ?
         UNION
         SELECT br.target_batch_id
         FROM down
         JOIN generations g ON g.batch_id = down.id
         JOIN batch_references br ON br.source_generation_id = g.id
       )
       SELECT b.id, b.short_id, b.created_at
       FROM batches b
       JOIN (SELECT id FROM up UNION SELECT id FROM down) c ON c.id = b.id
       ORDER BY b.created_at ASC, b.id ASC
       LIMIT 100`,
    )
    .bind(batchId, batchId)
    .all<ChainBatch>();
  return results ?? [];
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
