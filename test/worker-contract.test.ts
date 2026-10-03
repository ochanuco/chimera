// Batch 廃止の段階 3 (docs/batch-removal.md): worker が /api/v1/batches を呼ばずに Request へ直接書く契約の検証。
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, ingestGeneration, postJson } from './helpers';

const WORKER = 'worker-test';

interface Req {
  id: string;
  short_id: string | null;
  kind: string;
  status: string;
  run_id?: string | null;
  result: { generation_ids: string[] } | null;
}

interface ResolutionResponse {
  id: string;
  short_id: string;
  status: string;
  jobs: { id: string; index: number; seed: number; status: string; comfy_prompt_id: string | null; generations: { id: string; comfy_output_index: number | null }[] }[];
}

const generatePayload = (instruction = 'contract') => ({
  schema_version: 1,
  request: { instruction, count: 1 },
  generation: { recipe: 'yukari', parameters: {} },
});

async function queue(kind: string, payload: unknown, extra: Record<string, unknown> = {}) {
  const res = await postJson<Req>('/api/v1/requests', {
    kind,
    payload,
    idempotency_key: crypto.randomUUID(),
    created_by: 'brain',
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function claim(id: string): Promise<Req> {
  // 他テストの queued 行を拾わないよう、目的の行が返るまで claim する。
  for (let i = 0; i < 50; i++) {
    const res = await postJson<Req>('/api/v1/requests/claim', { worker_id: WORKER });
    if (res.status === 204) break;
    if (res.body.id === id) return res.body;
    await postJson(`/api/v1/requests/${res.body.id}`, { status: 'queued', worker_id: WORKER }, 'PATCH');
    await env.DB.prepare('UPDATE requests SET created_at = ? WHERE id = ?').bind('2999-01-01T00:00:00.000Z', res.body.id).run();
  }
  throw new Error('request not claimable');
}

const resolution = (extra: Record<string, unknown> = {}) => ({
  recipe: 'yukari',
  raw_instruction: 'contract',
  parameters: { pose: 'lounge', seed_count: 1 },
  git_commit: 'abc1234',
  git_dirty: false,
  worker_id: WORKER,
  ...extra,
});

async function putResolution(id: string, body: Record<string, unknown>) {
  return postJson<ResolutionResponse>(`/api/v1/requests/${id}/resolution`, body, 'PUT');
}

async function postJob(id: string, body: Record<string, unknown>) {
  return postJson<{ id: string; status: string; generations: unknown[]; source_generation_id: string | null }>(`/api/v1/requests/${id}/jobs`, body);
}

async function batchCount(): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS c FROM batches').first<{ c: number }>())!.c;
}

async function runToDone(id: string, jobBody: Record<string, unknown>) {
  const job = await postJob(id, jobBody);
  expect(job.status).toBe(201);
  const ingest = await ingestGeneration(job.body.id, { seed: 1, original_filename: 'o.png', comfy_output_index: 0 });
  expect(ingest.status).toBe(201);
  const done = await postJson<Req>(
    `/api/v1/requests/${id}`,
    { status: 'done', worker_id: WORKER, result: { generation_ids: [ingest.body.id] } },
    'PATCH',
  );
  expect(done.status).toBe(200);
  return { job: job.body, generation: ingest.body, done: done.body };
}

describe('short_id issuance', () => {
  it('issues a short_id at creation and exposes it on get and claim', async () => {
    const r = await queue('generate', generatePayload());
    expect(r.short_id).toMatch(/^[a-z0-9]{6}$/);
    expect((await getJson<Req>(`/api/v1/requests/${r.id}`)).body.short_id).toBe(r.short_id);
    expect((await claim(r.id)).short_id).toBe(r.short_id);
  });

  it('a request-linked batch reuses the request short_id and the sync does not overwrite it', async () => {
    const r = await queue('generate', generatePayload());
    const batch = await postJson<{ short_id: string }>('/api/v1/batches', {
      idempotency_key: `request:${r.id}`,
      prompt: 'p',
      recipe: 'yukari',
    });
    expect(batch.status).toBe(201);
    expect(batch.body.short_id).toBe(r.short_id);
    expect((await getJson<Req>(`/api/v1/requests/${r.id}`)).body.short_id).toBe(r.short_id);
  });
});

describe('PUT /requests/{id}/resolution', () => {
  it('stores the values, is idempotent, overwrites before jobs and conflicts after', async () => {
    const r = await queue('generate', generatePayload());
    await claim(r.id);

    const first = await putResolution(r.id, resolution());
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: r.id, short_id: r.short_id, status: 'running', jobs: [] });

    const row = await env.DB.prepare('SELECT recipe, git_commit, git_dirty, parameters_json FROM requests WHERE id = ?')
      .bind(r.id)
      .first<{ recipe: string; git_commit: string; git_dirty: number; parameters_json: string }>();
    expect(row).toMatchObject({ recipe: 'yukari', git_commit: 'abc1234', git_dirty: 0 });
    expect(JSON.parse(row!.parameters_json)).toEqual({ pose: 'lounge', seed_count: 1 });

    expect((await putResolution(r.id, resolution())).status).toBe(200);

    const changed = await putResolution(r.id, resolution({ parameters: { pose: 'sit' } }));
    expect(changed.status).toBe(200);
    expect(JSON.parse((await env.DB.prepare('SELECT parameters_json FROM requests WHERE id = ?').bind(r.id).first<{ parameters_json: string }>())!.parameters_json)).toEqual({ pose: 'sit' });

    expect((await postJob(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0 })).status).toBe(201);
    expect((await putResolution(r.id, resolution({ parameters: { pose: 'sit' } }))).status).toBe(200);
    expect((await putResolution(r.id, resolution({ parameters: { pose: 'stand' } }))).status).toBe(409);
  });

  it('requires pose_fingerprint with patches and skips rebuild references', async () => {
    const r = await queue('generate', generatePayload());
    const patches = [{ target: 'prompt.positive', op: 'append', reason: 'x' }];
    expect((await putResolution(r.id, resolution({ patches }))).status).toBe(400);

    const { generation } = await createGeneration();
    const ok = await putResolution(
      r.id,
      resolution({
        patches,
        pose_fingerprint: 'fp1',
        references: [
          { source_generation_id: generation.id, purpose: 'pose', aspect: 'composition' },
          { generation_id: generation.short_id, purpose: 'rebuild' },
        ],
      }),
    );
    expect(ok.status).toBe(200);
    const refs = await env.DB.prepare('SELECT purpose, aspect, source_generation_id FROM request_references WHERE target_request_id = ?')
      .bind(r.id)
      .all<{ purpose: string; aspect: string; source_generation_id: string }>();
    expect(refs.results).toEqual([{ purpose: 'pose', aspect: 'composition', source_generation_id: generation.id }]);

    const missing = await putResolution(r.id, resolution({ references: [{ source_generation_id: 'zzzzzz' }] }));
    expect(missing.status).toBe(404);
  });

  it('rejects a mismatching worker_id on a running request', async () => {
    const r = await queue('generate', generatePayload());
    await claim(r.id);
    expect((await putResolution(r.id, resolution({ worker_id: 'someone-else' }))).status).toBe(409);
  });
});

