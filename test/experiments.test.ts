import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, del, getJson, postJson } from './helpers';

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

interface Experiment {
  id: string;
  short_id: string;
  name: string;
  description: string | null;
  note: string | null;
  status: string;
  base_recipe: string | null;
  character_id: string | null;
  bookmark: boolean;
  completed_at: string | null;
}

interface ExperimentDetail extends Experiment {
  character: { id: string; name: string } | null;
  tags: string[];
  run_count: number;
  runs: unknown[];
  promotions: unknown[];
}

interface ExperimentRun {
  id: string;
  experiment_id: string;
  run_index: number;
  parent_run_id: string | null;
  batch_id: string | null;
  generation_id: string | null;
  overrides: Record<string, unknown>;
  objective: string | null;
  evaluation: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  note: string | null;
}

interface Promotion {
  id: string;
  experiment_id: string;
  source_run_id: string | null;
  promoted_overrides: Record<string, unknown>;
  status: string;
  target_repository: string;
  target_path: string | null;
  commit_sha: string | null;
  pull_request_url: string | null;
  completed_at: string | null;
}

async function createExperiment(overrides: Record<string, unknown> = {}) {
  return postJson<Experiment>('/api/v1/experiments', {
    name: uniqueName('exp'),
    ...overrides,
  });
}

async function createRun(experimentId: string, overrides: Record<string, unknown> = {}) {
  return postJson<ExperimentRun>(`/api/v1/experiments/${experimentId}/runs`, overrides);
}

describe('Create Experiment', () => {
  it('creates with defaults and round-trips base_recipe/description', async () => {
    const res = await createExperiment({ description: 'a description', base_recipe: 'recipe-v1' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.completed_at).toBeNull();
    expect(res.body.short_id).toMatch(/^[a-z0-9]{6}$/);
    expect(res.body.base_recipe).toBe('recipe-v1');
    expect(res.body.description).toBe('a description');
  });

  it('resolves GET by short_id to the same experiment', async () => {
    const created = await createExperiment();
    const byShortId = await getJson<Experiment>(`/api/v1/experiments/${created.body.short_id}`);
    expect(byShortId.status).toBe(200);
    expect(byShortId.body.id).toBe(created.body.id);
  });

  it('404s when character_id does not exist', async () => {
    const res = await createExperiment({ character_id: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });
});

describe('Create ExperimentRun', () => {
  it('starts run_index at 1 and increments per experiment independently', async () => {
    const expA = await createExperiment();
    const expB = await createExperiment();

    const a1 = await createRun(expA.body.id);
    const a2 = await createRun(expA.body.id);
    const b1 = await createRun(expB.body.id);

    expect(a1.body.run_index).toBe(1);
    expect(a2.body.run_index).toBe(2);
    expect(b1.body.run_index).toBe(1);
  });

  it('round-trips overrides JSON verbatim, including nesting and arrays', async () => {
    const exp = await createExperiment();
    const overrides = {
      patches: [
        { target: 'prompt.positive', op: 'append', value: ['light purple thighhigh socks'], reason: 'sock rendering' },
        { target: 'controlnet.weight', op: 'set', value: 0.72, reason: 'sharper edges', old: 0.6 },
      ],
    };
    const run = await createRun(exp.body.id, { overrides });
    expect(run.status).toBe(201);
    expect(run.body.overrides).toEqual(overrides);
  });

  it('defaults overrides to {} when omitted', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    expect(run.body.overrides).toEqual({});
  });

  it('400s when parent_run_id belongs to a different experiment', async () => {
    const expA = await createExperiment();
    const expB = await createExperiment();
    const parent = await createRun(expA.body.id);

    const res = await createRun(expB.body.id, { parent_run_id: parent.body.id });
    expect(res.status).toBe(400);
  });

  it('lists runs in run_index ASC order', async () => {
    const exp = await createExperiment();
    const r1 = await createRun(exp.body.id);
    const r2 = await createRun(exp.body.id);
    const r3 = await createRun(exp.body.id);

    const list = await getJson<{ items: ExperimentRun[] }>(`/api/v1/experiments/${exp.body.id}/runs`);
    expect(list.body.items.map((r) => r.id)).toEqual([r1.body.id, r2.body.id, r3.body.id]);
    expect(list.body.items.map((r) => r.run_index)).toEqual([1, 2, 3]);
  });

  it('does not produce duplicate run_index values under concurrent creates on the same experiment', async () => {
    const exp = await createExperiment();
    const CONCURRENCY = 10;

    const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => createRun(exp.body.id)));
    for (const r of results) expect(r.status).toBe(201);

    const indices = results.map((r) => r.body.run_index).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
  });
});

