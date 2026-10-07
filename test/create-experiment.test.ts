import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildRunRequestPayload } from '../src/lib/requests';
import type { ExperimentRow, ExperimentRunRow } from '../src/types';
import { createGeneration, getJson, mcpToolCall, postJson, req } from './helpers';

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

interface CreateExperimentResult {
  experiment: { id: string; short_id: string; url: string; compare_url: string };
  runs: { id: string; arm: string; request_id: string | null; request_short_id: string | null }[];
  created: boolean;
}

const PATCH = { target: 'prompt.positive.expression', op: 'replace', value: 'smile', reason: 'try smile' };

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    name: uniqueName('exp'),
    recipe: 'yukari',
    parameters: { pose: 'lounge' },
    seeds: [11, 22],
    arms: [{ label: 'control' }, { label: 'smile', instruction: 'smile a little', patches: [PATCH] }],
    idempotency_key: crypto.randomUUID(),
    ...overrides,
  };
}

async function requestPayload(requestId: string) {
  const row = await env.DB.prepare('SELECT payload_json FROM requests WHERE id = ?').bind(requestId).first<{ payload_json: string }>();
  return JSON.parse(row!.payload_json) as {
    request: { instruction: string; count: number; seeds?: number[] };
    generation: { recipe: string; parameters: Record<string, unknown> };
    experiment: { overrides: { patches?: unknown[] } };
  };
}

describe('create_experiment MCP tool', () => {
  it('creates the Experiment and one Run per arm, each queuing a request that shares the seeds', async () => {
    const input = createInput();
    const call = await mcpToolCall<CreateExperimentResult>('create_experiment', input);
    expect(call.isError).toBe(false);
    const data = call.data!;
    expect(data.created).toBe(true);
    expect(data.experiment.url).toBe(`https://chimera.test/experiments/${data.experiment.short_id}`);
    expect(data.experiment.compare_url).toContain(data.experiment.url);
    expect(data.runs.map((r) => r.arm)).toEqual(['control', 'smile']);

    const experiment = await getJson<{ base_recipe: string; base_parameters: Record<string, unknown> }>(
      `/api/v1/experiments/${data.experiment.id}`,
    );
    expect(experiment.body.base_recipe).toBe('yukari');
    expect(experiment.body.base_parameters).toEqual({ pose: 'lounge', seeds: [11, 22] });

    const control = await requestPayload(data.runs[0]!.request_id!);
    expect(control.request).toEqual({ instruction: 'control', count: 2, seeds: [11, 22] });
    expect(control.generation).toEqual({ recipe: 'yukari', parameters: { pose: 'lounge' } });
    expect(control.experiment.overrides).toEqual({ patches: [] });

    const smile = await requestPayload(data.runs[1]!.request_id!);
    expect(smile.request).toEqual({ instruction: 'smile a little', count: 2, seeds: [11, 22] });
    expect(smile.experiment.overrides).toEqual({ patches: [PATCH] });

    const runs = await getJson<{ items: { id: string; run_index: number; objective: string; variables: unknown; idempotency_key?: string }[] }>(
      `/api/v1/experiments/${data.experiment.id}/runs`,
    );
    expect(runs.body.items.map((r) => [r.run_index, r.objective, r.variables])).toEqual([
      [1, 'control', { arm: 'control' }],
      [2, 'smile a little', { arm: 'smile' }],
    ]);
  });

  it('replays the same key as created=false with the same Experiment and Runs', async () => {
    const input = createInput();
    const first = await mcpToolCall<CreateExperimentResult>('create_experiment', input);
    const second = await mcpToolCall<CreateExperimentResult>('create_experiment', input);
    expect(second.isError).toBe(false);
    expect(second.data!.created).toBe(false);
    expect(second.data!.experiment.id).toBe(first.data!.experiment.id);
    expect(second.data!.runs.map((r) => r.id)).toEqual(first.data!.runs.map((r) => r.id));
    expect(second.data!.runs.map((r) => r.request_id)).toEqual(first.data!.runs.map((r) => r.request_id));
  });

  it('rejects a replay of the key with different arms (409) without creating anything', async () => {
    const input = createInput();
    const first = await mcpToolCall<CreateExperimentResult>('create_experiment', input);

    const relabeled = await mcpToolCall('create_experiment', { ...input, arms: [{ label: 'control' }, { label: 'frown' }] });
    expect(relabeled.isError).toBe(true);
    expect(relabeled.text).toContain('different set of arms');

    const grown = await mcpToolCall('create_experiment', { ...input, arms: [...input.arms, { label: 'third' }] });
    expect(grown.isError).toBe(false);
    const fewer = await mcpToolCall('create_experiment', { ...input, arms: [{ label: 'control' }] });
    expect(fewer.isError).toBe(true);

    const runs = await getJson<{ items: unknown[] }>(`/api/v1/experiments/${first.data!.experiment.id}/runs`);
    expect(runs.body.items).toHaveLength(3);
  });

  it('validates arms: duplicate labels, bad patches, count and size limits', async () => {
    const duplicate = await mcpToolCall('create_experiment', createInput({ arms: [{ label: 'a' }, { label: 'a' }] }));
    expect(duplicate.isError).toBe(true);
    expect(duplicate.text).toContain('duplicate arm label');

    const badPatch = await mcpToolCall('create_experiment', createInput({ arms: [{ label: 'a', patches: [{ target: 'x' }] }] }));
    expect(badPatch.isError).toBe(true);

    const none = await mcpToolCall('create_experiment', createInput({ arms: [] }));
    expect(none.isError).toBe(true);

    const tooMany = await mcpToolCall(
      'create_experiment',
      createInput({ arms: Array.from({ length: 10 }, (_, i) => ({ label: `arm${i}` })) }),
    );
    expect(tooMany.isError).toBe(true);

    const noKey = await mcpToolCall('create_experiment', { ...createInput(), idempotency_key: undefined });
    expect(noKey.isError).toBe(true);
  });

  it('rejects a count that conflicts with seeds', async () => {
    const call = await mcpToolCall('create_experiment', createInput({ parameters: { pose: 'lounge', count: 3 } }));
    expect(call.isError).toBe(true);
    expect(call.text).toContain('seeds');
  });

  it('without seeds, count from parameters sizes the request and no seeds are sent', async () => {
    const call = await mcpToolCall<CreateExperimentResult>(
      'create_experiment',
      createInput({ seeds: undefined, parameters: { pose: 'lounge', count: 3 } }),
    );
    expect(call.isError).toBe(false);
    const payload = await requestPayload(call.data!.runs[0]!.request_id!);
    expect(payload.request).toEqual({ instruction: 'control', count: 3 });
  });
});

