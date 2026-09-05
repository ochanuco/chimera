import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, getJson, postJson, req } from './helpers';

// claim() grabs the globally oldest queued row with no way to scope it to this test's
// own rows, so FIFO / kinds / stale-requeue assertions need an empty table to start from.
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM requests').run();
});

interface RequestBody {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  recipe_ref: string;
  run_id: string | null;
  worker_id: string | null;
  attempt: number;
  max_attempts: number;
  claimed_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: { batch_id: string; generation_ids: string[] } | null;
  idempotency_key: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function createExperiment(overrides: Record<string, unknown> = {}) {
  return postJson<{ id: string; short_id: string; status: string }>('/api/v1/experiments', {
    name: uniqueName('exp'),
    ...overrides,
  });
}

async function createRun(experimentId: string, overrides: Record<string, unknown> = {}) {
  return postJson<{ id: string; batch_id: string | null; request_id: string | null }>(
    `/api/v1/experiments/${experimentId}/runs`,
    overrides,
  );
}

function finalizeRequestBody(generationId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'finalize',
    payload: { generation_id: generationId, options: { repin: true } },
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
    ...overrides,
  };
}

function generateRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'generate',
    payload: {
      schema_version: 1,
      request: { instruction: 'test run', count: 1 },
      generation: { recipe: 'yukari', parameters: {} },
    },
    idempotency_key: crypto.randomUUID(),
    created_by: 'brain',
    ...overrides,
  };
}

async function createFinalizeRequest(generationId: string, overrides: Record<string, unknown> = {}) {
  return postJson<RequestBody>('/api/v1/requests', finalizeRequestBody(generationId, overrides));
}

async function claim(workerId: string, kinds?: string[]): Promise<{ status: number; body: RequestBody | null }> {
  const res = await req('/api/v1/requests/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: workerId, ...(kinds ? { kinds } : {}) }),
  });
  if (res.status === 204) return { status: res.status, body: null };
  return { status: res.status, body: (await res.json()) as RequestBody };
}

