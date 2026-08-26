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
  const id = uuidv7();
  const now = nowIso();
  const result = await db
    .prepare('INSERT INTO tags (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?) ON CONFLICT (name) DO NOTHING')
    .bind(id, name, now, now)
    .run();

  if (result.meta.changes === 1) {
    return { id, name, description: null, created_at: now, updated_at: now };
  }

  const existing = await db
    .prepare('SELECT * FROM tags WHERE name = ?')
    .bind(name)
    .first<TagRow>();
  return existing!;
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

  const result = await db
    .prepare(
      `INSERT INTO ${table} (id, ${fk}, tag_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (${fk}, tag_id) DO NOTHING`,
    )
    .bind(uuidv7(), targetId, tag.id, createdBy ?? null, nowIso())
    .run();

  const created = result.meta.changes === 1;
  return { tag, created };
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
