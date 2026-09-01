import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, makeSolidPng, mcpCall, mcpToolCall, postJson } from './helpers';

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

interface Experiment {
  id: string;
  short_id: string;
  status: string;
  base_recipe: string | null;
  base_parameters: Record<string, unknown> | null;
}

interface ExperimentRun {
  id: string;
  experiment_id: string;
  batch_id: string | null;
  generation_id: string | null;
  overrides: Record<string, unknown>;
  evaluation: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  created_at: string;
}

interface PendingRun extends ExperimentRun {
  experiment: {
    id: string;
    short_id: string;
    name: string;
    status: string;
    base_recipe: string | null;
    base_parameters: Record<string, unknown> | null;
  };
}

async function createExperiment(overrides: Record<string, unknown> = {}) {
  return postJson<Experiment>('/api/v1/experiments', { name: uniqueName('exp'), ...overrides });
}

async function createRun(experimentId: string, overrides: Record<string, unknown> = {}) {
  return postJson<ExperimentRun>(`/api/v1/experiments/${experimentId}/runs`, overrides);
}

async function patchStatus(id: string, status: string) {
  return postJson<Experiment>(`/api/v1/experiments/${id}`, { status }, 'PATCH');
}

describe('base_parameters', () => {
  it('round-trips through create, detail, and PATCH; absent means null', async () => {
    const created = await createExperiment();
    expect(created.body.base_parameters).toBeNull();

    const withParams = await createExperiment({ base_parameters: { pose: 'lounge', count: 3 } });
    expect(withParams.status).toBe(201);
    expect(withParams.body.base_parameters).toEqual({ pose: 'lounge', count: 3 });

    const detail = await getJson<Experiment>(`/api/v1/experiments/${withParams.body.id}`);
    expect(detail.body.base_parameters).toEqual({ pose: 'lounge', count: 3 });

    const patched = await postJson<Experiment>(
      `/api/v1/experiments/${withParams.body.id}`,
      { base_parameters: { pose: 'seated' } },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.base_parameters).toEqual({ pose: 'seated' });

    const cleared = await postJson<Experiment>(
      `/api/v1/experiments/${withParams.body.id}`,
      { base_parameters: null },
      'PATCH',
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.base_parameters).toBeNull();
  });
});

