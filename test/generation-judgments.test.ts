import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createJob, createRequest, getJson, ingestGeneration, mcpToolCall, postJson, req } from './helpers';
import { expireTemporaryRecords } from '../src/lib/temporary-records';

interface JudgmentView {
  id: string;
  verdict: string;
  winner: 'this' | 'other' | 'tie';
  other_generation: { id: string; short_id: string; rating: string | null };
  this_was_baseline: boolean;
  seed: number;
  judged_at: string;
  experiment: string | null;
}

interface Gen {
  id: string;
  short_id: string;
}

async function generationIn(runId: string | null, seed: number): Promise<Gen> {
  const request = await createRequest({ run_id: runId });
  const job = await createJob(request.body.id, { seed });
  const ingest = await ingestGeneration(job.body.id, {
    seed,
    original_filename: `out_${seed}_${crypto.randomUUID().slice(0, 8)}.png`,
    comfy_output_index: 0,
  });
  return { id: ingest.body.id, short_id: ingest.body.short_id };
}

/** baseline が右・arm が左で、左を選んだ判定 (勝者は arm) を 1 件持つ Experiment。 */
async function judged() {
  const experiment = await postJson<{ id: string; short_id: string }>('/api/v1/experiments', { name: `gj-${crypto.randomUUID().slice(0, 8)}` });
  const baselineRun = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
  const armRun = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
  const baseline = await generationIn(baselineRun.body.id, 5);
  const arm = await generationIn(armRun.body.id, 5);
  const res = await postJson(`/api/v1/experiments/${experiment.body.id}/judgments`, {
    baseline_run_id: baselineRun.body.id,
    arm_run_id: armRun.body.id,
    seed: 5,
    left_generation_id: arm.id,
    right_generation_id: baseline.id,
    verdict: 'left',
  });
  expect(res.status).toBe(201);
  return { experiment: experiment.body, baseline, arm };
}

async function detail(id: string) {
  return (await getJson<{ judgments: JudgmentView[] }>(`/api/v1/generations/${id}`)).body.judgments;
}

describe('Generation judgments', () => {
  it('lists a judgment for the generation on the left and on the right', async () => {
    const ctx = await judged();

    expect(await detail(ctx.arm.id)).toMatchObject([
      {
        verdict: 'left',
        winner: 'this',
        other_generation: { id: ctx.baseline.id, short_id: ctx.baseline.short_id, rating: null },
        this_was_baseline: false,
        seed: 5,
        experiment: ctx.experiment.short_id,
      },
    ]);
    expect(await detail(ctx.baseline.id)).toMatchObject([
      { winner: 'other', other_generation: { id: ctx.arm.id }, this_was_baseline: true },
    ]);
  });

  it('keeps the judgments after the Experiment is deleted, with experiment null', async () => {
    const ctx = await judged();
    const stale = '2000-01-01T00:00:00.000Z';
    await env.DB.batch([
      env.DB.prepare('UPDATE experiments SET updated_at = ? WHERE id = ?').bind(stale, ctx.experiment.id),
      env.DB.prepare('UPDATE experiment_runs SET updated_at = ? WHERE experiment_id = ?').bind(stale, ctx.experiment.id),
    ]);
    await expireTemporaryRecords(env.DB, Date.now());

    const [onArm] = await detail(ctx.arm.id);
    expect(onArm).toMatchObject({ winner: 'this', experiment: null });
    const [onBaseline] = await detail(ctx.baseline.id);
    expect(onBaseline).toMatchObject({ winner: 'other', this_was_baseline: true, experiment: null });
  });

  it('get_generation returns the same judgments', async () => {
    const ctx = await judged();
    const tool = await mcpToolCall<{ judgments: JudgmentView[] }>('get_generation', { generation_id: ctx.arm.id });
    expect(tool.isError).toBe(false);
    expect(tool.data?.judgments).toEqual(await detail(ctx.arm.id));
  });

  it('shows the judgment section on /g/<short_id> linking to the other generation', async () => {
    const ctx = await judged();
    const html = await (await req(`/g/${ctx.arm.short_id}`)).text();
    expect(html).toContain('判定 (1)');
    expect(html).toContain(`href="/g/${ctx.baseline.short_id}"`);
  });

  it('has an empty list and no section for a generation without judgments', async () => {
    const lone = await generationIn(null, 9);
    expect(await detail(lone.id)).toEqual([]);
    const html = await (await req(`/g/${lone.short_id}`)).text();
    expect(html).not.toContain('判定 (');
  });
});
