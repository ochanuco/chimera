// Publication: 1回分の納品（Xへの投稿）(docs/domain-model.md#publication)。REST
// (src/routes/generations.ts, src/routes/publications.ts) と MCP tool `record_publication` /
// `get_generation` (src/mcp.ts) の両方がここを呼ぶ。

import { nowIso } from './db';
import { uuidv7 } from './uuidv7';
import { notFound } from './errors';
import type { GenerationPublicationRow, PublicationCreatedBy } from '../types';

export function serializePublication(row: GenerationPublicationRow) {
  return {
    id: row.id,
    generation_id: row.generation_id,
    url: row.url,
    published_at: row.published_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** newest (published_at) first。 */
export async function listPublicationsForGeneration(
  db: D1Database,
  generationId: string,
): Promise<GenerationPublicationRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM generation_publications WHERE generation_id = ? ORDER BY published_at DESC, id DESC')
    .bind(generationId)
    .all<GenerationPublicationRow>();
  return results ?? [];
}

export interface CreatePublicationInput {
  url?: string | null;
  publishedAt?: string;
  createdBy: PublicationCreatedBy;
  idempotencyKey?: string;
}

/** Creates one Publication row. idempotencyKey が指定され既存行と一致すれば作成済みの行をそのまま返す（再送は200相当）。 */
export async function createPublication(
  db: D1Database,
  generationId: string,
  input: CreatePublicationInput,
): Promise<{ row: GenerationPublicationRow; created: boolean }> {
  if (input.idempotencyKey) {
    const replayed = await db
      .prepare('SELECT * FROM generation_publications WHERE idempotency_key = ?')
      .bind(input.idempotencyKey)
      .first<GenerationPublicationRow>();
    if (replayed) return { row: replayed, created: false };
  }

  const now = nowIso();
  const row: GenerationPublicationRow = {
    id: uuidv7(),
    generation_id: generationId,
    url: input.url ?? null,
    published_at: input.publishedAt ?? now,
    created_by: input.createdBy,
    idempotency_key: input.idempotencyKey ?? null,
    created_at: now,
    updated_at: now,
  };

  try {
    await db
      .prepare(
        `INSERT INTO generation_publications (id, generation_id, url, published_at, created_by, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.generation_id,
        row.url,
        row.published_at,
        row.created_by,
        row.idempotency_key,
        row.created_at,
        row.updated_at,
      )
      .run();
  } catch (err) {
    if (!input.idempotencyKey) throw err;
    // 並行リクエストが同じ idempotency_key で先着した場合のフォールバック。
    const raced = await db
      .prepare('SELECT * FROM generation_publications WHERE idempotency_key = ?')
      .bind(input.idempotencyKey)
      .first<GenerationPublicationRow>();
    if (!raced) throw err;
    return { row: raced, created: false };
  }

  return { row, created: true };
}

/**
 * comfyui-recipes の `comfy-recipes metadata tag <id> publish`（と同じハンドラを叩く GUI の
 * tag-add box）互換専用。generation_tags へは書かず、既に Publication があればそれを、
 * 無ければ url なしの Publication を1件作って返す (docs/api.md#publication「tag 互換」)。
 */
export async function createPublicationForTagCompat(
  db: D1Database,
  generationId: string,
): Promise<{ row: GenerationPublicationRow; created: boolean }> {
  const existing = await db
    .prepare('SELECT * FROM generation_publications WHERE generation_id = ? ORDER BY published_at DESC, id DESC LIMIT 1')
    .bind(generationId)
    .first<GenerationPublicationRow>();
  if (existing) return { row: existing, created: false };
  return createPublication(db, generationId, { createdBy: 'api' });
}

export async function getPublicationOr404(db: D1Database, id: string): Promise<GenerationPublicationRow> {
  const row = await db.prepare('SELECT * FROM generation_publications WHERE id = ?').bind(id).first<GenerationPublicationRow>();
  if (!row) throw notFound('publication');
  return row;
}

export async function updatePublicationUrl(db: D1Database, id: string, url: string | null): Promise<GenerationPublicationRow> {
  const now = nowIso();
  await db.prepare('UPDATE generation_publications SET url = ?, updated_at = ? WHERE id = ?').bind(url, now, id).run();
  return getPublicationOr404(db, id);
}

export async function deletePublication(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM generation_publications WHERE id = ?').bind(id).run();
}