describe('overrides envelope validation', () => {
  it('400s the exact PoC payload (base_parameters shape, not the patch envelope), naming the unexpected keys', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { pose: '膝枕', costume: 'default', count: 1 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('pose');
    expect(res.body.error.message).toContain('costume');
    expect(res.body.error.message).toContain('count');
  });

  it('accepts {}', async () => {
    const exp = await createExperiment();
    const res = await createRun(exp.body.id, { overrides: {} });
    expect(res.status).toBe(201);
    expect(res.body.overrides).toEqual({});
  });

  it('accepts {"patches": []}', async () => {
    const exp = await createExperiment();
    const res = await createRun(exp.body.id, { overrides: { patches: [] } });
    expect(res.status).toBe(201);
    expect(res.body.overrides).toEqual({ patches: [] });
  });

  it('accepts a well-formed patch list, including one with `old` and one with a numeric `value`', async () => {
    const exp = await createExperiment();
    const overrides = {
      patches: [
        { target: 'prompt.negative', op: 'remove', old: 'bare legs', reason: 'legwear must stay covered' },
        { target: 'render.cfg', op: 'set', value: 4.5, reason: 'sharper edges' },
      ],
    };
    const res = await createRun(exp.body.id, { overrides });
    expect(res.status).toBe(201);
    expect(res.body.overrides).toEqual(overrides);
  });

  it('accepts an unknown target value — chimera does not own the target/op vocabulary', async () => {
    const exp = await createExperiment();
    const overrides = { patches: [{ target: 'prompt.nonsense', op: 'set', value: 1, reason: 'r' }] };
    const res = await createRun(exp.body.id, { overrides });
    expect(res.status).toBe(201);
    expect(res.body.overrides).toEqual(overrides);
  });

  it('400s when patches is not an array', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { patches: { target: 'a', op: 'set', reason: 'r' } },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('patches');
  });

  it('400s naming the index of a patch entry that is not an object', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { patches: [{ target: 'a', op: 'set', reason: 'r' }, 'not-an-object'] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('patches.1');
  });

  it('400s a patch missing reason', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { patches: [{ target: 'a', op: 'set' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('reason');
  });

  it('400s a patch missing target', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { patches: [{ op: 'set', reason: 'r' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('target');
  });

  it('400s a patch missing op', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { patches: [{ target: 'a', reason: 'r' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('op');
  });

  it('400s a patch with an empty-string target', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      overrides: { patches: [{ target: '', op: 'set', reason: 'r' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('target');
  });

  it('applies the same rejection on PATCH /api/v1/experiment-runs/{id}', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const res = await postJson<{ error: { message: string } }>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { overrides: { pose: '膝枕', costume: 'default', count: 1 } },
      'PATCH',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('pose');
  });

  it('applies the same rejection to promoted_overrides on promotion create', async () => {
    const exp = await createExperiment();
    const res = await postJson<{ error: { message: string } }>(`/api/v1/experiments/${exp.body.id}/promotions`, {
      promoted_overrides: { pose: '膝枕', costume: 'default', count: 1 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('pose');
  });

  it('applies the same rejection to promoted_overrides on promotion update', async () => {
    const exp = await createExperiment();
    const promo = await postJson<{ id: string }>(`/api/v1/experiments/${exp.body.id}/promotions`, {});
    const res = await postJson<{ error: { message: string } }>(
      `/api/v1/promotions/${promo.body.id}`,
      { promoted_overrides: { pose: '膝枕', costume: 'default', count: 1 } },
      'PATCH',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('pose');
  });

  it('leaves evaluation and decision free-form, including a decision.next_overrides that is not patch-shaped', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const decision = {
      action: 'retry',
      reason: 'r',
      next_overrides: { prompt: { positive_append: ['distinct sock cuff'] } },
    };
    const res = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { evaluation: { pose: 'x', costume: 'y' }, decision },
      'PATCH',
    );
    expect(res.status).toBe(200);
    expect(res.body.evaluation).toEqual({ pose: 'x', costume: 'y' });
    expect(res.body.decision).toEqual(decision);
  });
});

describe('ExperimentRun idempotency', () => {
  it('201s on first create with a key; replaying the same key + experiment 200s with the identical run id and keeps run_count at 1', async () => {
    const exp = await createExperiment();
    const key = crypto.randomUUID();

    const first = await createRun(exp.body.id, { idempotency_key: key });
    expect(first.status).toBe(201);

    const replay = await createRun(exp.body.id, { idempotency_key: key });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    expect(detail.body.run_count).toBe(1);
  });

  it('does not allocate a new run_index on replay', async () => {
    const exp = await createExperiment();
    const key = crypto.randomUUID();

    const first = await createRun(exp.body.id, { idempotency_key: key });
    const replay = await createRun(exp.body.id, { idempotency_key: key });
    expect(replay.body.run_index).toBe(first.body.run_index);

    // A subsequent, differently-keyed run still gets the next index (no gap/skip left behind).
    const next = await createRun(exp.body.id);
    expect(next.body.run_index).toBe(first.body.run_index + 1);
  });

  it('409s reusing the same key against a different experiment', async () => {
    const expA = await createExperiment();
    const expB = await createExperiment();
    const key = crypto.randomUUID();

    const first = await createRun(expA.body.id, { idempotency_key: key });
    expect(first.status).toBe(201);

    const res = await createRun(expB.body.id, { idempotency_key: key });
    expect(res.status).toBe(409);
  });

  it('two creates with different keys produce two runs', async () => {
    const exp = await createExperiment();
    const a = await createRun(exp.body.id, { idempotency_key: crypto.randomUUID() });
    const b = await createRun(exp.body.id, { idempotency_key: crypto.randomUUID() });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('creating without a key twice produces two runs (unchanged behaviour)', async () => {
    const exp = await createExperiment();
    const a = await createRun(exp.body.id);
    const b = await createRun(exp.body.id);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('concurrent creates with the same key produce exactly one run', async () => {
    const exp = await createExperiment();
    const key = crypto.randomUUID();
    const CONCURRENCY = 8;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => createRun(exp.body.id, { idempotency_key: key })),
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(CONCURRENCY - 1);

    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    expect(detail.body.run_count).toBe(1);
  });
});

describe('Generation / Batch linkage', () => {
  it('attaches a batch, then a generation (by short_id) from that batch, surfacing them in the experiment detail', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation, batch } = await createGeneration();

    const patchedBatch = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { batch_id: batch.id },
      'PATCH',
    );
    expect(patchedBatch.status).toBe(200);

    const patchedGeneration = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { generation_id: generation.short_id },
      'PATCH',
    );
    expect(patchedGeneration.status).toBe(200);

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    const decoratedRun = detail.body.runs.find((r: any) => r.id === run.body.id) as any;
    expect(decoratedRun.generation).toMatchObject({ id: generation.id });
    expect(decoratedRun.generation.thumbnail_url).toBeTruthy();
    expect(decoratedRun.batch).toMatchObject({ short_id: batch.short_id });
  });

  it('409s when attaching a different generation to a run that already has one', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation: g1, batch: batch1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();

    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch1.id }, 'PATCH');

    const first = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: g1.id }, 'PATCH');
    expect(first.status).toBe(200);

    const second = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: g2.id }, 'PATCH');
    expect(second.status).toBe(409);
  });

  it('accepts re-attaching the same generation id (idempotent)', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation, batch } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch.id }, 'PATCH');

    const first = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: generation.id }, 'PATCH');
    expect(first.status).toBe(200);

    const again = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: generation.id }, 'PATCH');
    expect(again.status).toBe(200);
  });

  it('404s when attaching a nonexistent generation', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const res = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: crypto.randomUUID() }, 'PATCH');
    expect(res.status).toBe(404);
  });

  it('409s attaching a generation to a run with no batch attached', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation } = await createGeneration();

    const res = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: generation.id }, 'PATCH');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { message: expect.stringContaining('no batch attached') } });
  });

  it('409s attaching a generation that belongs to a different batch than the run', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { batch: runBatch } = await createGeneration();
    const { generation: otherGeneration } = await createGeneration();

    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: runBatch.id }, 'PATCH');

    const res = await postJson(
      `/api/v1/experiment-runs/${run.body.id}`,
      { generation_id: otherGeneration.id },
      'PATCH',
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { message: expect.stringContaining(`not the run's batch ${runBatch.id}`) },
    });
  });

  it('200s setting a matching batch_id and generation_id together in one PATCH', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation, batch } = await createGeneration();

    const res = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { batch_id: batch.id, generation_id: generation.id },
      'PATCH',
    );
    expect(res.status).toBe(200);
    expect(res.body.batch_id).toBe(batch.id);
    expect(res.body.generation_id).toBe(generation.id);
  });

  it('409s setting a batch_id and generation_id together in one PATCH when the generation belongs to a different batch', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { batch } = await createGeneration();
    const { generation: otherGeneration } = await createGeneration();

    const res = await postJson(
      `/api/v1/experiment-runs/${run.body.id}`,
      { batch_id: batch.id, generation_id: otherGeneration.id },
      'PATCH',
    );
    expect(res.status).toBe(409);
  });
});

