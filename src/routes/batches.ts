import { Hono } from 'hono';
import {
  createBatchSchema,
  updateBatchSchema,
  createBatchReferenceSchema,
  createBatchRelationSchema,
} from '../schemas/batches';
import { createJobSchema } from '../schemas/jobs';
import { uuidv7 } from '../lib/uuidv7';
import { createUniqueShortId } from '../lib/shortid';
import { nowIso, getBatchByIdOrShortId, getGenerationByIdOrShortId, resolveGenerationShortIds } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { serializeBatch, serializeGenerationLight } from '../lib/serialize';
import { renderFactsForJob } from '../lib/render-facts';
import { refinesGenerationUpdateStatement } from '../lib/batch-refinement';
import {
  batchRequestStatements,
  JOB_REQUEST_ID_SQL,
  JOB_SOURCE_GENERATION_ID_SQL,
  propagateRefinesStatements,
  requestReferenceStatement,
} from '../lib/batch-request-sync';
import type {
  AppEnv,
  BatchRelationRow,
  BatchReferenceRow,
  BatchRow,
  ComfyJobRow,
  GenerationRow,
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

// worker-protocol.md「再送レスポンスに含めるもの」: 再送は jobs[]（seed/status/comfy_prompt_id +
// ingest 済み generations）を含める。graph は含めない（recipe と seed から再構築できる）。
async function buildReplayJobs(db: D1Database, batchId: string) {
  const [jobsResult, generationsResult] = await Promise.all([
    db.prepare('SELECT * FROM comfy_jobs WHERE batch_id = ? ORDER BY job_index ASC').bind(batchId).all<ComfyJobRow>(),
    db
      .prepare('SELECT id, comfy_job_id, comfy_output_index FROM generations WHERE batch_id = ? ORDER BY created_at ASC, id ASC')
      .bind(batchId)
      .all<{ id: string; comfy_job_id: string; comfy_output_index: number | null }>(),
  ]);

  const generationsByJobId = new Map<string, { id: string; comfy_output_index: number | null }[]>();
  for (const g of generationsResult.results ?? []) {
    const list = generationsByJobId.get(g.comfy_job_id) ?? [];
    list.push({ id: g.id, comfy_output_index: g.comfy_output_index });
    generationsByJobId.set(g.comfy_job_id, list);
  }

  return (jobsResult.results ?? []).map((j) => ({
    id: j.id,
    index: j.job_index,
    seed: j.seed,
    status: j.status,
    comfy_prompt_id: j.comfy_prompt_id,
    generations: generationsByJobId.get(j.id) ?? [],
  }));
}

batches.post('/', async (c) => {
  const body = createBatchSchema.parse(await c.req.json());
  const db = c.env.DB;

  const replayed = await db
    .prepare('SELECT * FROM batches WHERE idempotency_key = ?')
    .bind(body.idempotency_key)
    .first<BatchRow>();
  if (replayed) return c.json({ ...serializeBatch(replayed), jobs: await buildReplayJobs(db, replayed.id) }, 200);

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

  const id = uuidv7();
  // Request に作成時に発行した short_id がある Request 紐づきの Batch は、それを引き継ぐ (/b/{short_id} を 1 つに保つ)。
  const linkedRequestId = body.idempotency_key.startsWith('request:') ? body.idempotency_key.slice('request:'.length) : null;
  const linkedShortId = linkedRequestId
    ? ((await db.prepare('SELECT short_id FROM requests WHERE id = ?').bind(linkedRequestId).first<{ short_id: string | null }>())?.short_id ?? null)
    : null;
  const shortId = linkedShortId ?? (await createUniqueShortId(db, 'batches', ['requests']));
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
    patches_json: body.patches ? JSON.stringify(body.patches) : null,
    pose_fingerprint: body.pose_fingerprint ?? null,
    preset_versions_json: null, // request 完了時に lib/requests.ts が preset pin から書く
    refines_generation_id: null, // refinesGenerationUpdateStatement (下) が同一 db.batch 内で計算
  };

  const statements = [
    db
      .prepare(
        `INSERT INTO batches (id, short_id, experiment_id, raw_instruction, recipe, prompt, negative_prompt,
          parameters_json, git_commit, git_dirty, note, bookmark, status, idempotency_key, created_at, updated_at,
          patches_json, pose_fingerprint, preset_versions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.patches_json,
        row.pose_fingerprint,
        row.preset_versions_json,
      ),
  ];

  const requestReferenceStatements: D1PreparedStatement[] = [];
  for (const ref of resolvedReferences) {
    const refId = uuidv7();
    statements.push(
      db
        .prepare(
          'INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(refId, ref.generationId, id, ref.purpose ?? null, ref.aspect ?? null, ref.instruction ?? null, now),
    );
    requestReferenceStatements.push(
      requestReferenceStatement(db, {
        id: refId,
        batchId: id,
        generationId: ref.generationId,
        purpose: ref.purpose ?? null,
        aspect: ref.aspect ?? null,
        instruction: ref.instruction ?? null,
        createdAt: now,
      }),
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

  statements.push(refinesGenerationUpdateStatement(db, id));
  statements.push(...batchRequestStatements(db, id), ...requestReferenceStatements);

  try {
    // db.batch is transactional: a concurrent same-idempotency-key request fails the unique
    // constraint and rolls back the reference/relation inserts too — no orphaned rows.
    await db.batch(statements);
  } catch (err) {
    const raced = await db
      .prepare('SELECT * FROM batches WHERE idempotency_key = ?')
      .bind(body.idempotency_key)
      .first<BatchRow>();
    if (!raced) throw err;
    return c.json({ ...serializeBatch(raced), jobs: await buildReplayJobs(db, raced.id) }, 200);
  }

  // refines_generation_id は db.batch 内の UPDATE で確定するので、in-memory row (null 固定) ではなく読み直す。
  const created = (await getBatchByIdOrShortId(db, id))!;

  // provenance が全部空の登録は request.json 契約を経由していない可能性が高いが、自動化を壊さないよう拒否せず warn のみ。
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
    return c.json({ ...serializeBatch(created), warnings: [warning] }, 201);
  }

  return c.json(serializeBatch(created), 201);
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

// 現行の comfyui-recipes (finalize / repair / masked_redraw / work) が仕上げ元の Batch を読むために残している。
// 段階 4 で /api/v1/batches* と一緒に撤去する。
batches.get('/:id', async (c) => {
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));
  const org = origin(c);

  const [jobs, generations, references, outgoingRelations, incomingRelations] = await Promise.all([
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
  ]);

  const jobRows = jobs.results ?? [];
  const renderFactsByJobId = new Map(
    await Promise.all(jobRows.map(async (j) => [j.id, await renderFactsForJob(db, j)] as const)),
  );

  const generationRows = generations.results ?? [];
  const refinesShortIds = await resolveGenerationShortIds(db, batch.refines_generation_id ? [batch.refines_generation_id] : []);
  const refinesGenerationShortId = batch.refines_generation_id
    ? (refinesShortIds.get(batch.refines_generation_id) ?? null)
    : null;

  return c.json({
    ...serializeBatch(batch),
    jobs: jobRows.map((j) => ({
      id: j.id,
      comfy_prompt_id: j.comfy_prompt_id,
      seed: j.seed,
      index: j.job_index,
      status: j.status,
      graph: j.graph ? JSON.parse(j.graph) : null,
      render_facts: renderFactsByJobId.get(j.id) ?? null,
      created_at: j.created_at,
      updated_at: j.updated_at,
    })),
    generations: generationRows.map((g) => ({
      ...serializeGenerationLight(g, org),
      refines_generation_short_id: refinesGenerationShortId,
    })),
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
      `INSERT INTO comfy_jobs (id, batch_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, request_id, source_generation_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ${JOB_REQUEST_ID_SQL}, ${JOB_SOURCE_GENERATION_ID_SQL}) ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .bind(id, batch.id, body.seed, body.index, 'created', body.idempotency_key, now, now, batch.id, batch.id)
    .run();

  const created = result.meta.changes === 1;
  if (!created) {
    const existing = await db
      .prepare('SELECT * FROM comfy_jobs WHERE idempotency_key = ?')
      .bind(body.idempotency_key)
      .first<ComfyJobRow>();
    const generationsResult = await db
      .prepare('SELECT id, comfy_output_index FROM generations WHERE comfy_job_id = ? ORDER BY created_at ASC, id ASC')
      .bind(existing!.id)
      .all<{ id: string; comfy_output_index: number | null }>();
    return c.json(
      {
        id: existing!.id,
        batch_id: existing!.batch_id,
        seed: existing!.seed,
        index: existing!.job_index,
        status: existing!.status,
        comfy_prompt_id: existing!.comfy_prompt_id,
        generations: (generationsResult.results ?? []).map((g) => ({ id: g.id, comfy_output_index: g.comfy_output_index })),
      },
      200,
    );
  }

  return c.json(
    { id, batch_id: batch.id, seed: body.seed, index: body.index, status: 'created', comfy_prompt_id: null, generations: [] },
    201,
  );
});

batches.post('/:id/references', async (c) => {
  const body = createBatchReferenceSchema.parse(await c.req.json());
  const db = c.env.DB;
  const batch = await getBatchOr404(db, c.req.param('id'));
  const generation = await getGenerationByIdOrShortId(db, body.source_generation_id);
  if (!generation) throw notFound(`generation '${body.source_generation_id}'`);

  const id = uuidv7();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        'INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, generation.id, batch.id, body.purpose ?? null, body.aspect ?? null, body.instruction ?? null, now),
    requestReferenceStatement(db, {
      id,
      batchId: batch.id,
      generationId: generation.id,
      purpose: body.purpose ?? null,
      aspect: body.aspect ?? null,
      instruction: body.instruction ?? null,
      createdAt: now,
    }),
    refinesGenerationUpdateStatement(db, batch.id),
    ...propagateRefinesStatements(db, batch.id),
  ]);

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
  await db.batch([
    db
      .prepare(
        'INSERT INTO batch_relations (id, source_batch_id, target_batch_id, type, actor, reason, raw_instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, sourceBatch.id, targetBatch.id, body.type ?? null, body.actor, body.reason ?? null, body.raw_instruction ?? null, now),
    refinesGenerationUpdateStatement(db, targetBatch.id),
    ...propagateRefinesStatements(db, targetBatch.id),
  ]);

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