describe('worker flow without /api/v1/batches', () => {
  it('generate: claim -> resolution -> job -> ingest -> done', async () => {
    const before = await batchCount();
    const r = await queue('generate', generatePayload());
    await claim(r.id);

    expect((await postJob(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0 })).status).toBe(409);

    expect((await putResolution(r.id, resolution())).status).toBe(200);
    const { job, generation, done } = await runToDone(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0 });
    expect(done.status).toBe('done');

    const gen = await env.DB.prepare('SELECT request_id, refines_generation_id, batch_id FROM generations WHERE id = ?')
      .bind(generation.id)
      .first<{ request_id: string; refines_generation_id: string | null; batch_id: string }>();
    expect(gen).toMatchObject({ request_id: r.id, refines_generation_id: null });
    const shadow = await env.DB.prepare('SELECT id, short_id, status, idempotency_key FROM batches WHERE id = ?')
      .bind(gen!.batch_id)
      .first<{ id: string; short_id: string; status: string; idempotency_key: string }>();
    expect(shadow).toMatchObject({ short_id: r.short_id, status: 'completed', idempotency_key: `request:${r.id}` });
    expect(await batchCount()).toBe(before + 1);
    expect(job.id).toBeTruthy();

    // 同期が補う Request を二重に作らない。
    const linked = await env.DB.prepare("SELECT COUNT(*) AS c FROM requests WHERE idempotency_key LIKE 'batch:%' AND id = ?").bind(gen!.batch_id).first<{ c: number }>();
    expect(linked!.c).toBe(0);
  });

  it('finalize: source_generation_id is required, sets refines and the legacy rebuild reference', async () => {
    const { generation: source } = await createGeneration();
    const r = await queue('finalize', { generation_id: source.id });
    await claim(r.id);
    expect((await putResolution(r.id, resolution({ parameters: { kind: 'finalize' } }))).status).toBe(200);

    expect((await postJob(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0 })).status).toBe(400);
    expect((await postJob(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0, source_generation_id: 'nope00' })).status).toBe(404);

    const { generation } = await runToDone(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0, source_generation_id: source.short_id });
    const gen = await env.DB.prepare('SELECT refines_generation_id, batch_id FROM generations WHERE id = ?')
      .bind(generation.id)
      .first<{ refines_generation_id: string; batch_id: string }>();
    expect(gen!.refines_generation_id).toBe(source.id);
    const batch = await env.DB.prepare('SELECT refines_generation_id FROM batches WHERE id = ?').bind(gen!.batch_id).first<{ refines_generation_id: string }>();
    expect(batch!.refines_generation_id).toBe(source.id);
    const rel = await env.DB.prepare("SELECT COUNT(*) AS c FROM batch_relations WHERE target_batch_id = ? AND type = 'refinement'").bind(gen!.batch_id).first<{ c: number }>();
    expect(rel!.c).toBe(1);

    const detail = await getJson<{ refines_generation: { id: string } | null }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.refines_generation?.id).toBe(source.id);
  });

  it('repair: source_generation_id per job, two sources share one request', async () => {
    const a = await createGeneration();
    const b = await createGeneration();
    const r = await queue('repair', { generation_id: a.generation.id });
    await claim(r.id);
    expect((await putResolution(r.id, resolution({ parameters: { kind: 'repair' } }))).status).toBe(200);

    const j0 = await postJob(r.id, { idempotency_key: `request:${r.id}:job:0`, seed: 1, index: 0, source_generation_id: a.generation.id });
    const j1 = await postJob(r.id, { idempotency_key: `request:${r.id}:job:1`, seed: 2, index: 1, source_generation_id: b.generation.id });
    expect(j0.status).toBe(201);
    expect(j1.status).toBe(201);
    const g1 = await ingestGeneration(j1.body.id, { seed: 2, original_filename: 'o.png', comfy_output_index: 0 });
    const row = await env.DB.prepare('SELECT refines_generation_id FROM generations WHERE id = ?').bind(g1.body.id).first<{ refines_generation_id: string }>();
    expect(row!.refines_generation_id).toBe(b.generation.id);
  });

  it('generate rejects a source_generation_id', async () => {
    const { generation } = await createGeneration();
    const r = await queue('generate', generatePayload());
    await putResolution(r.id, resolution());
    expect((await postJob(r.id, { idempotency_key: crypto.randomUUID(), seed: 1, index: 0, source_generation_id: generation.id })).status).toBe(400);
  });

  it('resume: resolution resend returns jobs with ingested status and a job resend returns the same job', async () => {
    const r = await queue('generate', generatePayload());
    await claim(r.id);
    await putResolution(r.id, resolution());
    const key = `request:${r.id}:job:0`;
    const j0 = await postJob(r.id, { idempotency_key: key, seed: 1, index: 0 });
    const j1 = await postJob(r.id, { idempotency_key: `request:${r.id}:job:1`, seed: 2, index: 1 });
    const g = await ingestGeneration(j0.body.id, { seed: 1, original_filename: 'o.png', comfy_output_index: 0 });

    const resume = await putResolution(r.id, resolution());
    expect(resume.status).toBe(200);
    expect(resume.body.jobs.map((j) => [j.id, j.index, j.status])).toEqual([
      [j0.body.id, 0, 'ingested'],
      [j1.body.id, 1, 'created'],
    ]);
    expect(resume.body.jobs[0]!.generations).toEqual([{ id: g.body.id, comfy_output_index: 0 }]);

    const again = await postJob(r.id, { idempotency_key: key, seed: 1, index: 0 });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(j0.body.id);
    expect(again.body.status).toBe('ingested');
    expect(again.body.generations).toHaveLength(1);
  });

  it('failed request marks the shadow batch failed', async () => {
    const r = await queue('generate', generatePayload());
    await claim(r.id);
    await putResolution(r.id, resolution());
    await postJson(`/api/v1/requests/${r.id}`, { status: 'failed', worker_id: WORKER, error: 'boom' }, 'PATCH');
    const b = await env.DB.prepare('SELECT status FROM batches WHERE idempotency_key = ?').bind(`request:${r.id}`).first<{ status: string }>();
    expect(b!.status).toBe('failed');
  });

  it('attaches the shadow batch to the run on done', async () => {
    const exp = await postJson<{ id: string }>('/api/v1/experiments', { name: `exp-${crypto.randomUUID()}`, base_recipe: 'yukari' });
    expect(exp.status).toBe(201);
    const run = await postJson<{ id: string; request_id: string }>(`/api/v1/experiments/${exp.body.id}/runs`, {});
    expect(run.status).toBe(201);
    const id = run.body.request_id;
    await claim(id);
    await putResolution(id, resolution());
    await runToDone(id, { idempotency_key: `request:${id}:job:0`, seed: 1, index: 0 });
    const runRow = await env.DB.prepare('SELECT batch_id FROM experiment_runs WHERE id = ?').bind(run.body.id).first<{ batch_id: string | null }>();
    expect(runRow!.batch_id).toBe(id);
  });
});