describe('GET /api/v1/experiment-runs?pending=true', () => {
  it('400s without pending=true', async () => {
    const missing = await getJson('/api/v1/experiment-runs');
    expect(missing.status).toBe(400);

    const falsey = await getJson('/api/v1/experiment-runs?pending=false');
    expect(falsey.status).toBe(400);
  });

  it('returns only runs without a batch, oldest first, with experiment context including base_parameters', async () => {
    const exp = await createExperiment({ base_recipe: 'yukari', base_parameters: { pose: 'lounge', count: 3 } });
    const r1 = await createRun(exp.body.id);
    const r2 = await createRun(exp.body.id);
    const r3 = await createRun(exp.body.id);

    const { generation, batch } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${r2.body.id}`, { batch_id: batch.id }, 'PATCH');
    void generation;

    const list = await getJson<{ items: PendingRun[] }>('/api/v1/experiment-runs?pending=true&limit=200');
    const ids = list.body.items.map((r) => r.id);
    expect(ids).toContain(r1.body.id);
    expect(ids).toContain(r3.body.id);
    expect(ids).not.toContain(r2.body.id);

    const idx1 = ids.indexOf(r1.body.id);
    const idx3 = ids.indexOf(r3.body.id);
    expect(idx1).toBeLessThan(idx3);

    const found = list.body.items.find((r) => r.id === r1.body.id)!;
    expect(found.experiment).toMatchObject({
      id: exp.body.id,
      short_id: exp.body.short_id,
      status: 'active',
      base_recipe: 'yukari',
      base_parameters: { pose: 'lounge', count: 3 },
    });
  });

  it('excludes runs whose experiment is abandoned or promoted; includes active and stabilized', async () => {
    const active = await createExperiment();
    const stabilized = await createExperiment();
    const promoted = await createExperiment();
    const abandoned = await createExperiment();

    const activeRun = await createRun(active.body.id);
    const stabilizedRun = await createRun(stabilized.body.id);
    const promotedRun = await createRun(promoted.body.id);
    const abandonedRun = await createRun(abandoned.body.id);

    await patchStatus(stabilized.body.id, 'stabilized');
    await patchStatus(promoted.body.id, 'stabilized');
    await patchStatus(promoted.body.id, 'promoted');
    await patchStatus(abandoned.body.id, 'abandoned');

    const list = await getJson<{ items: PendingRun[] }>('/api/v1/experiment-runs?pending=true&limit=200');
    const ids = list.body.items.map((r) => r.id);
    expect(ids).toContain(activeRun.body.id);
    expect(ids).toContain(stabilizedRun.body.id);
    expect(ids).not.toContain(promotedRun.body.id);
    expect(ids).not.toContain(abandonedRun.body.id);
  });

  it('attaching a batch removes the run from the pending list', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);

    const before = await getJson<{ items: PendingRun[] }>('/api/v1/experiment-runs?pending=true&limit=200');
    expect(before.body.items.map((r) => r.id)).toContain(run.body.id);

    const { batch } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch.id }, 'PATCH');

    const after = await getJson<{ items: PendingRun[] }>('/api/v1/experiment-runs?pending=true&limit=200');
    expect(after.body.items.map((r) => r.id)).not.toContain(run.body.id);
  });
});

describe('MCP server at /mcp', () => {
  it('initialize succeeds and tools/list returns the eight tool names', async () => {
    const init = await mcpCall('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result).toBeTruthy();

    const list = await mcpCall<{ tools: { name: string }[] }>('tools/list', {});
    expect(list.status).toBe(200);
    const names = list.body.result?.tools.map((t) => t.name) ?? [];
    expect(names.sort()).toEqual(
      [
        'list_experiments',
        'get_experiment',
        'create_run',
        'get_run',
        'get_generation_image',
        'attach_generation',
        'set_evaluation',
        'set_decision',
      ].sort(),
    );
  });

  it('tools/call create_run creates a Run visible through the REST API', async () => {
    const exp = await createExperiment({ base_recipe: 'yukari' });

    const overrides = { patches: [{ target: 'pose', op: 'set', value: 'seated', reason: 'try a seated variant' }] };
    const call = await mcpToolCall<{ created: boolean; run: ExperimentRun }>('create_run', {
      experiment_id: exp.body.id,
      overrides,
      objective: 'try a seated variant',
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.run.overrides).toEqual(overrides);

    const viaRest = await getJson<{ items: ExperimentRun[] }>(`/api/v1/experiments/${exp.body.id}/runs`);
    expect(viaRest.body.items.map((r) => r.id)).toContain(call.data?.run.id);
  });

  it('tools/call create_run with the PoC payload (base_parameters shape, not overrides) surfaces the 400 as a tool error', async () => {
    const exp = await createExperiment({ base_recipe: 'yukari' });

    const call = await mcpToolCall('create_run', {
      experiment_id: exp.body.id,
      overrides: { pose: '膝枕', costume: 'default', count: 1 },
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('pose');
    expect(call.text).toContain('costume');
    expect(call.text).toContain('count');
  });

  it('tools/call create_run with the same idempotency_key twice reports the second as not created and returns the same run id', async () => {
    const exp = await createExperiment();
    const key = crypto.randomUUID();

    const first = await mcpToolCall<{ created: boolean; run: ExperimentRun }>('create_run', {
      experiment_id: exp.body.id,
      idempotency_key: key,
    });
    expect(first.isError).toBe(false);
    expect(first.data?.created).toBe(true);

    const second = await mcpToolCall<{ created: boolean; run: ExperimentRun }>('create_run', {
      experiment_id: exp.body.id,
      idempotency_key: key,
    });
    expect(second.isError).toBe(false);
    expect(second.data?.created).toBe(false);
    expect(second.data?.run.id).toBe(first.data?.run.id);
  });

  it('tools/call attach_generation on an already-attached run surfaces the 409 message as a tool error', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation: g1, batch: batch1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch1.id }, 'PATCH');

    const first = await mcpToolCall('attach_generation', { run_id: run.body.id, generation_id: g1.id });
    expect(first.isError).toBe(false);

    const second = await mcpToolCall('attach_generation', { run_id: run.body.id, generation_id: g2.id });
    expect(second.isError).toBe(true);
    expect(second.text).toContain('run already has a generation attached');
  });

  it('tools/call attach_generation on a run with no batch surfaces the 409 message as a tool error', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation } = await createGeneration();

    const call = await mcpToolCall('attach_generation', { run_id: run.body.id, generation_id: generation.id });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('no batch attached');
  });

  it('tools/call attach_generation with a generation from another batch surfaces the 409 message as a tool error', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { batch: runBatch } = await createGeneration();
    const { generation: otherGeneration } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: runBatch.id }, 'PATCH');

    const call = await mcpToolCall('attach_generation', { run_id: run.body.id, generation_id: otherGeneration.id });
    expect(call.isError).toBe(true);
    expect(call.text).toContain(`not the run's batch ${runBatch.id}`);
  });
});

