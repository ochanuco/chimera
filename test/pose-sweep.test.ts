import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRunRequestPayload } from '../src/lib/requests';
import type { ExperimentRow, ExperimentRunRow } from '../src/types';
import { clearRequests, createGeneration, getJson, mcpToolCall, postJson, req } from './helpers';

const RECIPE = 'yukari';
const PATCH = { target: 'prompt.positive.expression', op: 'replace', value: 'smile', reason: 'try smile' };

interface SweepResult {
  experiment: { id: string; short_id: string; url: string; compare_url: string; check_url: string };
  runs: { id: string; pose: string; seed: number; request_id: string | null; request_short_id: string | null }[];
  created: boolean;
}

async function publishCatalog(patches: unknown = {}): Promise<void> {
  const catalog = {
    schema_version: 3,
    recipes: [
      {
        name: RECIPE,
        poses: [
          { name: 'bust', prompt: 'bust up' },
          { name: 'coffee', prompt: 'holding cup' },
        ],
        costumes: [{ name: 'default', prompt: 'plain roomwear' }],
      },
    ],
    patches,
    git_commit: 'sweep01',
    git_branch: 'main',
    generated_at: '2026-10-20T00:00:00.000Z',
  };
  expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
  expect((await postJson('/api/v1/presets/import', { recipe_ref: 'production' })).status).toBe(200);
}

async function pinPose(pose: string): Promise<{ generationId: string; shortId: string; seed: number }> {
  const { generation } = await createGeneration({ requestOverrides: { recipe: RECIPE, parameters: { pose } } });
  expect((await postJson(`/api/v1/generations/${generation.id}/rating`, { rating: 'good' }, 'PUT')).status).toBe(200);
  const pin = await mcpToolCall<{ reference: { seed: number } }>('set_pose_reference', {
    recipe: RECIPE,
    pose,
    generation_id: generation.id,
    idempotency_key: crypto.randomUUID(),
  });
  expect(pin.isError).toBe(false);
  return { generationId: generation.id, shortId: generation.short_id, seed: pin.data!.reference.seed };
}

async function requestPayload(requestId: string) {
  const row = await env.DB.prepare('SELECT payload_json FROM requests WHERE id = ?').bind(requestId).first<{ payload_json: string }>();
  return JSON.parse(row!.payload_json) as {
    request: { count: number; seeds?: number[] };
    generation: { parameters: Record<string, unknown> };
    experiment: { overrides: Record<string, unknown> };
  };
}

function sweepInput(overrides: Record<string, unknown> = {}) {
  return { recipe: RECIPE, name: `sweep-${crypto.randomUUID().slice(0, 8)}`, patches: [PATCH], idempotency_key: crypto.randomUUID(), ...overrides };
}

describe('buildRunRequestPayload run-level pose and seed', () => {
  const experiment = (parameters: Record<string, unknown>): ExperimentRow =>
    ({ id: 'e1', name: 'exp', base_recipe: 'yukari', base_parameters_json: JSON.stringify(parameters), base_generation_id: null }) as ExperimentRow;
  const run = (overrides: Record<string, unknown>) =>
    ({ id: 'r1', run_index: 1, objective: null, overrides_json: JSON.stringify(overrides) }) as ExperimentRunRow;

  it('uses the Run pose and seed over the Experiment base, and keeps only the patches as worker overrides', () => {
    const payload = buildRunRequestPayload(
      experiment({ pose: 'base', costume: 'c', seeds: [1, 2] }),
      run({ patches: [PATCH], parameters: { pose: 'bust' }, seeds: [9] }),
    ) as { request: unknown; generation: { parameters: unknown }; experiment: { overrides: unknown } };
    expect(payload.request).toEqual({ instruction: 'run #1 of exp', count: 1, seeds: [9] });
    expect(payload.generation.parameters).toEqual({ pose: 'bust', costume: 'c' });
    expect(payload.experiment.overrides).toEqual({ patches: [PATCH] });
  });

  it('is unchanged for a Run without pose or seed', () => {
    const payload = buildRunRequestPayload(experiment({ pose: 'base', seeds: [1, 2] }), run({ patches: [PATCH] })) as {
      request: unknown;
      generation: { parameters: unknown };
      experiment: { overrides: unknown };
    };
    expect(payload.request).toEqual({ instruction: 'run #1 of exp', count: 2, seeds: [1, 2] });
    expect(payload.generation.parameters).toEqual({ pose: 'base' });
    expect(payload.experiment.overrides).toEqual({ patches: [PATCH] });
  });
});