describe('base_parameters.seeds', () => {
  it('is validated on create and PATCH of an Experiment', async () => {
    const ok = await postJson<{ id: string }>('/api/v1/experiments', {
      name: uniqueName('exp'),
      base_recipe: 'yukari',
      base_parameters: { seeds: [1, 2], count: 2 },
    });
    expect(ok.status).toBe(201);

    for (const bad of [
      { seeds: [] },
      { seeds: [-1] },
      { seeds: [1.5] },
      { seeds: 'x' },
      { seeds: Array.from({ length: 17 }, (_, i) => i) },
      { seeds: [1, 2], count: 3 },
    ]) {
      const created = await postJson('/api/v1/experiments', { name: uniqueName('exp'), base_parameters: bad });
      expect(created.status, JSON.stringify(bad)).toBe(400);
      const patched = await postJson(`/api/v1/experiments/${ok.body.id}`, { base_parameters: bad }, 'PATCH');
      expect(patched.status, JSON.stringify(bad)).toBe(400);
    }

    const patched = await postJson(`/api/v1/experiments/${ok.body.id}`, { base_parameters: { seeds: [5] } }, 'PATCH');
    expect(patched.status).toBe(200);
  });
});

describe('buildRunRequestPayload seeds', () => {
  const experiment = (parameters: Record<string, unknown>): ExperimentRow =>
    ({
      id: 'e1',
      name: 'exp',
      base_recipe: 'yukari',
      base_parameters_json: JSON.stringify(parameters),
      base_generation_id: null,
    }) as ExperimentRow;
  const run = { id: 'r1', run_index: 1, objective: null, overrides_json: '{}' } as ExperimentRunRow;

  it('sets request.seeds and count from seeds and strips seeds from generation.parameters', () => {
    const payload = buildRunRequestPayload(experiment({ pose: 'p', seeds: [3, 4, 5] }), run) as {
      request: unknown;
      generation: { parameters: unknown };
    };
    expect(payload.request).toEqual({ instruction: 'run #1 of exp', count: 3, seeds: [3, 4, 5] });
    expect(payload.generation.parameters).toEqual({ pose: 'p' });
  });

  it('keeps the count-only behavior without seeds', () => {
    const payload = buildRunRequestPayload(experiment({ pose: 'p', count: 2 }), run) as { request: unknown };
    expect(payload.request).toEqual({ instruction: 'run #1 of exp', count: 2 });
  });
});