describe('MCP get_generation_image', () => {
  it('returns a downscaled JPEG for a small image', async () => {
    const { generation } = await createGeneration();
    const { result, isError } = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.type).toBe('image');
    expect(result?.content?.[0]?.mimeType).toBe('image/jpeg');
    expect((result?.content?.[0]?.data ?? '').length).toBeGreaterThan(0);
  });

  it('honours the width argument, resizing to the requested width', async () => {
    const { generation } = await createGeneration();
    const key = `generations/${generation.id}/original.png`;
    // デフォルト幅 (768) より大きい実画像でないと scale-down は縮小しない。
    await env.IMAGES.put(key, await makeSolidPng(1600, 2400, [200, 80, 40]));

    const requested = 256;
    const { result, isError } = await mcpToolCall('get_generation_image', {
      short_id: generation.short_id,
      width: requested,
    });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.mimeType).toBe('image/jpeg');

    const data = result?.content?.[0]?.data ?? '';
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const info = await env.IMAGE_TRANSFORM.info(new Response(bytes).body!);
    expect('width' in info && info.width).toBe(requested);
  });

  it('refuses a source over the transform input limit without touching the binding', async () => {
    const { generation } = await createGeneration();
    // ingest 済みの R2 オブジェクトを直接 20MB 超へ差し替える。.input() の上限
    // チェックが transform を試みる前に効くことだけを確認する。D1 行はそのまま。
    const key = `generations/${generation.id}/original.png`;
    await env.IMAGES.put(key, new Uint8Array(20 * 1024 * 1024 + 1));

    const { result, text, isError } = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.type).toBe('text');
    expect(text).toContain('transform input limit');
    expect(text).toContain(`/g/${generation.short_id}`);
  });

  it('falls back to the original bytes when the transform fails and the source fits under the cap', async () => {
    const { generation } = await createGeneration();
    // 壊れた（デコード不能な）オブジェクトに差し替えて transform を失敗させる。
    const key = `generations/${generation.id}/original.png`;
    await env.IMAGES.put(key, new Uint8Array(1024));

    const { result, isError } = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.type).toBe('image');
    expect((result?.content?.[0]?.data ?? '').length).toBeGreaterThan(0);
  });

  it('falls back to the canonical URL when the transform fails and the original is over the inline cap', async () => {
    const { generation } = await createGeneration();
    // 壊れたオブジェクトを inline cap 超のサイズで用意し、フォールバックも
    // ポインタに落ちることを確認する。
    const key = `generations/${generation.id}/original.png`;
    await env.IMAGES.put(key, new Uint8Array(701 * 1024));

    const { result, text, isError } = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.type).toBe('text');
    expect(text).toContain('inline limit');
    expect(text).toContain(`/g/${generation.short_id}`);
  });
});

describe('Run creation enforces the same generation provenance rule', () => {
  it('409s creating a run with a generation but no batch', async () => {
    const { generation } = await createGeneration();
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: uniqueName('exp-prov-a') });
    const res = await postJson<{ error: { message: string } }>(
      `/api/v1/experiments/${experiment.body.id}/runs`,
      { generation_id: generation.id },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('attach a batch');
  });

  it('409s creating a run whose generation belongs to another batch', async () => {
    const a = await createGeneration();
    const b = await createGeneration();
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: uniqueName('exp-prov-b') });
    const res = await postJson<{ error: { message: string } }>(
      `/api/v1/experiments/${experiment.body.id}/runs`,
      { batch_id: a.batch.id, generation_id: b.generation.id },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("not the run's batch");
  });

  it('creates a run when the batch and generation match', async () => {
    const { batch, generation } = await createGeneration();
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: uniqueName('exp-prov-c') });
    const res = await postJson<{ batch_id: string; generation_id: string }>(
      `/api/v1/experiments/${experiment.body.id}/runs`,
      { batch_id: batch.id, generation_id: generation.id },
    );
    expect(res.status).toBe(201);
    expect(res.body.batch_id).toBe(batch.id);
    expect(res.body.generation_id).toBe(generation.id);
  });
});

describe('MCP tool annotations', () => {
  it('marks the read tools readOnlyHint and leaves the mutating ones unannotated', async () => {
    const { body } = await mcpCall<{ tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] }>(
      'tools/list',
      {},
    );
    const byName = new Map((body.result?.tools ?? []).map((t) => [t.name, t]));
    for (const name of ['list_experiments', 'get_experiment', 'get_run', 'get_generation_image']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
    // 副作用のある tool は承認キューに入るべきなので、readOnlyHint を主張しない。
    for (const name of ['create_run', 'attach_generation', 'set_evaluation', 'set_decision']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).not.toBe(true);
    }
  });
});