describe('POST /api/v1/requests', () => {
  it('finalize: 201 create, 200 replay with same payload, 409 with different options', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await createFinalizeRequest(generation.id, { idempotency_key: key });
    expect(first.status).toBe(201);
    expect(first.body.kind).toBe('finalize');
    expect(first.body.status).toBe('queued');
    expect(first.body.payload).toEqual({ generation_id: generation.id, options: { repin: true } });
    expect((first.body as unknown as Record<string, unknown>).payload_hash).toBeUndefined();

    const replay = await createFinalizeRequest(generation.id, { idempotency_key: key });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);

    const conflicting = await postJson(
      '/api/v1/requests',
      finalizeRequestBody(generation.id, { idempotency_key: key, payload: { generation_id: generation.id, options: { repin: false } } }),
    );
    expect(conflicting.status).toBe(409);
  });

  it('recipe_ref defaults to the REQUESTS_DEFAULT_RECIPE_REF var (main until stage 4), for POST and for run auto-provisioning', async () => {
    const { generation } = await createGeneration();
    const posted = await createFinalizeRequest(generation.id);
    expect(posted.status).toBe(201);
    expect(posted.body.recipe_ref).toBe('main');

    const explicit = await createFinalizeRequest(generation.id, { recipe_ref: 'dev/x' });
    expect(explicit.body.recipe_ref).toBe('dev/x');

    const exp = await createExperiment({ base_recipe: 'yukari' });
    const run = await createRun(exp.body.id, {});
    const auto = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?run_id=${run.body.id}`);
    expect(auto.body.items[0]!.recipe_ref).toBe('main');
  });

  it('generate: payload.experiment.run_id belonging to a different experiment is a 400', async () => {
    const expA = await createExperiment();
    const expB = await createExperiment();
    const run = await createRun(expA.body.id);

    const res = await postJson(
      '/api/v1/requests',
      generateRequestBody({
        payload: {
          schema_version: 1,
          request: { instruction: 'x', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          experiment: { experiment_id: expB.body.id, run_id: run.body.id },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('generate: resolves and records run_id when payload.experiment matches', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);

    const res = await postJson<RequestBody>(
      '/api/v1/requests',
      generateRequestBody({
        payload: {
          schema_version: 1,
          request: { instruction: 'x', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          experiment: { experiment_id: exp.body.id, run_id: run.body.id },
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.run_id).toBe(run.body.id);
  });
});

describe('POST /api/v1/requests/claim', () => {
  it('claims the oldest queued row (FIFO), second claim 204 when queue is empty', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const r1 = await createFinalizeRequest(g1.id);
    const r2 = await createFinalizeRequest(g2.id);

    const first = await claim('worker-a');
    expect(first.status).toBe(200);
    expect(first.body!.id).toBe(r1.body.id);
    expect(first.body!.status).toBe('running');
    expect(first.body!.attempt).toBe(1);
    expect(first.body!.worker_id).toBe('worker-a');

    const second = await claim('worker-a');
    expect(second.status).toBe(200);
    expect(second.body!.id).toBe(r2.body.id);

    const third = await claim('worker-a');
    expect(third.status).toBe(204);
  });

  it('kinds filter: only claims rows of the requested kind', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    // generate created first (older), but kinds filter should skip it.
    await postJson(
      '/api/v1/requests',
      generateRequestBody({
        payload: {
          schema_version: 1,
          request: { instruction: 'x', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          experiment: { experiment_id: exp.body.id, run_id: run.body.id },
        },
      }),
    );
    const { generation } = await createGeneration();
    const finalizeReq = await createFinalizeRequest(generation.id);

    const claimed = await claim('worker-a', ['finalize']);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(finalizeReq.body.id);
  });

  it('heartbeat: PATCH status=running refreshes heartbeat_at', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    const claimed = await claim('worker-a');
    expect(claimed.body!.id).toBe(created.body.id);
    const beforeHeartbeat = claimed.body!.heartbeat_at;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const patched = await postJson<RequestBody>(`/api/v1/requests/${created.body.id}`, { status: 'running', worker_id: 'worker-a' }, 'PATCH');
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('running');
    expect(patched.body.heartbeat_at).not.toBeNull();
    expect(new Date(patched.body.heartbeat_at!).getTime()).toBeGreaterThanOrEqual(new Date(beforeHeartbeat!).getTime());
  });

  it('stale requeue: a running row whose heartbeat is >5min old is reclaimed with attempt+1', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    const claimed = await claim('worker-stale');
    expect(claimed.body!.attempt).toBe(1);

    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE requests SET heartbeat_at = ? WHERE id = ?').bind(staleHeartbeat, created.body.id).run();

    const reclaimed = await claim('worker-b');
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body!.id).toBe(created.body.id);
    expect(reclaimed.body!.attempt).toBe(2);
    expect(reclaimed.body!.worker_id).toBe('worker-b');
    // claim route が requeueStaleRunning (src/lib/requests.ts, WorkerHub の alarm と共有) を
    // 経由しても、回収した行を素通りせずちゃんと running に載せ替えていること。
    expect(reclaimed.body!.heartbeat_at).not.toBe(staleHeartbeat);
  });

  it('stale requeue: attempt >= max_attempts fails the row with "heartbeat timeout" instead of requeueing', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    await claim('worker-stale');

    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE requests SET heartbeat_at = ?, attempt = max_attempts WHERE id = ?')
      .bind(staleHeartbeat, created.body.id)
      .run();

    // Trigger the stale sweep; this worker may or may not get a different row, irrelevant here.
    await claim('worker-c');

    const after = await getJson<RequestBody>(`/api/v1/requests/${created.body.id}`);
    expect(after.body.status).toBe('failed');
    expect(after.body.error).toBe('heartbeat timeout');
    expect(after.body.finished_at).not.toBeNull();
  });
});

describe('PATCH /api/v1/requests/{id}', () => {
  it('400s when worker_id is missing for a running/done/failed transition', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    await claim('worker-a');

    const res = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'running' }, 'PATCH');
    expect(res.status).toBe(400);
  });

  it('409s transitioning to done/failed from queued (not yet claimed)', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);

    const done = await postJson(
      `/api/v1/requests/${created.body.id}`,
      { status: 'done', worker_id: 'worker-a', result: { batch_id: 'whatever', generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(409);

    const failed = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'failed', worker_id: 'worker-a', error: 'x' }, 'PATCH');
    expect(failed.status).toBe(409);
  });

  it('cancelled: 200 from queued, 409 from running', async () => {
    const { generation: g1 } = await createGeneration();
    const queued = await createFinalizeRequest(g1.id);
    const cancelled = await postJson<RequestBody>(`/api/v1/requests/${queued.body.id}`, { status: 'cancelled' }, 'PATCH');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    const { generation: g2 } = await createGeneration();
    const running = await createFinalizeRequest(g2.id);
    await claim('worker-a');
    const res = await postJson(`/api/v1/requests/${running.body.id}`, { status: 'cancelled' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('409s when worker_id does not match the claim', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    await claim('worker-a');

    const res = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'running', worker_id: 'worker-b' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('409s any further PATCH once terminal', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    await postJson(`/api/v1/requests/${created.body.id}`, { status: 'cancelled' }, 'PATCH');

    const res = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'cancelled' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('done: requires result.batch_id, then attaches experiment_runs.batch_id atomically', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const generateReq = await postJson<RequestBody>(
      '/api/v1/requests',
      generateRequestBody({
        payload: {
          schema_version: 1,
          request: { instruction: 'x', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          experiment: { experiment_id: exp.body.id, run_id: run.body.id },
        },
      }),
    );
    await claim('worker-a');

    const missingResult = await postJson(`/api/v1/requests/${generateReq.body.id}`, { status: 'done', worker_id: 'worker-a' }, 'PATCH');
    expect(missingResult.status).toBe(400);

    const { batch } = await createGeneration();
    const done = await postJson<RequestBody>(
      `/api/v1/requests/${generateReq.body.id}`,
      { status: 'done', worker_id: 'worker-a', result: { batch_id: batch.id, generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('done');
    expect(done.body.result).toEqual({ batch_id: batch.id, generation_ids: [] });

    const updatedRun = await getJson<{ batch_id: string | null }>(`/api/v1/experiment-runs/${run.body.id}`);
    expect(updatedRun.body.batch_id).toBe(batch.id);
  });

  it('done: 409s when the run already has a different batch attached, and the request stays running', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { batch: batchA } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batchA.id }, 'PATCH');

    const generateReq = await postJson<RequestBody>(
      '/api/v1/requests',
      generateRequestBody({
        payload: {
          schema_version: 1,
          request: { instruction: 'x', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          experiment: { experiment_id: exp.body.id, run_id: run.body.id },
        },
      }),
    );
    await claim('worker-a');

    const { batch: batchB } = await createGeneration();
    const res = await postJson(
      `/api/v1/requests/${generateReq.body.id}`,
      { status: 'done', worker_id: 'worker-a', result: { batch_id: batchB.id, generation_ids: [] } },
      'PATCH',
    );
    expect(res.status).toBe(409);

    const stillRunning = await getJson<RequestBody>(`/api/v1/requests/${generateReq.body.id}`);
    expect(stillRunning.body.status).toBe('running');
  });

  it('failed: requires error, sets finished_at', async () => {
    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    await claim('worker-a');

    const missingError = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'failed', worker_id: 'worker-a' }, 'PATCH');
    expect(missingError.status).toBe(400);

    const failed = await postJson<RequestBody>(
      `/api/v1/requests/${created.body.id}`,
      { status: 'failed', worker_id: 'worker-a', error: 'checkout failed' },
      'PATCH',
    );
    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.error).toBe('checkout failed');
    expect(failed.body.finished_at).not.toBeNull();
  });
});

describe('GET /api/v1/requests', () => {
  it('filters by status, kind, run_id, generation_id (short_id), batch_id, and pending=true', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const generateReq = await postJson<RequestBody>(
      '/api/v1/requests',
      generateRequestBody({
        payload: {
          schema_version: 1,
          request: { instruction: 'x', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          experiment: { experiment_id: exp.body.id, run_id: run.body.id },
        },
      }),
    );

    const { batch, generation: gA } = await createGeneration({ batchOverrides: {} });
    const jobRes = await postJson<{ id: string }>(`/api/v1/batches/${batch.id}/jobs`, {
      idempotency_key: crypto.randomUUID(),
      seed: 1,
      index: 1,
    });
    const form = new FormData();
    form.set('metadata', JSON.stringify({ seed: 1, original_filename: 'x.png', comfy_output_index: 0 }));
    form.set('image', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    const ingestRes = await req(`/api/v1/jobs/${jobRes.body.id}/generations`, { method: 'POST', body: form });
    const gB = (await ingestRes.json()) as { id: string; short_id: string };

    const finalizeA = await createFinalizeRequest(gA.id);
    const finalizeB = await createFinalizeRequest(gB.short_id);

    // status
    const queuedList = await getJson<{ items: RequestBody[] }>('/api/v1/requests?status=queued&limit=200');
    expect(queuedList.body.items.map((r) => r.id)).toEqual(
      expect.arrayContaining([generateReq.body.id, finalizeA.body.id, finalizeB.body.id]),
    );

    // pending=true is an alias for status=queued
    const pendingList = await getJson<{ items: RequestBody[] }>('/api/v1/requests?pending=true&limit=200');
    expect(pendingList.body.items.map((r) => r.id)).toEqual(expect.arrayContaining([generateReq.body.id]));
    await claim('worker-a', ['generate']);
    const pendingAfterClaim = await getJson<{ items: RequestBody[] }>('/api/v1/requests?pending=true&limit=200');
    expect(pendingAfterClaim.body.items.map((r) => r.id)).not.toContain(generateReq.body.id);

    // kind
    const finalizeList = await getJson<{ items: RequestBody[] }>('/api/v1/requests?kind=finalize&limit=200');
    expect(finalizeList.body.items.every((r) => r.kind === 'finalize')).toBe(true);
    expect(finalizeList.body.items.map((r) => r.id)).toEqual(expect.arrayContaining([finalizeA.body.id, finalizeB.body.id]));

    // run_id
    const runList = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?run_id=${run.body.id}`);
    expect(runList.body.items.map((r) => r.id)).toEqual([generateReq.body.id]);

    // generation_id, resolved by short_id even though the request stored the UUID
    const byShortId = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?generation_id=${gA.short_id}`);
    expect(byShortId.body.items.map((r) => r.id)).toEqual([finalizeA.body.id]);

    // batch_id: both generations belong to the same batch
    const byBatch = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?batch_id=${batch.id}`);
    expect(byBatch.body.items.map((r) => r.id).sort()).toEqual([finalizeA.body.id, finalizeB.body.id].sort());
  });
});
