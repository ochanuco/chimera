import { uuidv7 } from './uuidv7';
import { nowIso } from './db';
import type { CreatedBy, TagRow } from '../types';

export type TaggableTable = 'generation_tags' | 'batch_tags' | 'story_tags' | 'experiment_tags';

const FK_COLUMN: Record<TaggableTable, string> = {
  generation_tags: 'generation_id',
  batch_tags: 'batch_id',
  story_tags: 'story_id',
  experiment_tags: 'experiment_id',
};

async function findOrCreateTag(db: D1Database, name: string): Promise<TagRow> {
  const existing = await db
    .prepare('SELECT * FROM tags WHERE name = ?')
    .bind(name)
    .first<TagRow>();
  if (existing) return existing;

  const id = uuidv7();
  const now = nowIso();
  await db
    .prepare('INSERT INTO tags (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
    .bind(id, name, now, now)
    .run();
  return { id, name, description: null, created_at: now, updated_at: now };
}

export interface TagAssignmentResult {
  tag: TagRow;
  created: boolean;
}

/** Assigns a tag (creating it if needed) to a target row. Idempotent. */
export async function assignTag(
  db: D1Database,
  table: TaggableTable,
  targetId: string,
  name: string,
  createdBy?: CreatedBy,
): Promise<TagAssignmentResult> {
  const tag = await findOrCreateTag(db, name);
  const fk = FK_COLUMN[table];

  const existing = await db
    .prepare(`SELECT 1 FROM ${table} WHERE ${fk} = ? AND tag_id = ?`)
    .bind(targetId, tag.id)
    .first();
  if (existing) return { tag, created: false };

  await db
    .prepare(
      `INSERT INTO ${table} (id, ${fk}, tag_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(uuidv7(), targetId, tag.id, createdBy ?? null, nowIso())
    .run();
  return { tag, created: true };
}

export async function removeTag(
  db: D1Database,
  table: TaggableTable,
  targetId: string,
  tagId: string,
): Promise<void> {
  const fk = FK_COLUMN[table];
  await db
    .prepare(`DELETE FROM ${table} WHERE ${fk} = ? AND tag_id = ?`)
    .bind(targetId, tagId)
    .run();
}

export async function listTagsForTarget(
  db: D1Database,
  table: TaggableTable,
  targetId: string,
): Promise<TagRow[]> {
  const fk = FK_COLUMN[table];
  const { results } = await db
    .prepare(
      `SELECT t.* FROM tags t JOIN ${table} j ON j.tag_id = t.id WHERE j.${fk} = ? ORDER BY t.name`,
    )
    .bind(targetId)
    .all<TagRow>();
  return results ?? [];
}