describe('Evaluation / Decision', () => {
  it('round-trips a spec-shaped evaluation exactly', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const evaluation = {
      overall: 'fail',
      aspects: { pose: 'pass', clothing: 'fail' },
      notes: ['sock/tights boundary is ambiguous'],
    };
    const patched = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { evaluation },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.evaluation).toEqual(evaluation);
  });

  it('round-trips a decision exactly', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const decision = {
      action: 'retry',
      reason: 'clothing boundary needs to be clearer',
      next_overrides: { prompt: { positive_append: ['distinct sock cuff'] } },
    };
    const patched = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { decision },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.decision).toEqual(decision);
  });

  it('explicit null clears evaluation and decision', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id, {
      evaluation: { overall: 'pass' },
      decision: { action: 'accept' },
    });

    const cleared = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { evaluation: null, decision: null },
      'PATCH',
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.evaluation).toBeNull();
    expect(cleared.body.decision).toBeNull();
  });

  it('GET /api/v1/experiments reports latest_run.evaluation_overall from the highest run_index run', async () => {
    const exp = await createExperiment();
    await createRun(exp.body.id, { evaluation: { overall: 'fail' } });
    await createRun(exp.body.id, { evaluation: { overall: 'pass' } });

    const list = await getJson<{ items: { id: string; latest_run: { evaluation_overall: string | null } | null }[] }>(
      '/api/v1/experiments?limit=200',
    );
    const found = list.body.items.find((e) => e.id === exp.body.id);
    expect(found?.latest_run?.evaluation_overall).toBe('pass');
  });
});