describe('Run overrides validation', () => {
  it('rejects parameters other than pose and a seeds list that is not a single seed', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: `ov-${crypto.randomUUID()}`, base_recipe: RECIPE });
    const path = `/api/v1/experiments/${experiment.body.id}/runs`;
    expect((await postJson(path, { overrides: { parameters: { costume: 'x' } } })).status).toBe(400);
    expect((await postJson(path, { overrides: { seeds: [1, 2] } })).status).toBe(400);
    expect((await postJson(path, { overrides: { costume: 'x' } })).status).toBe(400);
    expect((await postJson(path, { overrides: { parameters: { pose: 'bust' }, seeds: [3] } })).status).toBe(201);
  });
});

describe('sweep_patch MCP tool', () => {
  beforeEach(async () => {
    await clearRequests();
    await env.DB.prepare('DELETE FROM preset_references').run();
    await publishCatalog();
  });

  it('defaults to every pinned pose, each Run at its pin seed with the same patches and no control', async () => {
    const bust = await pinPose('bust');
    const coffee = await pinPose('coffee');
    const call = await mcpToolCall<SweepResult>('sweep_patch', sweepInput());
    expect(call.isError).toBe(false);
    const data = call.data!;
    expect(data.created).toBe(true);
    expect(data.experiment.check_url).toBe(`https://chimera.test/check?sweep=${data.experiment.short_id}`);
    expect(data.runs.map((r) => [r.pose, r.seed])).toEqual([
      ['bust', bust.seed],
      ['coffee', coffee.seed],
    ]);

    for (const run of data.runs) {
      const payload = await requestPayload(run.request_id!);
      expect(payload.generation.parameters).toEqual({ pose: run.pose });
      expect(payload.request).toEqual({ instruction: run.pose, count: 1, seeds: [run.seed] });
      expect(payload.experiment.overrides).toEqual({ patches: [PATCH] });
    }
  });

  it('sweeps only the named poses and rejects unpinned ones, listing them', async () => {
    await pinPose('bust');
    const only = await mcpToolCall<SweepResult>('sweep_patch', sweepInput({ poses: ['bust'] }));
    expect(only.data!.runs.map((r) => r.pose)).toEqual(['bust']);

    const bad = await mcpToolCall('sweep_patch', sweepInput({ poses: ['bust', 'ghost', 'phantom'] }));
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad)).toContain('ghost, phantom');
  });

  async function dropPosePreset(pose: string): Promise<void> {
    await env.DB.prepare("DELETE FROM presets WHERE recipe = ? AND kind = 'pose' AND name = ?").bind(RECIPE, pose).run();
  }

  async function counts() {
    const row = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM experiments) AS experiments, (SELECT COUNT(*) FROM experiment_runs) AS runs, (SELECT COUNT(*) FROM requests) AS requests',
    ).first<Record<string, number>>();
    return row;
  }

  it('skips a pinned pose without a pose Preset by default and reports it', async () => {
    const bust = await pinPose('bust');
    await pinPose('coffee');
    await dropPosePreset('coffee');
    const call = await mcpToolCall<SweepResult & { skipped: { pose: string; reason: string }[] }>('sweep_patch', sweepInput());
    expect(call.isError).toBe(false);
    expect(call.data!.runs.map((r) => [r.pose, r.seed])).toEqual([['bust', bust.seed]]);
    expect(call.data!.skipped).toEqual([{ pose: 'coffee', reason: 'no pose Preset' }]);
  });

  it('rejects an explicit pose without a pose Preset and writes nothing', async () => {
    await pinPose('bust');
    await pinPose('coffee');
    await dropPosePreset('coffee');
    const before = await counts();
    const call = await mcpToolCall('sweep_patch', sweepInput({ poses: ['bust', 'coffee'] }));
    expect(call.isError).toBe(true);
    expect(JSON.stringify(call)).toContain('coffee');
    expect(await counts()).toEqual(before);
  });

  it('writes nothing when validation fails on a later check', async () => {
    await pinPose('bust');
    await pinPose('coffee');
    await publishCatalog({
      keys: ['target', 'op', 'value', 'old', 'reason'],
      text: { targets: ['prompt.positive'], part_target: 'prompt.positive.<part>', ops: { replace: ['old', 'value'] } },
      number: { 'render.cfg': { op: 'set', constraints: '> 0' } },
    });
    const before = await counts();
    const call = await mcpToolCall(
      'sweep_patch',
      sweepInput({ patches: [{ target: 'prompt.positive.expression', op: 'replace', value: 'smile', reason: 'old is missing' }] }),
    );
    expect(call.isError).toBe(true);
    expect(await counts()).toEqual(before);
  });

  it('fails when the recipe has no pinned pose', async () => {
    const call = await mcpToolCall('sweep_patch', sweepInput());
    expect(call.isError).toBe(true);
  });

  it('is idempotent by key and 409s when the key is reused for other poses', async () => {
    await pinPose('bust');
    await pinPose('coffee');
    const input = sweepInput();
    const first = await mcpToolCall<SweepResult>('sweep_patch', input);
    const second = await mcpToolCall<SweepResult>('sweep_patch', input);
    expect(second.data!.created).toBe(false);
    expect(second.data!.experiment.id).toBe(first.data!.experiment.id);
    expect(second.data!.runs.map((r) => r.id)).toEqual(first.data!.runs.map((r) => r.id));

    const other = await mcpToolCall('sweep_patch', { ...input, poses: ['coffee'] });
    expect(other.isError).toBe(true);
  });

  it('renders the experiment matrix with poses as columns', async () => {
    await pinPose('bust');
    await pinPose('coffee');
    const data = (await mcpToolCall<SweepResult>('sweep_patch', sweepInput())).data!;
    const html = await (await req(`/experiments/${data.experiment.short_id}`)).text();
    const heads = [...html.matchAll(/<th class="exp-matrix-seed">([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['bust', 'coffee']);
  });
});

describe('GET /check?sweep=', () => {
  beforeEach(async () => {
    await clearRequests();
    await env.DB.prepare('DELETE FROM preset_references').run();
    await publishCatalog();
  });

  interface CheckPose {
    pose: string;
    pin: { short_id: string } | null;
    request: { id: string; status: string } | null;
    result: { short_id: string } | null;
    excluded: boolean;
  }

  async function check(query: string) {
    const html = await (await req(`/check${query}`)).text();
    const initial = html.match(/data-initial="([^"]*)"/)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return { html, poses: (JSON.parse(initial) as { poses: CheckPose[] }).poses };
  }

  it('shows the sweep result next to the pin, marks other poses excluded and hides the adopt and render buttons', async () => {
    await pinPose('bust');
    await pinPose('coffee');
    const data = (await mcpToolCall<SweepResult>('sweep_patch', sweepInput({ poses: ['bust'] }))).data!;
    const bustRun = data.runs[0]!;

    const result = await createGeneration({ requestOverrides: { recipe: RECIPE, parameters: { pose: 'bust' } } });
    await env.DB.prepare("UPDATE requests SET status = 'done', result_json = ? WHERE id = ?")
      .bind(JSON.stringify({ generation_ids: [result.generation.id] }), bustRun.request_id)
      .run();

    const { html, poses } = await check(`?sweep=${data.experiment.short_id}&pose=bust`);
    const bust = poses.find((p) => p.pose === 'bust')!;
    expect(bust.request!.id).toBe(bustRun.request_id);
    expect(bust.result!.short_id).toBe(result.generation.short_id);
    expect(bust.excluded).toBe(false);
    expect(poses.find((p) => p.pose === 'coffee')).toMatchObject({ excluded: true, request: null, result: null });

    expect(html).toContain('data-sc-sweep');
    expect(html).toContain(`/experiments/${data.experiment.short_id}`);
    expect(html).not.toContain('pin 済みを全部描き直す');
    expect(html).not.toContain('data-sc-render-pose');
    expect(html).toMatch(/data-scv-adopt="true" hidden/);
    expect(html).toMatch(/class="sc-viewer wb"[^>]*data-sc-viewer/);
    expect(html).not.toMatch(/data-sc-viewer="true" hidden/);
  });

  it('keeps the plain page offering the adopt path, and 404s for an unknown or non-sweep experiment', async () => {
    await pinPose('bust');
    const plain = await check('');
    expect(plain.html).toContain('pin 済みを全部描き直す');
    expect(plain.poses.every((p) => !p.excluded)).toBe(true);

    expect((await req('/check?sweep=zzzzzz')).status).toBe(404);
    const experiment = await postJson<{ short_id: string }>('/api/v1/experiments', { name: `plain-${crypto.randomUUID()}`, base_recipe: RECIPE });
    expect((await req(`/check?sweep=${experiment.body.short_id}`)).status).toBe(404);
  });
});
