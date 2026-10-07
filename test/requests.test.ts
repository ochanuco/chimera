import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRequest as createRequestRow } from '../src/lib/requests';
import { createGeneration, getJson, ingestGeneration, postJson, req, clearRequests } from './helpers';

// claim() grabs the globally oldest queued row with no way to scope it to this test's
// own rows, so FIFO / kinds / stale-requeue assertions need an empty table to start from.
beforeEach(async () => {
  await clearRequests();
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
  result: { generation_ids: string[] } | null;
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
  return postJson<{ id: string; request_id: string | null }>(
    `/api/v1/experiments/${experimentId}/runs`,
    overrides,
  );
}

function deliverRequestBody(generationId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'deliver',
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

async function createDeliverRequest(generationId: string, overrides: Record<string, unknown> = {}) {
  return postJson<RequestBody>('/api/v1/requests', deliverRequestBody(generationId, overrides));
}

function repairRequestBody(generationId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'repair',
    payload: { generation_id: generationId, options: { parts: ['hands', 'feet'] } },
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
    ...overrides,
  };
}

async function createRepairRequest(generationId: string, overrides: Record<string, unknown> = {}) {
  return postJson<RequestBody>('/api/v1/requests', repairRequestBody(generationId, overrides));
}

function maskedRedrawRequestBody(generationId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'masked_redraw',
    payload: {
      generation_id: generationId,
      options: {
        regions: [[0.2, 0.4, 0.8, 0.9]],
        prompt_patch: 'replace the garment',
        denoise: 0.5,
        mask_padding: 24,
        mask_feather: 8,
      },
    },
    idempotency_key: crypto.randomUUID(),
    created_by: 'mcp',
    ...overrides,
  };
}

