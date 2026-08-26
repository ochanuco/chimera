import { Hono } from 'hono';
import { renameTagSchema } from '../schemas/tags';
import { nowIso } from '../lib/db';
import { conflict, notFound } from '../lib/errors';
import type { AppEnv, TagRow } from '../types';

export const tags = new Hono<AppEnv>();

function serialize(row: TagRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

tags.get('/', async (c) => {
  const q = c.req.query('q');
  const stmt = q
    ? c.env.DB.prepare('SELECT * FROM tags WHERE name LIKE ? ORDER BY name LIMIT 20').bind(`${q}%`)
    : c.env.DB.prepare('SELECT * FROM tags ORDER BY name');
  const { results } = await stmt.all<TagRow>();
  return c.json({ items: (results ?? []).map(serialize) });
});

tags.patch('/:id', async (c) => {
  const body = renameTagSchema.parse(await c.req.json());
  const db = c.env.DB;

  const row = await db.prepare('SELECT * FROM tags WHERE id = ?').bind(c.req.param('id')).first<TagRow>();
  if (!row) throw notFound('tag');

  const existing = await db
    .prepare('SELECT 1 FROM tags WHERE name = ? AND id != ?')
    .bind(body.name, row.id)
    .first();
  if (existing) throw conflict(`tag with name '${body.name}' already exists`);

  const updated_at = nowIso();
  await db
    .prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?')
    .bind(body.name, updated_at, row.id)
    .run();

  return c.json(serialize({ ...row, name: body.name, updated_at }));
});

const ASSIGNMENT_TABLES = ['generation_tags', 'batch_tags', 'story_tags', 'experiment_tags'] as const;

tags.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const row = await db.prepare('SELECT 1 FROM tags WHERE id = ?').bind(id).first();
  if (!row) throw notFound('tag');

  // D1 does not guarantee FK PRAGMA enforcement across connections, so cascade
  // assignment cleanup explicitly rather than relying solely on the schema's
  // ON DELETE CASCADE.
  const statements = [
    ...ASSIGNMENT_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE tag_id = ?`).bind(id)),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
  ];
  await db.batch(statements);

  return c.body(null, 204);
});
