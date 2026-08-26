import { Hono } from 'hono';
import {
  createBatchSchema,
  updateBatchSchema,
  createBatchReferenceSchema,
  createBatchRelationSchema,
} from '../schemas/batches';
import { createJobSchema } from '../schemas/jobs';
import { assignTagSchema } from '../schemas/tags';
import { uuidv7 } from '../lib/uuidv7';
import { createUniqueShortId } from '../lib/shortid';
import { nowIso, parsePagination, getBatchByIdOrShortId, getGenerationByIdOrShortId } from '../lib/db';
import { assignTag, listTagsForTarget, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { badRequest, notFound } from '../lib/errors';
import { serializeBatch, serializeGenerationLight } from '../lib/serialize';
import type {
  AppEnv,
  BatchRelationRow,
  BatchReferenceRow,
  BatchRow,
  ComfyJobRow,
  GenerationRow,
  StoryRelationRow,
} from '../types';

export const batches = new Hono<AppEnv>();

function origin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

async function getBatchOr404(db: D1Database, idOrShortId: string): Promise<BatchRow> {
  const row = await getBatchByIdOrShortId(db, idOrShortId);
  if (!row) throw notFound('batch');
  return row;
}

batches.post('/', async (c) => {
  const body = createBatchSchema.parse(await c.req.json());
  const db = c.env.DB;

  const replayed = await db
    .prepare('SELECT * FROM batches WHERE idempotency_key = ?')
    .bind(body.idempotency_key)
    .first<BatchRow>();
  if (replayed) return c.json(serializeBatch(replayed), 200);

  // Resolve and validate every referenced entity before writing anything.
  if (body.experiment_id) {
    const experiment = await db
      .prepare('SELECT 1 FROM experiments WHERE id = ?')
      .bind(body.experiment_id)
      .first();
    if (!experiment) throw notFound('experiment');
  }

  const resolvedReferences: { generationId: string; purpose?: string; aspect?: string; instruction?: string }[] = [];
  for (const ref of body.references ?? []) {
    const generation = await getGenerationByIdOrShortId(db, ref.source_generation_id);
    if (!generation) throw notFound(`referenced generation '${ref.source_generation_id}'`);
    resolvedReferences.push({
      generationId: generation.id,
      purpose: ref.purpose,
      aspect: ref.aspect,
      instruction: ref.instruction,
    });
  }

  let resolvedRefinementSourceId: string | undefined;
  if (body.refinement) {
    const source = await getBatchByIdOrShortId(db, body.refinement.source_batch_id);
    if (!source) throw notFound(`refinement source batch '${body.refinement.source_batch_id}'`);
    resolvedRefinementSourceId = source.id;
  }

  let resolvedStoryPreviousBatchIds: string[] = [];
  if (body.story) {
    const story = await db.prepare('SELECT 1 FROM stories WHERE id = ?').bind(body.story.story_id).first();
    if (!story) throw notFound(`story '${body.story.story_id}'`);
    for (const prevId of body.story.previous_batch_ids) {
      const prevBatch = await getBatchByIdOrShortId(db, prevId);
      if (!prevBatch) throw notFound(`story previous batch '${prevId}'`);
      resolvedStoryPreviousBatchIds.push(prevBatch.id);
    }
  }

  const id = uuidv7();
  const shortId = await createUniqueShortId(db, 'batches');
  const now = nowIso();
  const row: BatchRow = {
    id,
    short_id: shortId,
    experiment_id: body.experiment_id ?? null,
    raw_instruction: body.raw_instruction ?? null,
    recipe: body.recipe ?? null,
    prompt: body.prompt ?? null,
    negative_prompt: body.negative_prompt ?? null,
    parameters_json: body.parameters ? JSON.stringify(body.parameters) : null,
    git_commit: body.git_commit ?? null,
    git_dirty: body.git_dirty ? 1 : 0,
    note: null,
    bookmark: 0,
    status: 'created',
    idempotency_key: body.idempotency_key,
    created_at: now,
    updated_at: now,
  };

  const statements = [
    db
      .prepare(
        `INSERT INTO batches (id, short_id, experiment_id, raw_instruction, recipe, prompt, negative_prompt,
          parameters_json, git_commit, git_dirty, note, bookmark, status, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.short_id,
        row.experiment_id,
        row.raw_instruction,
        row.recipe,
        row.prompt,
        row.negative_prompt,
        row.parameters_json,
        row.git_commit,
        row.git_dirty,
        row.note,
        row.bookmark,
        row.status,
        row.idempotency_key,
        row.created_at,
        row.updated_at,
      ),
  ];

  for (const ref of resolvedReferences) {
    statements.push(
      db
        .prepare(
          'INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(uuidv7(), ref.generationId, id, ref.purpose ?? null, ref.aspect ?? null, ref.instruction ?? null, now),
    );
  }

  if (body.refinement && resolvedRefinementSourceId) {
    statements.push(
      db
        .prepare(
          'INSERT INTO batch_relations (id, source_batch_id, target_batch_id, type, actor, reason, raw_instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          uuidv7(),
          resolvedRefinementSourceId,
          id,
          'refinement',
          body.refinement.actor,
          body.refinement.reason ?? null,
          body.refinement.raw_instruction ?? null,
          now,
        ),
    );
  }

  if (body.story) {
    for (const prevBatchId of resolvedStoryPreviousBatchIds) {
      statements.push(
        db
          .prepare(
            'INSERT INTO story_relations (id, story_id, source_batch_id, target_batch_id, raw_instruction, label, description, generated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            uuidv7(),
            body.story.story_id,
            prevBatchId,
            id,
            body.story.raw_instruction ?? null,
            body.story.transition?.label ?? null,
            body.story.transition?.description ?? null,
            'claude',
            now,
            now,
          ),
      );
    }
  }

  try {
    // db.batch is transactional: a concurrent request with the same idempotency
    // key makes this fail on the unique constraint and rolls back the reference /
    // relation inserts too, so no rows end up pointing at a batch that was never
    // created.
    await db.batch(statements);
  } catch (err) {
    const raced = await db
      .prepare('SELECT * FROM batches WHERE idempotency_key = ?')
      .bind(body.idempotency_key)
      .first<BatchRow>();
    if (!raced) throw err;
    return c.json(serializeBatch(raced), 200);
  }

  // provenance の中核 (prompt / recipe / instruction) が全部空の登録は、API を
  // 直接叩いて request.json 契約を経由していない可能性が高い。自動化を壊さない
  // よう拒否はせず、warnings とログで気付けるようにするだけに留める。
  const hasGenerationMetadata =
    body.raw_instruction != null ||
    body.recipe != null ||
    body.prompt != null ||
    body.negative_prompt != null ||
    body.parameters != null;
  if (!hasGenerationMetadata) {
    const warning =
      'batch created without generation metadata (raw_instruction / recipe / prompt / negative_prompt / parameters are all empty)';
    console.warn(`${warning}: batch=${row.short_id}`);
    return c.json({ ...serializeBatch(row), warnings: [warning] }, 201);
  }

  return c.json(serializeBatch(row), 201);
});

batches.patch('/:id', async (c) => {
  const body = updateBatchSchema.parse(await c.req.json());
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));

  if (body.experiment_id) {
    const experiment = await db.prepare('SELECT 1 FROM experiments WHERE id = ?').bind(body.experiment_id).first();
    if (!experiment) throw notFound('experiment');
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.status !== undefined) {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.note !== undefined) {
    sets.push('note = ?');
    binds.push(body.note);
  }
  if (body.experiment_id !== undefined) {
    sets.push('experiment_id = ?');
    binds.push(body.experiment_id);
  }
  sets.push('updated_at = ?');
  const now = nowIso();
  binds.push(now);
  binds.push(batch.id);

  await db.prepare(`UPDATE batches SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await getBatchOr404(db, batch.id);
  return c.json(serializeBatch(updated));
});

batches.get('/', async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (query.bookmark !== undefined) {
    if (query.bookmark !== 'true' && query.bookmark !== 'false') {
      throw badRequest('bookmark query param must be "true" or "false"');
    }
    conditions.push('b.bookmark = ?');
    binds.push(query.bookmark === 'true' ? 1 : 0);
  }
  if (query.status) {
    conditions.push('b.status = ?');
    binds.push(query.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    WITH counts AS (
      SELECT batch_id, COUNT(*) AS cnt FROM generations GROUP BY batch_id
    ),
    firsts AS (
      SELECT * FROM (
        SELECT g.*, ROW_NUMBER() OVER (PARTITION BY g.batch_id ORDER BY g.created_at ASC, g.id ASC) AS rn
        FROM generations g
      ) WHERE rn = 1
    )
    SELECT b.*, COALESCE(counts.cnt, 0) AS generation_count,
      firsts.id AS first_gen_id, firsts.short_id AS first_gen_short_id,
      firsts.rating AS first_gen_rating, firsts.bookmark AS first_gen_bookmark,
      firsts.character_id AS first_gen_character_id, firsts.created_at AS first_gen_created_at
    FROM batches b
    LEFT JOIN counts ON counts.batch_id = b.id
    LEFT JOIN firsts ON firsts.batch_id = b.id
    ${where}
    ORDER BY b.created_at DESC, b.id
    LIMIT ? OFFSET ?
  `;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>();
  const org = origin(c);

  const items = (results ?? []).map((r: Record<string, unknown>) => ({
    ...serializeBatch(r as unknown as BatchRow),
    generation_count: r.generation_count as number,
    thumbnail: r.first_gen_id
      ? serializeGenerationLight(
          {
            id: r.first_gen_id as string,
            short_id: r.first_gen_short_id as string,
            rating: r.first_gen_rating as GenerationRow['rating'],
            bookmark: r.first_gen_bookmark as number,
            character_id: r.first_gen_character_id as string | null,
            created_at: r.first_gen_created_at as string,
          },
          org,
        )
      : null,
  }));

  return c.json({ items });
});

batches.get('/:id', async (c) => {
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));
  const org = origin(c);

  const [
    jobs,
    generations,
    references,
    outgoingRelations,
    incomingRelations,
    storyRelations,
    tags,
    referenceChildrenRows,
    siblingsByRefinement,
    siblingsByReference,
  ] = await Promise.all([
    db.prepare('SELECT * FROM comfy_jobs WHERE batch_id = ? ORDER BY job_index ASC').bind(batch.id).all<ComfyJobRow>(),
    db.prepare('SELECT * FROM generations WHERE batch_id = ? ORDER BY created_at ASC').bind(batch.id).all<GenerationRow>(),
    db
      .prepare('SELECT * FROM batch_references WHERE target_batch_id = ? ORDER BY created_at ASC')
      .bind(batch.id)
      .all<BatchReferenceRow>(),
    db
      .prepare('SELECT * FROM batch_relations WHERE source_batch_id = ? ORDER BY created_at ASC')
      .bind(batch.id)
      .all<BatchRelationRow>(),
    db
      .prepare('SELECT * FROM batch_relations WHERE target_batch_id = ? ORDER BY created_at ASC')
      .bind(batch.id)
      .all<BatchRelationRow>(),
    db
      .prepare(
        'SELECT * FROM story_relations WHERE source_batch_id = ? OR target_batch_id = ? ORDER BY created_at ASC',
      )
      .bind(batch.id, batch.id)
      .all<StoryRelationRow>(),
    listTagsForTarget(db, 'batch_tags', batch.id),
    // Batches that used one of this Batch's own Generations as reference material ("children" via Reference).
    db
      .prepare(
        `SELECT br.target_batch_id AS batch_id, br.source_generation_id AS source_generation_id,
          br.purpose AS purpose, br.aspect AS aspect
         FROM batch_references br
         JOIN generations g ON g.id = br.source_generation_id
         WHERE g.batch_id = ? AND br.target_batch_id != ?
         ORDER BY br.created_at ASC`,
      )
      .bind(batch.id, batch.id)
      .all<{ batch_id: string; source_generation_id: string; purpose: string | null; aspect: string | null }>(),
    // Siblings via refinement: other Batches refined from the same source_batch_id that refined this one.
    db
      .prepare(
        `SELECT br2.target_batch_id AS batch_id, br2.source_batch_id AS shared_id
         FROM batch_relations br1
         JOIN batch_relations br2 ON br2.source_batch_id = br1.source_batch_id AND br2.type = 'refinement'
         WHERE br1.target_batch_id = ? AND br1.type = 'refinement' AND br2.target_batch_id != ?`,
      )
      .bind(batch.id, batch.id)
      .all<{ batch_id: string; shared_id: string }>(),
    // Siblings via reference: other Batches that used the same source Generation(s) as this one.
    db
      .prepare(
        `SELECT br2.target_batch_id AS batch_id, br2.source_generation_id AS shared_id
         FROM batch_references br1
         JOIN batch_references br2 ON br2.source_generation_id = br1.source_generation_id
         WHERE br1.target_batch_id = ? AND br2.target_batch_id != ?`,
      )
      .bind(batch.id, batch.id)
      .all<{ batch_id: string; shared_id: string }>(),
  ]);

  const siblingsRaw = [
    ...(siblingsByRefinement.results ?? []).map((r) => ({ batch_id: r.batch_id, via: 'refinement' as const, shared_id: r.shared_id })),
    ...(siblingsByReference.results ?? []).map((r) => ({ batch_id: r.batch_id, via: 'reference' as const, shared_id: r.shared_id })),
  ];
  const seenSiblings = new Set<string>();
  const siblings = siblingsRaw.filter((s) => {
    const key = `${s.via}:${s.batch_id}:${s.shared_id}`;
    if (seenSiblings.has(key)) return false;
    seenSiblings.add(key);
    return true;
  });

  return c.json({
    ...serializeBatch(batch),
    jobs: (jobs.results ?? []).map((j) => ({
      id: j.id,
      comfy_prompt_id: j.comfy_prompt_id,
      seed: j.seed,
      index: j.job_index,
      status: j.status,
      created_at: j.created_at,
      updated_at: j.updated_at,
    })),
    generations: (generations.results ?? []).map((g) => serializeGenerationLight(g, org)),
    references: (references.results ?? []).map((r) => ({
      id: r.id,
      source_generation_id: r.source_generation_id,
      purpose: r.purpose,
      aspect: r.aspect,
      instruction: r.instruction,
      created_at: r.created_at,
    })),
    relations: {
      outgoing: (outgoingRelations.results ?? []).map((r) => ({
        id: r.id,
        target_batch_id: r.target_batch_id,
        type: r.type,
        actor: r.actor,
        reason: r.reason,
        raw_instruction: r.raw_instruction,
        created_at: r.created_at,
      })),
      incoming: (incomingRelations.results ?? []).map((r) => ({
        id: r.id,
        source_batch_id: r.source_batch_id,
        type: r.type,
        actor: r.actor,
        reason: r.reason,
        raw_instruction: r.raw_instruction,
        created_at: r.created_at,
      })),
    },
    story_relations: (storyRelations.results ?? []).map((r) => ({
      id: r.id,
      story_id: r.story_id,
      source_batch_id: r.source_batch_id,
      target_batch_id: r.target_batch_id,
      label: r.label,
      description: r.description,
      raw_instruction: r.raw_instruction,
      generated_by: r.generated_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    tags: tags.map((t) => t.name),
    reference_children: (referenceChildrenRows.results ?? []).map((r) => ({
      batch_id: r.batch_id,
      source_generation_id: r.source_generation_id,
      purpose: r.purpose,
      aspect: r.aspect,
    })),
    siblings,
  });
});

batches.post('/:batchId/jobs', async (c) => {
  const body = createJobSchema.parse(await c.req.json());
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('batchId'));

  const id = uuidv7();
  const now = nowIso();
  const result = await db
    .prepare(
      'INSERT INTO comfy_jobs (id, batch_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING',
    )
    .bind(id, batch.id, body.seed, body.index, 'created', body.idempotency_key, now, now)
    .run();

  const created = result.meta.changes === 1;
  if (!created) {
    const existing = await db
      .prepare('SELECT * FROM comfy_jobs WHERE idempotency_key = ?')
      .bind(body.idempotency_key)
      .first<ComfyJobRow>();
    return c.json(
      {
        id: existing!.id,
        batch_id: existing!.batch_id,
        seed: existing!.seed,
        index: existing!.job_index,
        status: existing!.status,
      },
      200,
    );
  }

  return c.json({ id, batch_id: batch.id, seed: body.seed, index: body.index, status: 'created' }, 201);
});

batches.put('/:id/bookmark', async (c) => {
  const batch = await getBatchOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'batches', batch.id, true);
  return c.json({ bookmark: true });
});

batches.delete('/:id/bookmark', async (c) => {
  const batch = await getBatchOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'batches', batch.id, false);
  return c.json({ bookmark: false });
});

batches.post('/:id/tags', async (c) => {
  const body = assignTagSchema.parse(await c.req.json());
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));
  const { tag, created } = await assignTag(db, 'batch_tags', batch.id, body.name, body.created_by);
  return c.json({ id: tag.id, name: tag.name }, created ? 201 : 200);
});

batches.delete('/:id/tags/:tagId', async (c) => {
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));
  await removeTag(db, 'batch_tags', batch.id, c.req.param('tagId'));
  return c.body(null, 204);
});

batches.post('/:id/references', async (c) => {
  const body = createBatchReferenceSchema.parse(await c.req.json());
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));
  const generation = await getGenerationByIdOrShortId(db, body.source_generation_id);
  if (!generation) throw notFound(`generation '${body.source_generation_id}'`);

  const id = uuidv7();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, generation.id, batch.id, body.purpose ?? null, body.aspect ?? null, body.instruction ?? null, now)
    .run();

  return c.json(
    {
      id,
      source_generation_id: generation.id,
      target_batch_id: batch.id,
      purpose: body.purpose ?? null,
      aspect: body.aspect ?? null,
      instruction: body.instruction ?? null,
      created_at: now,
    },
    201,
  );
});

batches.post('/:targetBatchId/relations', async (c) => {
  const body = createBatchRelationSchema.parse(await c.req.json());
  const db = c.env.DB;
  const targetBatch = await getBatchOr404(db, c.req.param('targetBatchId'));
  const sourceBatch = await getBatchByIdOrShortId(db, body.source_batch_id);
  if (!sourceBatch) throw notFound(`source batch '${body.source_batch_id}'`);
  if (sourceBatch.id === targetBatch.id) throw badRequest('source and target batch must differ');

  const id = uuidv7();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO batch_relations (id, source_batch_id, target_batch_id, type, actor, reason, raw_instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, sourceBatch.id, targetBatch.id, body.type ?? null, body.actor, body.reason ?? null, body.raw_instruction ?? null, now)
    .run();

  return c.json(
    {
      id,
      source_batch_id: sourceBatch.id,
      target_batch_id: targetBatch.id,
      type: body.type ?? null,
      actor: body.actor,
      reason: body.reason ?? null,
      raw_instruction: body.raw_instruction ?? null,
      created_at: now,
    },
    201,
  );
});

