import { Hono } from 'hono';
import { createExperimentSchema, updateExperimentSchema } from '../schemas/experiments';
import { assignTagSchema } from '../schemas/tags';
import { uuidv7 } from '../lib/uuidv7';
import { nowIso, parsePagination, toBool } from '../lib/db';
import { assignTag, listTagsForTarget, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { notFound } from '../lib/errors';
import type { AppEnv, ExperimentRow } from '../types';

export const experiments = new Hono<AppEnv>();

function serialize(row: ExperimentRow) {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    bookmark: toBool(row.bookmark),
    created_at: row.created_at,
  };
}

async function getExperimentOr404(db: D1Database, id: string): Promise<ExperimentRow> {
  const row = await db.prepare('SELECT * FROM experiments WHERE id = ?').bind(id).first<ExperimentRow>();
  if (!row) throw notFound('experiment');
  return row;
}

experiments.post('/', async (c) => {
  const body = createExperimentSchema.parse(await c.req.json());
  const row: ExperimentRow = {
    id: uuidv7(),
    name: body.name,
    note: body.note ?? null,
    bookmark: 0,
    created_at: nowIso(),
  };
  await c.env.DB.prepare(
    'INSERT INTO experiments (id, name, note, bookmark, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(row.id, row.name, row.note, row.bookmark, row.created_at)
    .run();
  return c.json(serialize(row), 201);
});

experiments.get('/', async (c) => {
  const { limit, offset } = parsePagination(c.req.query());
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM experiments ORDER BY created_at DESC LIMIT ? OFFSET ?',
  )
    .bind(limit, offset)
    .all<ExperimentRow>();
  return c.json({ items: (results ?? []).map(serialize) });
});

experiments.get('/:id', async (c) => {
  const row = await getExperimentOr404(c.env.DB, c.req.param('id'));
  const tags = await listTagsForTarget(c.env.DB, 'experiment_tags', row.id);
  return c.json({ ...serialize(row), tags: tags.map((t) => t.name) });
});

experiments.patch('/:id', async (c) => {
  const body = updateExperimentSchema.parse(await c.req.json());
  const db = c.env.DB;
  await getExperimentOr404(db, c.req.param('id'));

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.note !== undefined) {
    sets.push('note = ?');
    binds.push(body.note);
  }
  binds.push(c.req.param('id'));
  await db.prepare(`UPDATE experiments SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const row = await getExperimentOr404(db, c.req.param('id'));
  return c.json(serialize(row));
});

experiments.put('/:id/bookmark', async (c) => {
  const found = await setBookmark(c.env.DB, 'experiments', c.req.param('id'), true);
  if (!found) throw notFound('experiment');
  return c.json({ bookmark: true });
});

experiments.delete('/:id/bookmark', async (c) => {
  const found = await setBookmark(c.env.DB, 'experiments', c.req.param('id'), false);
  if (!found) throw notFound('experiment');
  return c.json({ bookmark: false });
});

experiments.post('/:id/tags', async (c) => {
  const body = assignTagSchema.parse(await c.req.json());
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const { tag, created } = await assignTag(db, 'experiment_tags', experiment.id, body.name, body.created_by);
  return c.json({ id: tag.id, name: tag.name }, created ? 201 : 200);
});

experiments.delete('/:id/tags/:tagId', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  await removeTag(db, 'experiment_tags', experiment.id, c.req.param('tagId'));
  return c.body(null, 204);
});