describe('kind import', () => {
  const importBody = (extra: Record<string, unknown> = {}) => ({
    kind: 'import',
    status: 'done',
    idempotency_key: `import-${crypto.randomUUID()}`,
    created_by: 'brain',
    recipe: null,
    raw_instruction: 'hand edit',
    parameters: { kind: 'hand-edit' },
    git_commit: 'abc1234',
    git_dirty: false,
    ...extra,
  });

  it('creates a done request, resends idempotently, and ingests through a job', async () => {
    const body = importBody();
    const created = await postJson<Req>('/api/v1/requests', body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'import', status: 'done' });
    expect(created.body.short_id).toMatch(/^[a-z0-9]{6}$/);

    const resend = await postJson<Req>('/api/v1/requests', body);
    expect(resend.status).toBe(200);
    expect(resend.body.id).toBe(created.body.id);
    expect((await postJson('/api/v1/requests', { ...body, parameters: { kind: 'other' } })).status).toBe(409);

    const job = await postJob(created.body.id, { idempotency_key: `request:${created.body.id}:job:0`, seed: 0, index: 0 });
    expect(job.status).toBe(201);
    const g = await ingestGeneration(job.body.id, { seed: 0, original_filename: 'o.png', comfy_output_index: 0 });
    expect(g.status).toBe(201);
    const row = await env.DB.prepare('SELECT request_id FROM generations WHERE id = ?').bind(g.body.id).first<{ request_id: string }>();
    expect(row!.request_id).toBe(created.body.id);

    const detail = await getJson<{ batch_id?: string }>(`/api/v1/generations/${g.body.id}`);
    expect(detail.status).toBe(200);
  });

  it('links a run through run_id and takes it off the pending list', async () => {
    // base_recipe の無い Experiment の Run は requests が自動起票されず pending に残る。
    const exp = await postJson<{ id: string }>('/api/v1/experiments', { name: `exp-${crypto.randomUUID()}` });
    const run = await postJson<{ id: string }>(`/api/v1/experiments/${exp.body.id}/runs`, {});
    const pending = async () =>
      (await getJson<{ items: { id: string }[] }>('/api/v1/experiment-runs?pending=true&limit=200')).body.items.map((r) => r.id);
    expect(await pending()).toContain(run.body.id);

    const created = await postJson<Req>('/api/v1/requests', importBody({ run_id: run.body.id }));
    expect(created.status).toBe(201);
    expect(created.body.run_id).toBe(run.body.id);
    expect(await pending()).not.toContain(run.body.id);
    const runRow = await env.DB.prepare('SELECT batch_id FROM experiment_runs WHERE id = ?').bind(run.body.id).first<{ batch_id: string | null }>();
    expect(runRow!.batch_id).not.toBeNull();

    expect((await postJson('/api/v1/requests', importBody({ run_id: run.body.id }))).status).toBe(409);
    expect((await postJson('/api/v1/requests', importBody({ run_id: 'missing-run' }))).status).toBe(404);
  });

  it('rejects run_id on non-import kinds', async () => {
    const res = await postJson('/api/v1/requests', {
      kind: 'generate',
      run_id: 'x',
      idempotency_key: `gen-${crypto.randomUUID()}`,
      created_by: 'brain',
      payload: { schema_version: 1, request: { instruction: 'x', count: 1 }, generation: { recipe: 'yukari' } },
    });
    expect(res.status).toBe(400);
  });

  it('validates the import envelope', async () => {
    expect((await postJson('/api/v1/requests', importBody({ status: undefined }))).status).toBe(400);
    expect((await postJson('/api/v1/requests', importBody({ parameters: undefined }))).status).toBe(400);
    expect((await postJson('/api/v1/requests', { kind: 'generate', payload: generatePayload(), idempotency_key: crypto.randomUUID(), created_by: 'brain', status: 'done' })).status).toBe(400);
    expect((await postJson('/api/v1/requests', { kind: 'generate', payload: generatePayload(), idempotency_key: crypto.randomUUID(), created_by: 'brain', parameters: {} })).status).toBe(400);
  });

  it('can neither be claimed nor patched', async () => {
    const created = await postJson<Req>('/api/v1/requests', importBody());
    const claimed = await postJson<Req>('/api/v1/requests/claim', { worker_id: WORKER, kinds: ['generate', 'finalize', 'repair', 'masked_redraw'] });
    expect(claimed.status === 204 || claimed.body.id !== created.body.id).toBe(true);
    expect((await postJson('/api/v1/requests/claim', { worker_id: WORKER, kinds: ['import'] })).status).toBe(400);
    expect((await postJson(`/api/v1/requests/${created.body.id}`, { status: 'cancelled' }, 'PATCH')).status).toBe(409);
    expect((await postJson(`/api/v1/requests/${created.body.id}`, { status: 'running', worker_id: WORKER }, 'PATCH')).status).toBe(409);
  });
});
