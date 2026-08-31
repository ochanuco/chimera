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
      prompt: { positive_append: ['light purple thighhigh socks'] },
      controlnet: { weight: 0.72 },
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
});

describe('Generation / Batch linkage', () => {
  it('attaches a generation (by short_id) and a batch, surfacing them in the experiment detail', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation, batch } = await createGeneration();

    const patchedGeneration = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { generation_id: generation.short_id },
      'PATCH',
    );
    expect(patchedGeneration.status).toBe(200);

    const patchedBatch = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { batch_id: batch.id },
      'PATCH',
    );
    expect(patchedBatch.status).toBe(200);

    const detail = await getJson<ExperimentDetail>(`/api/v1/experiments/${exp.body.id}`);
    const decoratedRun = detail.body.runs.find((r: any) => r.id === run.body.id) as any;
    expect(decoratedRun.generation).toMatchObject({ id: generation.id });
    expect(decoratedRun.generation.thumbnail_url).toBeTruthy();
    expect(decoratedRun.batch).toMatchObject({ short_id: batch.short_id });
  });

  it('409s when attaching a different generation to a run that already has one', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();

    const first = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: g1.id }, 'PATCH');
    expect(first.status).toBe(200);

    const second = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: g2.id }, 'PATCH');
    expect(second.status).toBe(409);
  });

  it('accepts re-attaching the same generation id (idempotent)', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { generation } = await createGeneration();

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
    const { generation } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { generation_id: generation.id }, 'PATCH');

    const res = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { overrides: { foo: 'bar' } }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('409s changing overrides after a batch is attached', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id);
    const { batch } = await createGeneration();
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { batch_id: batch.id }, 'PATCH');

    const res = await postJson(`/api/v1/experiment-runs/${run.body.id}`, { overrides: { foo: 'bar' } }, 'PATCH');
    expect(res.status).toBe(409);
  });

  it('allows changing overrides before anything is attached', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id, { overrides: { a: 1 } });

    const res = await postJson<ExperimentRun>(
      `/api/v1/experiment-runs/${run.body.id}`,
      { overrides: { a: 2 } },
      'PATCH',
    );
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual({ a: 2 });
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
    const overrides = { controlnet: { weight: 0.9 } };
    const run = await createRun(exp.body.id, { overrides });

    const promo = await postJson<Promotion>(`/api/v1/experiments/${exp.body.id}/promotions`, {
      source_run_id: run.body.id,
    });
    expect(promo.status).toBe(201);
    expect(promo.body.promoted_overrides).toEqual(overrides);
  });

  it('explicit promoted_overrides wins over the source run overrides', async () => {
    const exp = await createExperiment();
    const run = await createRun(exp.body.id, { overrides: { a: 1 } });
    const explicitOverrides = { a: 2, b: 3 };

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

    const res = await postJson(`/api/v1/promotions/${promo.body.id}`, { promoted_overrides: { a: 1 } }, 'PATCH');
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
