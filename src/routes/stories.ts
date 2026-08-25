import { Hono } from 'hono';
import {
  createStorySchema,
  updateStorySchema,
  createStoryRelationSchema,
  updateStoryRelationSchema,
} from '../schemas/stories';
import { assignTagSchema } from '../schemas/tags';
import { uuidv7 } from '../lib/uuidv7';
import { nowIso, getBatchByIdOrShortId } from '../lib/db';
import { assignTag, listTagsForTarget, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { notFound } from '../lib/errors';
import { serializeBatch, serializeGenerationLight, serializeStory } from '../lib/serialize';
import type { AppEnv, BatchRow, GenerationRow, StoryRelationRow, StoryRow } from '../types';

export const stories = new Hono<AppEnv>();

function origin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

async function getStoryOr404(db: D1Database, id: string): Promise<StoryRow> {
  const row = await db.prepare('SELECT * FROM stories WHERE id = ?').bind(id).first<StoryRow>();
  if (!row) throw notFound('story');
  return row;
}

stories.post('/', async (c) => {
  const body = createStorySchema.parse(await c.req.json());
  const row: StoryRow = {
    id: uuidv7(),
    name: body.name,
    description: body.description ?? null,
    note: null,
    bookmark: 0,
    created_at: nowIso(),
  };
  await c.env.DB.prepare(
    'INSERT INTO stories (id, name, description, note, bookmark, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(row.id, row.name, row.description, row.note, row.bookmark, row.created_at)
    .run();
  return c.json(serializeStory(row), 201);
});

stories.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (
       SELECT COUNT(*) FROM (
         SELECT source_batch_id AS batch_id FROM story_relations WHERE story_id = s.id
         UNION
         SELECT target_batch_id AS batch_id FROM story_relations WHERE story_id = s.id
       )
     ) AS batch_count
     FROM stories s
     ORDER BY s.created_at DESC`,
  ).all<StoryRow & { batch_count: number }>();

  return c.json({
    items: (results ?? []).map((r) => ({ ...serializeStory(r), batch_count: r.batch_count })),
  });
});

stories.get('/:id', async (c) => {
  const db = c.env.DB;
  const story = await getStoryOr404(db, c.req.param('id'));
  const org = origin(c);

  const { results: relationRows } = await db
    .prepare('SELECT * FROM story_relations WHERE story_id = ? ORDER BY created_at ASC')
    .bind(story.id)
    .all<StoryRelationRow>();
  const relations = relationRows ?? [];

  const batchIds = Array.from(
    new Set(relations.flatMap((r) => [r.source_batch_id, r.target_batch_id])),
  );

  const batches = await Promise.all(
    batchIds.map(async (batchId) => {
      const batch = await db.prepare('SELECT * FROM batches WHERE id = ?').bind(batchId).first<BatchRow>();
      if (!batch) return null;
      const representative = await db
        .prepare('SELECT * FROM generations WHERE batch_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')
        .bind(batchId)
        .first<GenerationRow>();
      return {
        ...serializeBatch(batch),
        representative_generation: representative ? serializeGenerationLight(representative, org) : null,
      };
    }),
  );

  const tags = await listTagsForTarget(db, 'story_tags', story.id);

  return c.json({
    ...serializeStory(story),
    relations: relations.map((r) => ({
      id: r.id,
      source_batch_id: r.source_batch_id,
      target_batch_id: r.target_batch_id,
      label: r.label,
      description: r.description,
      raw_instruction: r.raw_instruction,
      generated_by: r.generated_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    batches: batches.filter((b): b is NonNullable<typeof b> => b !== null),
    tags: tags.map((t) => t.name),
  });
});

stories.patch('/:id', async (c) => {
  const body = updateStorySchema.parse(await c.req.json());
  const db = c.env.DB;
  const story = await getStoryOr404(db, c.req.param('id'));

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    binds.push(body.description);
  }
  if (body.note !== undefined) {
    sets.push('note = ?');
    binds.push(body.note);
  }
  binds.push(story.id);
  await db.prepare(`UPDATE stories SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await getStoryOr404(db, story.id);
  return c.json(serializeStory(updated));
});

stories.post('/:storyId/relations', async (c) => {
  const body = createStoryRelationSchema.parse(await c.req.json());
  const db = c.env.DB;
  const story = await getStoryOr404(db, c.req.param('storyId'));

  const [sourceBatch, targetBatch] = await Promise.all([
    getBatchByIdOrShortId(db, body.source_batch_id),
    getBatchByIdOrShortId(db, body.target_batch_id),
  ]);
  if (!sourceBatch) throw notFound(`source batch '${body.source_batch_id}'`);
  if (!targetBatch) throw notFound(`target batch '${body.target_batch_id}'`);

  const id = uuidv7();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO story_relations (id, story_id, source_batch_id, target_batch_id, raw_instruction, label, description, generated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      story.id,
      sourceBatch.id,
      targetBatch.id,
      body.raw_instruction ?? null,
      body.label ?? null,
      body.description ?? null,
      body.generated_by ?? null,
      now,
      now,
    )
    .run();

  return c.json(
    {
      id,
      story_id: story.id,
      source_batch_id: sourceBatch.id,
      target_batch_id: targetBatch.id,
      label: body.label ?? null,
      description: body.description ?? null,
      raw_instruction: body.raw_instruction ?? null,
      generated_by: body.generated_by ?? null,
      created_at: now,
      updated_at: now,
    },
    201,
  );
});

stories.patch('/:storyId/relations/:relationId', async (c) => {
  const body = updateStoryRelationSchema.parse(await c.req.json());
  const db = c.env.DB;
  await getStoryOr404(db, c.req.param('storyId'));

  const relation = await db
    .prepare('SELECT * FROM story_relations WHERE id = ? AND story_id = ?')
    .bind(c.req.param('relationId'), c.req.param('storyId'))
    .first<StoryRelationRow>();
  if (!relation) throw notFound('story relation');

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.label !== undefined) {
    sets.push('label = ?');
    binds.push(body.label);
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    binds.push(body.description);
  }
  sets.push('updated_at = ?');
  const now = nowIso();
  binds.push(now, relation.id);

  await db.prepare(`UPDATE story_relations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await db
    .prepare('SELECT * FROM story_relations WHERE id = ?')
    .bind(relation.id)
    .first<StoryRelationRow>();
  return c.json(updated);
});

stories.put('/:id/bookmark', async (c) => {
  const story = await getStoryOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'stories', story.id, true);
  return c.json({ bookmark: true });
});

stories.delete('/:id/bookmark', async (c) => {
  const story = await getStoryOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'stories', story.id, false);
  return c.json({ bookmark: false });
});

stories.post('/:id/tags', async (c) => {
  const body = assignTagSchema.parse(await c.req.json());
  const db = c.env.DB;
  const story = await getStoryOr404(db, c.req.param('id'));
  const { tag, created } = await assignTag(db, 'story_tags', story.id, body.name, body.created_by);
  return c.json({ id: tag.id, name: tag.name }, created ? 201 : 200);
});

stories.delete('/:id/tags/:tagId', async (c) => {
  const db = c.env.DB;
  const story = await getStoryOr404(db, c.req.param('id'));
  await removeTag(db, 'story_tags', story.id, c.req.param('tagId'));
  return c.body(null, 204);
});