describe('Guardrails', () => {
  it('409s changing overrides after a generation is attached', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation, batch } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch.id }, 'PATCH');
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: generation.id }, 'PATCH');

    const res = await postJson(
      `/api/v1/experiment-runs/${run.body.id}`,
      { overrides: { patches: [{ target: 'render.cfg', op: 'set', value: 4.5, reason: 'r' }] } },
      'PATCH',
    );
    expect(res.status).toBe(409);
  });

  it('409s changing overrides after a batch is attached', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { batch } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch.id }, 'PATCH');

    const res = await postJson(
      `/api/v1/experiment-runs/${run.body.id}`,
      { overrides: { patches: [{ target: 'render.cfg', op: 'set', value: 4.5, reason: 'r' }] } },
      'PATCH',
    );
    expect(res.status).toBe(409);
  });

  it('allows changing overrides before anything is attached', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id, {
      overrides: { patches: [{ target: 'render.cfg', op: 'set', value: 4.5, reason: 'r' }] },
    });

    const updated = { patches: [{ target: 'render.cfg', op: 'set', value: 5.0, reason: 'r2' }] };
    const res = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { overrides: updated },
      'PATCH',
    );
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual(updated);
  });

  it('400s PATCH with no fields', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const res = await postJson(`/api/v1/experiment-runs/${run.body.id}`, {}, 'PATCH');
    expect(res.status).toBe(400);
  });

  it('404s DELETE on an experiment run (no delete endpoint)', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const res = await del(`/api/v1/experiment-runs/${run.body.id}`);
    expect(res.status).toBe(404);
  });

  it('400s GET /api/v1/experiments?status= with an invalid status, 200s with a valid one', async () => {
    const invalid = await getJson('/api/v1/experiments?status=stabilised');
    expect(invalid.status).toBe(400);

    const valid = await getJson<{ items: unknown[] }>('/api/v1/experiments?status=stabilized');
    expect(valid.status).toBe(200);
  });
});