async function createMaskedRedrawRequest(generationId: string, overrides: Record<string, unknown> = {}) {
  return postJson<RequestBody>('/api/v1/requests', maskedRedrawRequestBody(generationId, overrides));
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
  it('deliver: 201 create, 200 replay with same payload, 409 with different options', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await createDeliverRequest(generation.id, { idempotency_key: key });
    expect(first.status).toBe(201);
    expect(first.body.kind).toBe('deliver');
    expect(first.body.status).toBe('queued');
    expect(first.body.payload).toEqual({ generation_id: generation.id, options: { repin: true } });
    expect((first.body as unknown as Record<string, unknown>).payload_hash).toBeUndefined();

    const replay = await createDeliverRequest(generation.id, { idempotency_key: key });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);

    const conflicting = await postJson(
      '/api/v1/requests',
      deliverRequestBody(generation.id, { idempotency_key: key, payload: { generation_id: generation.id, options: { repin: false } } }),
    );
    expect(conflicting.status).toBe(409);
  });

  it('deliver: stroke_light accepts even, a direction and null; rejects none and an unknown string', async () => {
    const { generation } = await createGeneration();
    for (const value of ['even', 'n', 'nw', null]) {
      const res = await createDeliverRequest(generation.id, {
        payload: { generation_id: generation.id, options: { stroke_light: value } },
      });
      expect(res.status).toBe(201);
      expect(res.body.payload).toEqual({ generation_id: generation.id, options: { stroke_light: value } });
    }
    for (const value of ['sideways', 'none']) {
      const bad = await createDeliverRequest(generation.id, {
        payload: { generation_id: generation.id, options: { stroke_light: value } },
      });
      expect(bad.status).toBe(400);
    }
  });

  it('finalize: creation is rejected with a 400 that names redraw and deliver, over REST and createRequest', async () => {
    const { generation } = await createGeneration();
    const res = await postJson<{ error: { message: string } }>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.id, options: { repin: true } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/redraw/);
    expect(JSON.stringify(res.body)).toMatch(/deliver/);

    await expect(
      createRequestRow(env.DB, {
        kind: 'finalize',
        payload: { generation_id: generation.id },
        idempotency_key: crypto.randomUUID(),
        created_by: 'gui',
      }),
    ).rejects.toMatchObject({ status: 400 });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE kind = 'finalize'").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('repair: 201 create with parts/regions/denoise/seeds/pad, unknown option key is 400, bad region (x0 > x1) is 400', async () => {
    const { generation } = await createGeneration();

    const created = await createRepairRequest(generation.id, {
      payload: {
        generation_id: generation.id,
        options: { parts: ['hands', 'feet'], regions: [[0.1, 0.7, 0.5, 0.95]], denoise: 0.6, seeds: [1, 2, 3, 4], size: 1024, pad: 1.0 },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('repair');
    expect(created.body.status).toBe('queued');
    expect(created.body.payload).toEqual({
      generation_id: generation.id,
      options: { parts: ['hands', 'feet'], regions: [[0.1, 0.7, 0.5, 0.95]], denoise: 0.6, seeds: [1, 2, 3, 4], size: 1024, pad: 1.0 },
    });

    const unknownKey = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { bogus: true } },
    });
    expect(unknownKey.status).toBe(400);

    const badRegion = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { regions: [[0.5, 0.7, 0.1, 0.95]] } },
    });
    expect(badRegion.status).toBe(400);
  });

  it('repair: lora accepts true, a number, null, and a dial word; rejects a malformed string', async () => {
    const { generation } = await createGeneration();

    const workerDefault = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { lora: true } },
    });
    expect(workerDefault.status).toBe(201);
    expect(workerDefault.body.payload).toEqual({ generation_id: generation.id, options: { lora: true } });

    const explicitWeight = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { lora: 0.6 } },
    });
    expect(explicitWeight.status).toBe(201);
    expect(explicitWeight.body.payload).toEqual({ generation_id: generation.id, options: { lora: 0.6 } });

    const off = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { lora: null } },
    });
    expect(off.status).toBe(201);

    const word = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { lora: 'strong' } },
    });
    expect(word.status).toBe(201);
    expect(word.body.payload).toEqual({ generation_id: generation.id, options: { lora: 'strong' } });

    const badType = await createRepairRequest(generation.id, {
      payload: { generation_id: generation.id, options: { lora: 'Strong!' } },
    });
    expect(badType.status).toBe(400);
  });

  it('masked_redraw: accepts arbitrary non-overlapping regions and rejects empty/overlapping regions', async () => {
    const { generation } = await createGeneration();
    const created = await createMaskedRedrawRequest(generation.id, {
      payload: {
        generation_id: generation.id,
        options: {
          regions: [
            [0.05, 0.25, 0.45, 0.8],
            [0.55, 0.25, 0.95, 0.8],
          ],
          prompt_patch: 'long loose A-line mid-calf dress',
          denoise: 0.45,
          mask_padding: 32,
          mask_feather: 6,
        },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('masked_redraw');

    const empty = await createMaskedRedrawRequest(generation.id, {
      payload: { generation_id: generation.id, options: { regions: [], prompt_patch: 'dress' } },
    });
    expect(empty.status).toBe(400);

    const overlap = await createMaskedRedrawRequest(generation.id, {
      payload: {
        generation_id: generation.id,
        options: {
          regions: [
            [0.1, 0.2, 0.6, 0.8],
            [0.5, 0.4, 0.9, 0.9],
          ],
          prompt_patch: 'dress',
        },
      },
    });
    expect(overlap.status).toBe(400);

    const alias = await createMaskedRedrawRequest(generation.id, {
      payload: {
        generation_id: generation.id,
        options: {
          regions: [[0.1, 0.1, 0.3, 0.3]],
          prompt_patch: 'replace the bodice',
          pad: 18,
          feather: 4,
        },
      },
    });
    expect(alias.status).toBe(201);
    expect(alias.body.payload).toEqual({
      generation_id: generation.id,
      options: {
        regions: [[0.1, 0.1, 0.3, 0.3]],
        prompt_patch: 'replace the bodice',
        mask_padding: 18,
        mask_feather: 4,
      },
    });
  });

  it('recipe_ref defaults to the REQUESTS_DEFAULT_RECIPE_REF var (production), for POST and for run auto-provisioning', async () => {
    const { generation } = await createGeneration();
    const posted = await createDeliverRequest(generation.id);
    expect(posted.status).toBe(201);
    expect(posted.body.recipe_ref).toBe('production');

    const explicit = await createDeliverRequest(generation.id, { recipe_ref: 'dev/x' });
    expect(explicit.body.recipe_ref).toBe('dev/x');

    const exp = await createExperiment({ base_recipe: 'yukari' });
    const run = await createRun(exp.body.id, {});
    const auto = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?run_id=${run.body.id}`);
    expect(auto.body.items[0]!.recipe_ref).toBe('production');
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
    const r1 = await createDeliverRequest(g1.id);
    const r2 = await createDeliverRequest(g2.id);

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

  it('release puts a claimed row back on the queue without waiting for the heartbeat timeout', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);

    const claimed = await claim('worker-a');
    expect(claimed.body!.id).toBe(created.body.id);
    expect(claimed.body!.attempt).toBe(1);

    const released = await postJson<RequestBody>(
      `/api/v1/requests/${created.body.id}`,
      { status: 'queued', worker_id: 'worker-a' },
      'PATCH',
    );
    expect(released.status).toBe(200);
    expect(released.body.status).toBe('queued');
    expect(released.body.worker_id).toBeNull();
    // attempt はここでは動かない。次の claim で増える。
    expect(released.body.attempt).toBe(1);

    const again = await claim('worker-b');
    expect(again.body!.id).toBe(created.body.id);
    expect(again.body!.attempt).toBe(2);
  });

  it('lists only the rows a given worker holds, so a restarted worker can find its own', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const r1 = await createDeliverRequest(g1.id);
    const r2 = await createDeliverRequest(g2.id);

    await claim('worker-owner');
    await claim('worker-other');

    const mine = await getJson<{ items: RequestBody[] }>('/api/v1/requests?status=running&worker_id=worker-owner');
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((r) => r.id)).toEqual([r1.body.id]);
    expect(mine.body.items.map((r) => r.id)).not.toContain(r2.body.id);
  });

  it('release from a worker that does not hold the claim is a conflict', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
    await claim('worker-a');

    const released = await postJson(
      `/api/v1/requests/${created.body.id}`,
      { status: 'queued', worker_id: 'worker-b' },
      'PATCH',
    );
    expect(released.status).toBe(409);
  });

  it('release fails the row once its attempts are spent, the same rule the heartbeat timeout uses', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);

    for (let i = 0; i < 3; i++) {
      const claimed = await claim(`worker-${i}`);
      expect(claimed.body!.id).toBe(created.body.id);
      const released = await postJson<RequestBody>(
        `/api/v1/requests/${created.body.id}`,
        { status: 'queued', worker_id: `worker-${i}` },
        'PATCH',
      );
      if (i < 2) expect(released.body.status).toBe('queued');
      else {
        expect(released.body.status).toBe('failed');
        expect(released.body.error).toBe('released after max attempts');
      }
    }
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
    const deliverReq = await createDeliverRequest(generation.id);

    const claimed = await claim('worker-a', ['deliver']);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(deliverReq.body.id);
  });

  it('kinds filter: claims a repair row when kinds includes only repair', async () => {
    const { generation: g1 } = await createGeneration();
    const deliverReq = await createDeliverRequest(g1.id);
    const { generation: g2 } = await createGeneration();
    const repairReq = await createRepairRequest(g2.id);

    const claimed = await claim('worker-a', ['repair']);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(repairReq.body.id);
    expect(claimed.body!.kind).toBe('repair');

    // deliver row stays queued, untouched by the repair-only claim.
    const stillQueued = await getJson<RequestBody>(`/api/v1/requests/${deliverReq.body.id}`);
    expect(stillQueued.body.status).toBe('queued');
  });

  it('kinds filter: claims a masked_redraw row when kinds includes only masked_redraw', async () => {
    const { generation } = await createGeneration();
    const masked = await createMaskedRedrawRequest(generation.id);

    const claimed = await claim('worker-a', ['masked_redraw']);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(masked.body.id);
    expect(claimed.body!.kind).toBe('masked_redraw');
  });

  it('heartbeat: PATCH status=running refreshes heartbeat_at', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
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
    const created = await createDeliverRequest(generation.id);
    const claimed = await claim('worker-stale');
    expect(claimed.body!.attempt).toBe(1);

    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE requests SET heartbeat_at = ? WHERE id = ?').bind(staleHeartbeat, created.body.id).run();

    const reclaimed = await claim('worker-b');
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body!.id).toBe(created.body.id);
    expect(reclaimed.body!.attempt).toBe(2);
    expect(reclaimed.body!.worker_id).toBe('worker-b');
    // claim route が requeueStaleRunning (WorkerHub の alarm と共有) を経由しても running に載せ替わっていること。
    expect(reclaimed.body!.heartbeat_at).not.toBe(staleHeartbeat);
  });

  it('stale requeue: attempt >= max_attempts fails the row with "heartbeat timeout" instead of requeueing', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
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
    const created = await createDeliverRequest(generation.id);
    await claim('worker-a');

    const res = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'running' }, 'PATCH');
    expect(res.status).toBe(400);
  });

  it('409s transitioning to done/failed from queued (not yet claimed)', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);

    const done = await postJson(
      `/api/v1/requests/${created.body.id}`,
      { status: 'done', worker_id: 'worker-a', result: { generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(409);

    const failed = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'failed', worker_id: 'worker-a', error: 'x' }, 'PATCH');
    expect(failed.status).toBe(409);
  });

  it('cancelled: 200 from queued, 409 from running', async () => {
    const { generation: g1 } = await createGeneration();
    const queued = await createDeliverRequest(g1.id);
    const cancelled = await postJson<RequestBody>(`/api/v1/requests/${queued.body.id}`, { status: 'cancelled' }, 'PATCH');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    const { generation: g2 } = await createGeneration();
    const running = await createDeliverRequest(g2.id);
    await claim('worker-a');
    const res = await postJson(`/api/v1/requests/${running.body.id}`, { status: 'cancelled' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('409s when worker_id does not match the claim', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
    await claim('worker-a');

    const res = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'running', worker_id: 'worker-b' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('409s any further PATCH once terminal', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
    await postJson(`/api/v1/requests/${created.body.id}`, { status: 'cancelled' }, 'PATCH');

    const res = await postJson(`/api/v1/requests/${created.body.id}`, { status: 'cancelled' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('done: requires result and stores it', async () => {
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

    const done = await postJson<RequestBody>(
      `/api/v1/requests/${generateReq.body.id}`,
      { status: 'done', worker_id: 'worker-a', result: { generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('done');
    expect(done.body.result).toEqual({ generation_ids: [] });
    const updatedRun = await getJson<Record<string, unknown>>(`/api/v1/experiment-runs/${run.body.id}`);
    expect(updatedRun.body).not.toHaveProperty('batch_id');
  });

  it('failed: requires error, sets finished_at', async () => {
    const { generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
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
  it('filters by status, kind, run_id, generation_id (short_id), and pending=true', async () => {
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

    const { generation: gA } = await createGeneration();
    const { generation: gB } = await createGeneration();

    const deliverA = await createDeliverRequest(gA.id);
    const deliverB = await createDeliverRequest(gB.short_id);

    const queuedList = await getJson<{ items: RequestBody[] }>('/api/v1/requests?status=queued&limit=200');
    expect(queuedList.body.items.map((r) => r.id)).toEqual(
      expect.arrayContaining([generateReq.body.id, deliverA.body.id, deliverB.body.id]),
    );

    // pending=true is an alias for status=queued
    const pendingList = await getJson<{ items: RequestBody[] }>('/api/v1/requests?pending=true&limit=200');
    expect(pendingList.body.items.map((r) => r.id)).toEqual(expect.arrayContaining([generateReq.body.id]));
    await claim('worker-a', ['generate']);
    const pendingAfterClaim = await getJson<{ items: RequestBody[] }>('/api/v1/requests?pending=true&limit=200');
    expect(pendingAfterClaim.body.items.map((r) => r.id)).not.toContain(generateReq.body.id);

    const deliverList = await getJson<{ items: RequestBody[] }>('/api/v1/requests?kind=deliver&limit=200');
    expect(deliverList.body.items.every((r) => r.kind === 'deliver')).toBe(true);
    expect(deliverList.body.items.map((r) => r.id)).toEqual(expect.arrayContaining([deliverA.body.id, deliverB.body.id]));

    const runList = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?run_id=${run.body.id}`);
    expect(runList.body.items.map((r) => r.id)).toEqual([generateReq.body.id]);

    // generation_id, resolved by short_id even though the request stored the UUID
    const byShortId = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?generation_id=${gA.short_id}`);
    expect(byShortId.body.items.map((r) => r.id)).toEqual([deliverA.body.id]);

    // batch_id is no longer a filter: it is ignored rather than narrowing the list.
    const ignoredBatchFilter = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?batch_id=${crypto.randomUUID()}&limit=200`);
    expect(ignoredBatchFilter.body.items.map((r) => r.id)).toEqual(
      expect.arrayContaining([generateReq.body.id, deliverA.body.id, deliverB.body.id]),
    );
  });

  it('generation_id also returns repair rows alongside deliver rows', async () => {
    const { generation } = await createGeneration();
    const deliverReq = await createDeliverRequest(generation.id);
    const repairReq = await createRepairRequest(generation.id);

    const byGenerationId = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?generation_id=${generation.id}`);
    expect(byGenerationId.body.items.map((r) => r.id).sort()).toEqual([deliverReq.body.id, repairReq.body.id].sort());

    // kind narrows within the generation_id set as usual.
    const repairOnly = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=repair`);
    expect(repairOnly.body.items.map((r) => r.id)).toEqual([repairReq.body.id]);
  });

  it('generation_id includes masked_redraw rows', async () => {
    const { generation } = await createGeneration();
    const masked = await createMaskedRedrawRequest(generation.id);

    const byGeneration = await getJson<{ items: RequestBody[] }>(`/api/v1/requests?generation_id=${generation.id}`);
    expect(byGeneration.body.items.map((r) => r.id)).toEqual([masked.body.id]);
  });
});