async function finishRequest(requestId: string, seeds: number[]) {
  await env.DB.prepare("UPDATE requests SET status = 'done' WHERE id = ?").bind(requestId).run();
  for (const seed of seeds) {
    await createGeneration({ requestId, jobOverrides: { seed }, metadata: { seed } });
  }
}

describe('Experiment Detail as Compare', () => {
  async function setup(arms: Record<string, unknown>[], seeds = [11, 22]) {
    const call = await mcpToolCall<CreateExperimentResult>('create_experiment', createInput({ arms, seeds }));
    return call.data!;
  }

  it('renders the Runs as columns headed by arm, with 変更点 rows from the Runs', async () => {
    const data = await setup([{ label: 'control' }, { label: 'smile', instruction: 'smile a little', patches: [PATCH] }]);
    for (const run of data.runs) await finishRequest(run.request_id!, [11, 22]);

    const res = await req(`/experiments/${data.experiment.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="experiment-compare"');
    expect(body).toContain('class="compare-table"');
    expect(body).toContain('>control</div>');
    expect(body).toContain('>smile</div>');
    expect(body).toContain('smile a little');
    expect(body).toContain('（変更なし）');
    expect(body).toContain('class="cmp-patch-part">expression</span>');
    expect(body).toContain('Compare で開く');
    expect(body.indexOf('<h2>Runs</h2>')).toBeLessThan(body.indexOf('id="experiment-compare"'));
    expect(body.indexOf('id="experiment-compare"')).toBeLessThan(body.indexOf('<h2>A/B</h2>'));
  });

  it('shows the first seed of base_parameters.seeds by default and switches with ?seed=', async () => {
    const data = await setup([{ label: 'control' }, { label: 'smile', patches: [PATCH] }]);
    for (const run of data.runs) await finishRequest(run.request_id!, [11, 22]);

    const first = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    expect(first).toContain('<strong class="exp-compare-seed current">11</strong>');
    expect(first).toContain(`href="/experiments/${data.experiment.short_id}?seed=22#experiment-compare-detail"`);

    const second = await (await req(`/experiments/${data.experiment.short_id}?seed=22`)).text();
    expect(second).toContain('<strong class="exp-compare-seed current">22</strong>');
    const seedRow = /<tr[^>]*><td>seed<\/td>(.*?)<\/tr>/s.exec(second);
    expect(seedRow?.[1]).toContain('22');
    expect(seedRow?.[1]).not.toContain('11');
  });

  it('shows a placeholder column for a Run that has no generation yet and leaves the diff intact', async () => {
    const data = await setup([{ label: 'control' }, { label: 'smile', patches: [PATCH] }]);
    await finishRequest(data.runs[0]!.request_id!, [11, 22]);

    const body = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    expect(body).toContain('compare-placeholder');
    expect(body).toContain('compare-head-pending');
    expect(body).toContain('class="cmp-patch-part">expression</span>');
  });

  async function generationShortIds(requestId: string) {
    const { results } = await env.DB.prepare('SELECT short_id, seed FROM generations WHERE request_id = ?')
      .bind(requestId)
      .all<{ short_id: string; seed: number }>();
    return new Map((results ?? []).map((r) => [r.seed, r.short_id]));
  }

  it('shows every generation of a single Run as one matrix row, without the per-seed compare grid', async () => {
    const data = await setup([{ label: 'only' }]);
    await finishRequest(data.runs[0]!.request_id!, [11, 22]);
    const ids = await generationShortIds(data.runs[0]!.request_id!);
    const body = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    expect(body).toContain('id="experiment-compare"');
    const matrix = /<table class="exp-matrix">.*?<\/table>/s.exec(body)![0];
    expect(matrix).toContain('>only</th>');
    expect(matrix.match(/class="exp-matrix-cell"/g)).toHaveLength(2);
    expect(matrix.match(/<div class="card"/g)).toHaveLength(2);
    expect(matrix).toContain('class="rating-group"');
    expect(matrix).toContain('class="bookmark-btn card-bookmark-btn"');
    expect(matrix).toContain(`href="/g/${ids.get(11)}"`);
    expect(matrix).toContain(`href="/g/${ids.get(22)}"`);
    expect(body).not.toContain('id="experiment-compare-detail"');
    expect(body).not.toContain('class="compare-table"');
  });

  it('renders a rated matrix cell with the gallery card safety bar', async () => {
    const data = await setup([{ label: 'only' }]);
    await finishRequest(data.runs[0]!.request_id!, [11]);
    const ids = await generationShortIds(data.runs[0]!.request_id!);
    const put = await postJson(
      `/api/v1/generations/${ids.get(11)}/safety`,
      { model: 'wd-test@abc', rating: { general: 0.1, sensitive: 0.5, questionable: 0.3, explicit: 0 }, tags: {} },
      'PUT',
    );
    expect(put.status).toBe(200);
    const body = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    const matrix = /<table class="exp-matrix">.*?<\/table>/s.exec(body)![0];
    expect(matrix).toContain('rating-bar-strip');
  });

  it('orders matrix columns by base_parameters.seeds and leaves a placeholder for a missing generation', async () => {
    const data = await setup([{ label: 'control' }, { label: 'smile', patches: [PATCH] }], [22, 11]);
    await finishRequest(data.runs[0]!.request_id!, [11, 22, 33]);
    await finishRequest(data.runs[1]!.request_id!, [22]);
    const body = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    const matrix = /<table class="exp-matrix">.*?<\/table>/s.exec(body)![0];
    const heads = [...matrix.matchAll(/<th class="exp-matrix-seed">(\d+)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['22', '11', '33']);
    expect(matrix.indexOf('>control</th>')).toBeLessThan(matrix.indexOf('>smile</th>'));
    expect(matrix.match(/class="exp-matrix-cell"/g)).toHaveLength(4);
    expect(matrix.match(/exp-matrix-empty/g)).toHaveLength(2);
    expect(matrix.match(/class="rating-group"/g)).toHaveLength(4);
    expect(matrix.match(/exp-matrix-wait"/g)).toHaveLength(2);
    expect(body).toContain('id="experiment-compare-detail"');
  });

  it('has no base column in the matrix or compare, while the Base Generation row stays', async () => {
    const data = await setup([{ label: 'control' }, { label: 'smile', patches: [PATCH] }]);
    for (const run of data.runs) await finishRequest(run.request_id!, [11, 22]);
    const base = await createGeneration();
    await env.DB.prepare('UPDATE experiments SET base_generation_id = ? WHERE id = ?')
      .bind(base.generation.id, data.experiment.id)
      .run();
    const body = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    expect(body).not.toContain('>base</div>');
    expect(body).not.toContain('>base</th>');
    expect(body).not.toContain(`/compare?ids=${base.generation.short_id}`);
    expect(body).toContain('<td>Base Generation</td>');
  });

  it('keeps /compare working', async () => {

    const a = await createGeneration();
    const b = await createGeneration();
    const compare = await req(`/compare?ids=${a.generation.short_id},${b.generation.short_id}`);
    expect(compare.status).toBe(200);
    expect(await compare.text()).toContain('class="compare-table"');
  });

  it('shows the first nine Runs and notes the rest', async () => {
    const data = await setup([{ label: 'a' }, { label: 'b' }]);
    for (let i = 0; i < 8; i++) {
      await postJson(`/api/v1/experiments/${data.experiment.id}/runs`, { variables: { arm: `extra${i}` } });
    }
    const body = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    expect(body).toContain('ほか 1 件');
  });
});