describe('Experiment status transitions', () => {
  async function patchStatus(id: string, status: string) {
    return postJson<Experiment>(`/api/v1/experiments/${id}`, { status }, 'PATCH');
  }

  it('active -> stabilized -> promoted sets and preserves completed_at', async () => {
    const exp = await createExperiment();
    expect(exp.body.completed_at).toBeNull();

    const stabilized = await patchStatus(exp.body.id, 'stabilized');
    expect(stabilized.status).toBe(200);
    expect(stabilized.body.status).toBe('stabilized');
    expect(stabilized.body.completed_at).not.toBeNull();
    const completedAt = stabilized.body.completed_at;

    const promoted = await patchStatus(exp.body.id, 'promoted');
    expect(promoted.status).toBe(200);
    expect(promoted.body.status).toBe('promoted');
    expect(promoted.body.completed_at).toBe(completedAt);
  });

  it('promoted -> active clears completed_at', async () => {
    const exp = await createExperiment();
    await patchStatus(exp.body.id, 'stabilized');
    await patchStatus(exp.body.id, 'promoted');

    const backToActive = await patchStatus(exp.body.id, 'active');
    expect(backToActive.status).toBe(200);
    expect(backToActive.body.status).toBe('active');
    expect(backToActive.body.completed_at).toBeNull();
  });

  it('409s active -> promoted directly', async () => {
    const exp = await createExperiment();
    const res = await patchStatus(exp.body.id, 'promoted');
    expect(res.status).toBe(409);
  });

  it('setting the same status again is a no-op 200', async () => {
    const exp = await createExperiment();
    const res = await patchStatus(exp.body.id, 'active');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
});

describe('Promotion', () => {
  it('copies the source run overrides when promoted_overrides is not given', async () => {
    const exp = await createExperiment();
    const overrides = { patches: [{ target: 'controlnet.weight', op: 'set', value: 0.9, reason: 'r' }] };
    const run = await createRun(exp.body.id, { overrides });

    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {
      source_run_id: run.body.id,
    });
    expect(promo.status).toBe(201);
    expect(promo.body.promoted_overrides).toEqual(overrides);
  });

  it('explicit promoted_overrides wins over the source run overrides', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id, {
      overrides: { patches: [{ target: 'a', op: 'set', value: 1, reason: 'r' }] },
    });
    const explicitOverrides = {
      patches: [
        { target: 'a', op: 'set', value: 2, reason: 'r' },
        { target: 'b', op: 'set', value: 3, reason: 'r' },
      ],
    };

    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {
      source_run_id: run.body.id,
      promoted_overrides: explicitOverrides,
    });
    expect(promo.status).toBe(201);
    expect(promo.body.promoted_overrides).toEqual(explicitOverrides);
  });

  it('defaults status/target_repository/commit_sha/completed_at', async () => {
    const exp = await createExperiment();
    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {});
    expect(promo.status).toBe(201);
    expect(promo.body.status).toBe('proposed');
    expect(promo.body.target_repository).toBe('comfyui-recipes');
    expect(promo.body.commit_sha).toBeNull();
    expect(promo.body.completed_at).toBeNull();
  });

  it('400s when source_run_id belongs to another experiment', async () => {
    const expA = await createExperiment();
    const expB = await createExperiment();
    const runA = await createRun(expA.body.id);

    const res = await postJson(`/api/v1/experiments/${expB.body.id}/promotions`, { source_run_id: runA.body.id });
    expect(res.status).toBe(400);
  });

  it('sets commit_sha/pull_request_url, then status applied sets completed_at', async () => {
    const exp = await createExperiment();
    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {});

    const withCommit = await postJson<Promotion>(
      `/api/v1/promotions/${promo.body.id}`,
      { commit_sha: 'abc123', pull_request_url: 'https://github.com/example/repo/pull/1' },
      'PATCH',
    );
    expect(withCommit.status).toBe(200);
    expect(withCommit.body.commit_sha).toBe('abc123');
    expect(withCommit.body.pull_request_url).toBe('https://github.com/example/repo/pull/1');
    expect(withCommit.body.completed_at).toBeNull();

    const applied = await postJson<Promotion>(`/api/v1/promotions/${promo.body.id}`, { status: 'applied' }, 'PATCH');
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('applied');
    expect(applied.body.completed_at).not.toBeNull();
  });

  it('409s applied -> rejected (terminal)', async () => {
    const exp = await createExperiment();
    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {});
    await postJson(`/api/v1/promotions/${promo.body.id}`, { status: 'applied' }, 'PATCH');

    const res = await postJson(`/api/v1/promotions/${promo.body.id}`, { status: 'rejected' }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('409s changing promoted_overrides after applied', async () => {
    const exp = await createExperiment();
    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {});
    await postJson(`/api/v1/promotions/${promo.body.id}`, { status: 'applied' }, 'PATCH');

    const res = await postJson(
      `/api/v1/promotions/${promo.body.id}`,
      { promoted_overrides: { patches: [{ target: 'a', op: 'set', value: 1, reason: 'r' }] } },
      'PATCH',
    );
    expect(res.status).toBe(409);
  });

  it('lists promotions for an experiment', async () => {
    const exp = await createExperiment();
    await postJson(`/api/v1/experiments/${exp.body.id}/promotions`, {});
    await postJson(`/api/v1/experiments/${exp.body.id}/promotions`, {});

    const list = await getJson<{ items: Promotion[] }>(`/api/v1/experiments/${exp.body.id}/promotions`);
    expect(list.body.items).toHaveLength(2);
  });

  it('400s creating a promotion with a javascript: pull_request_url, 201s with an https URL that round-trips', async () => {
    const exp = await createExperiment();

    const bad = await postJson(`/api/v1/experiments/${exp.body.id}/promotions`, {
      pull_request_url: 'javascript:alert(1)',
    });
    expect(bad.status).toBe(400);

    const good = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {
      pull_request_url: 'https://github.com/example/repo/pull/2',
    });
    expect(good.status).toBe(201);
    expect(good.body.pull_request_url).toBe('https://github.com/example/repo/pull/2');
  });

  it('400s patching a promotion with a javascript: pull_request_url, 200s with an https URL that round-trips', async () => {
    const exp = await createExperiment();
    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {});

    const bad = await postJson(`/api/v1/promotions/${promo.body.id}`, { pull_request_url: 'javascript:alert(1)' }, 'PATCH');
    expect(bad.status).toBe(400);

    const good = await postJson<Promotion>(
      `/api/v1/promotions/${promo.body.id}`,
      { pull_request_url: 'https://github.com/example/repo/pull/3' },
      'PATCH',
    );
    expect(good.status).toBe(200);
    expect(good.body.pull_request_url).toBe('https://github.com/example/repo/pull/3');
  });
});