interface RequestSummaryBody {
  counts: { queued: number; running: number; failed_24h: number };
  workers: unknown[];
  groups: {
    key: string;
    request: { id: string; short_id: string | null; thumbnail_generation_short_id: string | null } | null;
    experiment: { id: string; short_id: string } | null;
    href: string | null;
    kinds: Record<string, number>;
    counts: { queued: number; running: number; failed: number };
    latest_at: string;
  }[];
}

describe('GET /api/v1/requests/summary', () => {
  it('is not captured by GET /:id (route registration order)', async () => {
    const res = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(res.status).toBe(200);
  });

  it('returns zeros and empty groups on an empty table', async () => {
    const res = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(res.body.counts).toEqual({ queued: 0, running: 0, failed_24h: 0 });
    expect(res.body.groups).toEqual([]);
    expect(Array.isArray(res.body.workers)).toBe(true);
  });

  it('tracks a deliver request through queued -> running -> failed, grouped by its source request', async () => {
    const { request, generation } = await createGeneration();
    const created = await createDeliverRequest(generation.id);
    expect(created.status).toBe(201);

    const afterCreate = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(afterCreate.body.counts.queued).toBe(1);
    expect(afterCreate.body.groups).toHaveLength(1);
    const group = afterCreate.body.groups[0]!;
    expect(group.key).toBe(`request:${request.id}`);
    expect(group.request).toEqual({ id: request.id, short_id: request.short_id, thumbnail_generation_short_id: generation.short_id });
    expect(group.href).toBe(`/g/${generation.short_id}`);
    expect(group.kinds.deliver).toBe(1);
    expect(group.counts).toEqual({ queued: 1, running: 0, failed: 0 });

    const claimed = await claim('w-summary', ['deliver']);
    expect(claimed.status).toBe(200);
    expect(claimed.body?.id).toBe(created.body.id);

    const afterClaim = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(afterClaim.body.counts).toEqual({ queued: 0, running: 1, failed_24h: 0 });
    expect(afterClaim.body.groups[0]!.counts).toEqual({ queued: 0, running: 1, failed: 0 });

    const failed = await postJson(
      `/api/v1/requests/${created.body.id}`,
      { status: 'failed', worker_id: 'w-summary', error: 'boom' },
      'PATCH',
    );
    expect(failed.status).toBe(200);

    const afterFail = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(afterFail.body.counts).toEqual({ queued: 0, running: 0, failed_24h: 1 });
    expect(afterFail.body.groups).toHaveLength(1);
    expect(afterFail.body.groups[0]!.counts).toEqual({ queued: 0, running: 0, failed: 1 });
  });

  it('groups deliver requests of every Generation of one Request into a single row linking to its first Generation', async () => {
    const { request, job, generation: first } = await createGeneration();
    const second = await ingestGeneration(job.id, { seed: 123, original_filename: 'out_00002_.png', comfy_output_index: 1 });
    expect(second.status).toBe(201);
    const other = await createGeneration();

    await createDeliverRequest(first.id);
    await createDeliverRequest(second.body.short_id);
    await createDeliverRequest(other.generation.id);

    const res = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(res.body.groups).toHaveLength(2);
    const shared = res.body.groups.find((g) => g.request?.id === request.id)!;
    expect(shared.kinds.deliver).toBe(2);
    expect(shared.counts.queued).toBe(2);
    expect(shared.href).toBe(`/g/${first.short_id}`);
    const alone = res.body.groups.find((g) => g.request?.id === other.request.id)!;
    expect(alone.kinds.deliver).toBe(1);
  });

  it('groups generate requests with a run_id by their experiment', async () => {
    const exp = await createExperiment();
    const runA = await createRun(exp.body.id);
    const runB = await createRun(exp.body.id);
    for (const run of [runA, runB]) {
      const res = await postJson(
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
    }

    const res = await getJson<RequestSummaryBody>('/api/v1/requests/summary');
    expect(res.body.counts.queued).toBe(2);
    expect(res.body.groups).toHaveLength(1);
    const group = res.body.groups[0]!;
    expect(group.key).toBe(`experiment:${exp.body.id}`);
    expect(group.experiment).toEqual({ id: exp.body.id, short_id: exp.body.short_id });
    expect(group.href).toBe(`/experiments/${exp.body.short_id}`);
    expect(group.kinds.generate).toBe(2);
  });
});
