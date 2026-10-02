import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import migrationSql from '../migrations/0026_requests_absorb_batches.sql?raw';
import { createBatch, createGeneration, createJob, ingestGeneration, postJson } from './helpers';

const db = env.DB;

interface RequestCols {
  id: string;
  kind: string;
  status: string;
  created_by: string;
  idempotency_key: string;
  payload_hash: string;
  run_id: string | null;
  short_id: string | null;
  recipe: string | null;
  raw_instruction: string | null;
  parameters_json: string | null;
  patches_json: string | null;
  pose_fingerprint: string | null;
  preset_versions_json: string | null;
  git_commit: string | null;
  git_dirty: number | null;
}

async function requestRow(id: string): Promise<RequestCols | null> {
  return db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<RequestCols>();
}

async function createLinkedRequest(): Promise<string> {
  const res = await postJson<{ id: string }>('/api/v1/requests', {
    kind: 'generate',
    payload: {
      schema_version: 1,
      request: { instruction: 'linked', count: 1 },
      generation: { recipe: 'yukari', parameters: {} },
    },
    idempotency_key: crypto.randomUUID(),
    created_by: 'brain',
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

// 'rebuild' 参照 + refinement relation の組で finalize 相当の Batch を作る。
async function createFinalizeLikeBatch() {
  const { batch: source, generation: sourceGen } = await createGeneration();
  const refined = await createBatch({
    refinement: { source_batch_id: source.id, actor: 'human' },
    references: [{ source_generation_id: sourceGen.id, purpose: 'rebuild' }],
  });
  expect(refined.status).toBe(201);
  return { source, sourceGen, refined: refined.body };
}

describe('Batch -> Request dual write', () => {
  it('copies batch columns onto the request the batch is keyed to', async () => {
    const requestId = await createLinkedRequest();
    const batch = await createBatch({
      idempotency_key: `request:${requestId}`,
      recipe: 'yukari',
      raw_instruction: 'draw',
      parameters: { kind: 'poster', seed: 1 },
      patches: [{ target: 'prompt.positive.pose', op: 'replace', reason: 'x' }],
      pose_fingerprint: 'fp1',
      git_commit: 'abc123',
      git_dirty: true,
    });
    expect(batch.status).toBe(201);

    const row = await requestRow(requestId);
    expect(row).toMatchObject({
      id: requestId,
      kind: 'generate',
      status: 'queued',
      created_by: 'brain',
      short_id: batch.body.short_id,
      recipe: 'yukari',
      raw_instruction: 'draw',
      pose_fingerprint: 'fp1',
      git_commit: 'abc123',
      git_dirty: 1,
    });
    expect(JSON.parse(row!.parameters_json!)).toEqual({ kind: 'poster', seed: 1 });
    expect(JSON.parse(row!.patches_json!)).toHaveLength(1);
    const synthesized = await db
      .prepare('SELECT COUNT(*) AS c FROM requests WHERE idempotency_key = ?')
      .bind(`batch:${batch.body.id}`)
      .first<{ c: number }>();
    expect(synthesized!.c).toBe(0);
  });

  it('synthesizes a request for a direct batch and does not duplicate it on resend', async () => {
    const key = crypto.randomUUID();
    const first = await createBatch({ idempotency_key: key, recipe: 'yukari', raw_instruction: 'hi' });
    expect(first.status).toBe(201);
    const resend = await createBatch({ idempotency_key: key, recipe: 'yukari', raw_instruction: 'hi' });
    expect(resend.status).toBe(200);

    const row = await requestRow(first.body.id);
    expect(row).toMatchObject({
      kind: 'generate',
      status: 'done',
      created_by: 'brain',
      idempotency_key: `batch:${first.body.id}`,
      payload_hash: 'backfill',
      short_id: first.body.short_id,
      recipe: 'yukari',
      raw_instruction: 'hi',
      git_dirty: 0,
    });
    const count = await db
      .prepare('SELECT COUNT(*) AS c FROM requests WHERE idempotency_key = ?')
      .bind(`batch:${first.body.id}`)
      .first<{ c: number }>();
    expect(count!.c).toBe(1);
  });

  it('picks the synthesized kind from parameters.kind and refinement', async () => {
    const repair = await createBatch({ parameters: { kind: 'repair' } });
    const redraw = await createBatch({ parameters: { kind: 'masked_redraw' } });
    const poster = await createBatch({ parameters: { kind: 'poster' } });
    const plain = await createBatch({ parameters: { steps: 20 } });
    const { refined } = await createFinalizeLikeBatch();
    const refinedRepair = await createBatch({ parameters: { kind: 'repair' } });

    expect((await requestRow(repair.body.id))!.kind).toBe('repair');
    expect((await requestRow(redraw.body.id))!.kind).toBe('masked_redraw');
    expect((await requestRow(poster.body.id))!.kind).toBe('import');
    expect((await requestRow(plain.body.id))!.kind).toBe('generate');
    expect((await requestRow(refined.id))!.kind).toBe('finalize');
    expect((await requestRow(refinedRepair.body.id))!.kind).toBe('repair');
  });

  it('gives jobs and generations their request_id and refines_generation_id', async () => {
    const { sourceGen, refined } = await createFinalizeLikeBatch();
    const job = await createJob(refined.id);
    const ingested = await ingestGeneration(job.body.id, {
      seed: 1,
      original_filename: 'a.png',
      comfy_output_index: 0,
    });
    expect(ingested.status).toBe(201);

    const jobRow = await db
      .prepare('SELECT request_id, source_generation_id FROM comfy_jobs WHERE id = ?')
      .bind(job.body.id)
      .first<{ request_id: string; source_generation_id: string }>();
    expect(jobRow).toEqual({ request_id: refined.id, source_generation_id: sourceGen.id });

    const genRow = await db
      .prepare('SELECT request_id, refines_generation_id FROM generations WHERE id = ?')
      .bind(ingested.body.id)
      .first<{ request_id: string; refines_generation_id: string }>();
    expect(genRow).toEqual({ request_id: refined.id, refines_generation_id: sourceGen.id });
  });

  it('uses the keyed request id for jobs and generations of a request-linked batch', async () => {
    const requestId = await createLinkedRequest();
    const { batch, generation } = await createGeneration({ batchOverrides: { idempotency_key: `request:${requestId}` } });
    const jobRow = await db
      .prepare('SELECT request_id, source_generation_id FROM comfy_jobs WHERE batch_id = ?')
      .bind(batch.id)
      .first<{ request_id: string; source_generation_id: string | null }>();
    expect(jobRow).toEqual({ request_id: requestId, source_generation_id: null });
    const genRow = await db
      .prepare('SELECT request_id, refines_generation_id FROM generations WHERE id = ?')
      .bind(generation.id)
      .first<{ request_id: string; refines_generation_id: string | null }>();
    expect(genRow).toEqual({ request_id: requestId, refines_generation_id: null });
  });

  it('propagates a late refinement to existing jobs and generations', async () => {
    const { sourceGen, source } = await createFinalizeLikeBatch();
    const { batch, job, generation } = await createGeneration();
    await postJson(`/api/v1/batches/${batch.id}/references`, {
      source_generation_id: sourceGen.id,
      purpose: 'rebuild',
    });
    await postJson(`/api/v1/batches/${batch.id}/relations`, {
      source_batch_id: source.id,
      type: 'refinement',
      actor: 'human',
    });

    const jobRow = await db
      .prepare('SELECT source_generation_id FROM comfy_jobs WHERE id = ?')
      .bind(job.id)
      .first<{ source_generation_id: string }>();
    expect(jobRow!.source_generation_id).toBe(sourceGen.id);
    const genRow = await db
      .prepare('SELECT refines_generation_id FROM generations WHERE id = ?')
      .bind(generation.id)
      .first<{ refines_generation_id: string }>();
    expect(genRow!.refines_generation_id).toBe(sourceGen.id);
  });

  it('mirrors material references but not rebuild references', async () => {
    const { generation: material } = await createGeneration();
    const { generation: rebuildSource } = await createGeneration();
    const created = await createBatch({
      references: [
        { source_generation_id: material.id, purpose: 'composition', aspect: 'pose' },
        { source_generation_id: rebuildSource.id, purpose: 'rebuild' },
      ],
    });
    const later = await postJson<{ id: string }>(`/api/v1/batches/${created.body.id}/references`, {
      source_generation_id: material.id,
      purpose: 'composition',
      aspect: 'outfit',
    });
    await postJson(`/api/v1/batches/${created.body.id}/references`, {
      source_generation_id: rebuildSource.id,
      purpose: 'rebuild',
    });

    const { results } = await db
      .prepare('SELECT id, source_generation_id, purpose, aspect FROM request_references WHERE target_request_id = ? ORDER BY aspect')
      .bind(created.body.id)
      .all<{ id: string; source_generation_id: string; purpose: string; aspect: string }>();
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.aspect)).toEqual(['outfit', 'pose']);
    expect(results.every((r) => r.purpose === 'composition' && r.source_generation_id === material.id)).toBe(true);
    expect(results.some((r) => r.id === later.body.id)).toBe(true);
    const batchRefs = await db
      .prepare('SELECT COUNT(*) AS c FROM batch_references WHERE target_batch_id = ?')
      .bind(created.body.id)
      .first<{ c: number }>();
    expect(batchRefs!.c).toBe(4);
  });

  it('sets run_id on a synthesized request when a run attaches the batch', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: `exp-${crypto.randomUUID()}` });
    const batchA = await createBatch();
    const batchB = await createBatch();

    const createdRun = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {
      batch_id: batchA.body.id,
    });
    expect(createdRun.status).toBe(201);
    expect((await requestRow(batchA.body.id))!.run_id).toBe(createdRun.body.id);

    const pending = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
    const attached = await postJson(`/api/v1/experiment-runs/${pending.body.id}`, { batch_id: batchB.body.id }, 'PATCH');
    expect(attached.status).toBe(200);
    expect((await requestRow(batchB.body.id))!.run_id).toBe(pending.body.id);
  });

  it('mirrors preset pins written at request done onto the request', async () => {
    const pins = [{ kind: 'pose', name: 'lounge', version: 1 }];
    const created = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'pins', count: 1 },
        generation: { recipe: 'yukari', parameters: {} },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(created.status).toBe(201);
    await db
      .prepare("UPDATE requests SET payload_json = json_set(payload_json, '$.generation.presets', json(?)) WHERE id = ?")
      .bind(JSON.stringify(pins), created.body.id)
      .run();
    await db.prepare("UPDATE requests SET status = 'running', worker_id = 'worker-a' WHERE id = ?").bind(created.body.id).run();
    const batch = await createBatch({ idempotency_key: `request:${created.body.id}` });
    const done = await postJson(
      `/api/v1/requests/${created.body.id}`,
      { status: 'done', worker_id: 'worker-a', result: { batch_id: batch.body.id, generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(200);

    const batchDetail = await db
      .prepare('SELECT preset_versions_json FROM batches WHERE id = ?')
      .bind(batch.body.id)
      .first<{ preset_versions_json: string | null }>();
    const requestDetail = await requestRow(created.body.id);
    expect(JSON.parse(batchDetail!.preset_versions_json!)).toEqual(pins);
    expect(JSON.parse(requestDetail!.preset_versions_json!)).toEqual(pins);
  });
});