describe('Experiment detail', () => {
  it('reports run_count, runs in index order, promotions, and tags', async () => {
    const exp = await createExperiment();
    const r1 = await createRun(exp.body.id);
    const r2 = await createRun(exp.body.id);
    const r3 = await createRun(exp.body.id);
    await postJson(`/api/v1/experiments/${exp.body.id}/promotions`, { source_run_id: r1.body.id });

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    expect(detail.body.run_count).toBe(3);
    expect(detail.body.runs).toHaveLength(3);
    expect((detail.body.runs as any[]).map((r) => r.id)).toEqual([r1.body.id, r2.body.id, r3.body.id]);
    expect(detail.body.promotions).toHaveLength(1);
    expect(Array.isArray(detail.body.tags)).toBe(true);
  });

  it('supports bookmark and tag endpoints', async () => {
    const exp = await createExperiment();

    const bookmarked = await postJson<{ bookmark: boolean }>(`/api/v1/experiments/${exp.body.id}/bookmark`, {}, 'PUT');
    expect(bookmarked.status).toBe(200);
    expect(bookmarked.body.bookmark).toBe(true);

    const tagged = await postJson<{ id: string; name: string }>(`/api/v1/experiments/${exp.body.id}/tags`, {
      name: uniqueName('tag'),
    });
    expect(tagged.status).toBe(201);

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    expect(detail.body.tags).toContain(tagged.body.name);
  });
});