describe('0026 backfill', () => {
  const backfillStatements = migrationSql
    .split('-- BACKFILL')[1]!
    .split('-- END BACKFILL')[0]!
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  async function insertLegacyBatch(
    id: string,
    shortId: string,
    key: string,
    extra: { parameters?: string | null; refines?: string | null; recipe?: string | null } = {},
  ) {
    await db
      .prepare(
        `INSERT INTO batches (id, short_id, recipe, raw_instruction, parameters_json, git_commit, git_dirty, status,
           idempotency_key, created_at, updated_at, patches_json, pose_fingerprint, preset_versions_json, refines_generation_id)
         VALUES (?, ?, ?, 'instr', ?, 'c0ffee', 1, 'completed', ?, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
           '[]', 'fp', '[{"p":1}]', ?)`,
      )
      .bind(id, shortId, extra.recipe ?? 'yukari', extra.parameters ?? null, key, extra.refines ?? null)
      .run();
  }

  it('maps keyed batches onto their request and synthesizes the rest', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { generation: raw } = await createGeneration();
    const mappedReq = `req-${tag}`;
    await db
      .prepare(
        `INSERT INTO requests (id, kind, status, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, 'generate', 'done', '{}', 'h', ?, 'brain', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .bind(mappedReq, `req-key-${tag}`)
      .run();

    const ids = {
      mapped: `bm-${tag}`,
      plain: `bp-${tag}`,
      repair: `br-${tag}`,
      finalize: `bf-${tag}`,
      imported: `bi-${tag}`,
      orphanKey: `bo-${tag}`,
    };
    await insertLegacyBatch(ids.mapped, `m${tag}`, `request:${mappedReq}`, { parameters: '{"seed":1}' });
    await insertLegacyBatch(ids.plain, `p${tag}`, `k-${tag}-1`);
    await insertLegacyBatch(ids.repair, `r${tag}`, `k-${tag}-2`, { parameters: '{"kind":"repair"}' });
    await insertLegacyBatch(ids.finalize, `f${tag}`, `k-${tag}-3`, { refines: raw.id });
    await insertLegacyBatch(ids.imported, `i${tag}`, `k-${tag}-4`, { parameters: '{"kind":"hand-edit"}' });
    await insertLegacyBatch(ids.orphanKey, `o${tag}`, `request:missing-${tag}`);

    const runId = `run-${tag}`;
    const experimentId = `exp-${tag}`;
    await db
      .prepare("INSERT INTO experiments (id, name, created_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z')")
      .bind(experimentId, experimentId)
      .run();
    await db
      .prepare(
        `INSERT INTO experiment_runs (id, experiment_id, run_index, batch_id, overrides_json, created_at, updated_at)
         VALUES (?, ?, 1, ?, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .bind(runId, experimentId, ids.plain)
      .run();

    const insertJob = (id: string, batchId: string, index: number) =>
      db
        .prepare(
          `INSERT INTO comfy_jobs (id, batch_id, seed, job_index, status, idempotency_key, created_at, updated_at)
           VALUES (?, ?, 1, ?, 'ingested', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .bind(id, batchId, index, `job-${id}`)
        .run();
    await insertJob(`jm-${tag}`, ids.mapped, 0);
    await insertJob(`jf-${tag}`, ids.finalize, 0);
    const insertGeneration = (id: string, batchId: string, jobId: string) =>
      db
        .prepare(
          `INSERT INTO generations (id, short_id, batch_id, comfy_job_id, seed, original_filename, comfy_output_index,
             r2_object_key, bookmark, created_at)
           VALUES (?, ?, ?, ?, 1, 'a.png', 0, ?, 0, '2026-01-01T00:00:00.000Z')`,
        )
        .bind(id, `g${id}`.slice(0, 12), batchId, jobId, `generations/${id}/original.png`)
        .run();
    await insertGeneration(`gm-${tag}`, ids.mapped, `jm-${tag}`);
    await insertGeneration(`gf-${tag}`, ids.finalize, `jf-${tag}`);

    await db
      .prepare(
        `INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, '2026-01-01T00:00:00.000Z')`,
      )
      .bind(`ref-m-${tag}`, raw.id, ids.mapped, 'composition', 'pose')
      .run();
    await db
      .prepare(
        `INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at)
         VALUES (?, ?, ?, 'rebuild', NULL, NULL, '2026-01-01T00:00:00.000Z')`,
      )
      .bind(`ref-r-${tag}`, raw.id, ids.finalize)
      .run();
    await db
      .prepare(
        `INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z')`,
      )
      .bind(`ref-n-${tag}`, raw.id, ids.plain)
      .run();

    // 先に走った dual write の行を消して、migration 前の状態 (Batch だけがある) に戻す。
    await db.prepare('DELETE FROM request_references').run();
    await db.prepare("DELETE FROM requests WHERE idempotency_key LIKE 'batch:%'").run();

    for (const statement of backfillStatements) await db.prepare(statement).run();

    const mapped = await requestRow(mappedReq);
    expect(mapped).toMatchObject({
      status: 'done',
      created_by: 'brain',
      short_id: `m${tag}`,
      recipe: 'yukari',
      raw_instruction: 'instr',
      pose_fingerprint: 'fp',
      git_commit: 'c0ffee',
      git_dirty: 1,
      patches_json: '[]',
      preset_versions_json: '[{"p":1}]',
    });
    expect(mapped!.parameters_json).toBe('{"seed":1}');
    expect(await requestRow(ids.mapped)).toBeNull();

    const plain = await requestRow(ids.plain);
    expect(plain).toMatchObject({
      kind: 'generate',
      status: 'done',
      created_by: 'system',
      idempotency_key: `batch:${ids.plain}`,
      payload_hash: 'backfill',
      run_id: runId,
      short_id: `p${tag}`,
    });
    const plainFull = await db
      .prepare('SELECT payload_json, recipe_ref, created_at, updated_at, finished_at FROM requests WHERE id = ?')
      .bind(ids.plain)
      .first<Record<string, string>>();
    expect(JSON.parse(plainFull!.payload_json!)).toEqual({ schema_version: 1, legacy_batch_id: ids.plain });
    expect(plainFull).toMatchObject({
      recipe_ref: 'production',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      finished_at: '2026-01-02T00:00:00.000Z',
    });
    expect((await requestRow(ids.repair))!.kind).toBe('repair');
    expect((await requestRow(ids.finalize))!.kind).toBe('finalize');
    expect((await requestRow(ids.imported))!.kind).toBe('import');
    expect((await requestRow(ids.orphanKey))!.kind).toBe('generate');

    const job = await db
      .prepare('SELECT id, request_id, source_generation_id FROM comfy_jobs WHERE id IN (?, ?) ORDER BY id')
      .bind(`jm-${tag}`, `jf-${tag}`)
      .all<{ id: string; request_id: string; source_generation_id: string | null }>();
    expect(job.results).toEqual([
      { id: `jf-${tag}`, request_id: ids.finalize, source_generation_id: raw.id },
      { id: `jm-${tag}`, request_id: mappedReq, source_generation_id: null },
    ]);
    const gens = await db
      .prepare('SELECT id, request_id, refines_generation_id FROM generations WHERE id IN (?, ?) ORDER BY id')
      .bind(`gm-${tag}`, `gf-${tag}`)
      .all<{ id: string; request_id: string; refines_generation_id: string | null }>();
    expect(gens.results).toEqual([
      { id: `gf-${tag}`, request_id: ids.finalize, refines_generation_id: raw.id },
      { id: `gm-${tag}`, request_id: mappedReq, refines_generation_id: null },
    ]);

    const refs = await db
      .prepare('SELECT id, target_request_id, purpose FROM request_references WHERE id LIKE ? ORDER BY id')
      .bind(`ref-%-${tag}`)
      .all<{ id: string; target_request_id: string; purpose: string | null }>();
    expect(refs.results).toEqual([
      { id: `ref-m-${tag}`, target_request_id: mappedReq, purpose: 'composition' },
      { id: `ref-n-${tag}`, target_request_id: ids.plain, purpose: null },
    ]);
  });
});