describe('D1 bound-parameter chunking (>100 ids)', () => {
  it('GET /api/v1/experiments/{id} returns every run when the experiment has more than 100', async () => {
    const exp = await createExperiment();
    const RUN_COUNT = 120;
    const now = new Date().toISOString();

    // 120件を REST 経由で1件ずつ作ると直列 fetch でテストが遅くなるため、env.DB へ直接
    // INSERT する。各 Run に一意な batch_id を振ることで、decorateRuns の
    // `batches WHERE id IN (...)` / `resolveBatchThumbnails` が 100 個を超える bound
    // parameter を要求する状況を再現する。batch_id は FK 制約があるため、ダミーの
    // batches 行も先に用意する。
    const batchIds = Array.from({ length: RUN_COUNT }, () => crypto.randomUUID());
    const batchStatements = batchIds.map((id) =>
      env.DB.prepare(
        `INSERT INTO batches (id, short_id, prompt, status, idempotency_key, created_at, updated_at)
         VALUES (?, ?, 'chunk test', 'created', ?, ?, ?)`,
      ).bind(id, crypto.randomUUID().replace(/-/g, '').slice(0, 6), crypto.randomUUID(), now, now),
    );
    await env.DB.batch(batchStatements);

    const runStatements = batchIds.map((batchId, i) =>
      env.DB.prepare(
        `INSERT INTO experiment_runs
           (id, experiment_id, run_index, batch_id, overrides_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      ).bind(crypto.randomUUID(), exp.body.id, i + 1, batchId, now, now),
    );
    await env.DB.batch(runStatements);

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.run_count).toBe(RUN_COUNT);
    expect(detail.body.runs).toHaveLength(RUN_COUNT);
  });
});
