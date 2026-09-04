import { describe, expect, it } from 'vitest';
import { createBatch, createJob, getJson, ingestGeneration, postJson, setJobGraph } from './helpers';

interface Experiment {
  id: string;
  short_id: string;
}

interface Run {
  id: string;
  run_index: number;
}

interface Judgment {
  id: string;
  experiment_id: string;
  baseline_run_id: string;
  arm_run_id: string;
  seed: number;
  left_generation_id: string;
  right_generation_id: string;
  verdict: string;
  winner: string;
  judged_at: string;
}

interface SummaryBody {
  pairs: {
    baseline_run_id: string;
    baseline_run_index: number;
    arm_run_id: string;
    arm_run_index: number;
    win: number;
    loss: number;
    tie: number;
    total: number;
  }[];
  runs: {
    run_id: string;
    run_index: number;
    batch_id: string | null;
    generation_count: number;
    rating: { good: number; neutral: number; bad: number; unrated: number };
  }[];
}

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function createExperiment(overrides: Record<string, unknown> = {}) {
  return postJson<Experiment>('/api/v1/experiments', { name: uniqueName('judg-exp'), ...overrides });
}

async function createRun(experimentId: string, overrides: Record<string, unknown> = {}) {
  return postJson<Run>(`/api/v1/experiments/${experimentId}/runs`, overrides);
}

/** A batch with one ingested Generation per seed, each in its own job (so comfy_output_index=0 never collides). */
async function createBatchWithSeeds(seeds: number[]) {
  const batch = await createBatch();
  const generations: Record<number, { id: string; short_id: string }> = {};
  for (const seed of seeds) {
    const job = await createJob(batch.body.id, { seed });
    const ingest = await ingestGeneration(job.body.id, {
      seed,
      original_filename: `out_${seed}_${crypto.randomUUID().slice(0, 8)}.png`,
      comfy_output_index: 0,
    });
    generations[seed] = { id: ingest.body.id, short_id: ingest.body.short_id };
  }
  return { batch: batch.body, generations };
}

/** baseline / arm run, each attached to its own batch with Generations at seed 11 and 22. */
async function setupPair(experimentOverrides: Record<string, unknown> = {}) {
  const experiment = await createExperiment(experimentOverrides);
  const baselineRun = await createRun(experiment.body.id);
  const armRun = await createRun(experiment.body.id);
  const { batch: baselineBatch, generations: baselineGens } = await createBatchWithSeeds([11, 22]);
  const { batch: armBatch, generations: armGens } = await createBatchWithSeeds([11, 22]);
  await postJson(`/api/v1/experiment-runs/${baselineRun.body.id}`, { batch_id: baselineBatch.id }, 'PATCH');
  await postJson(`/api/v1/experiment-runs/${armRun.body.id}`, { batch_id: armBatch.id }, 'PATCH');
  return {
    experiment: experiment.body,
    baselineRun: baselineRun.body,
    armRun: armRun.body,
    baselineBatch,
    armBatch,
    baselineGens,
    armGens,
  };
}

describe('Create PairwiseJudgment', () => {
  it('201s with winner=arm when the chosen side is the arm generation (baseline left, arm right)', async () => {
    const ctx = await setupPair();
    const res = await postJson<Judgment>(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'right',
    });
    expect(res.status).toBe(201);
    expect(res.body.winner).toBe('arm');
    expect(res.body.verdict).toBe('right');
  });

  it('201s with winner=baseline when the chosen side is the baseline generation', async () => {
    const ctx = await setupPair();
    const res = await postJson<Judgment>(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(201);
    expect(res.body.winner).toBe('baseline');
  });

  it('201s with winner=tie for a tie verdict', async () => {
    const ctx = await setupPair();
    const res = await postJson<Judgment>(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'tie',
    });
    expect(res.status).toBe(201);
    expect(res.body.winner).toBe('tie');
  });

  it('resolves the winner correctly in the opposite orientation (arm left, baseline right)', async () => {
    const ctx = await setupPair();
    const res = await postJson<Judgment>(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 22,
      left_generation_id: ctx.armGens[22]!.id,
      right_generation_id: ctx.baselineGens[22]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(201);
    expect(res.body.winner).toBe('arm');
  });
});

describe('Create PairwiseJudgment validation', () => {
  it('400s when baseline_run_id === arm_run_id', async () => {
    const ctx = await setupPair();
    const res = await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.baselineRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(400);
  });

  it('400s when arm_run_id belongs to a different experiment', async () => {
    const ctx = await setupPair();
    const other = await createExperiment();
    const otherRun = await createRun(other.body.id);

    const res = await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: otherRun.body.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(400);
  });

  it('409s when a run has no batch attached', async () => {
    const experiment = await createExperiment();
    const baselineRun = await createRun(experiment.body.id);
    const armRun = await createRun(experiment.body.id); // no batch attached
    const { batch: baselineBatch, generations: baselineGens } = await createBatchWithSeeds([11]);
    await postJson(`/api/v1/experiment-runs/${baselineRun.body.id}`, { batch_id: baselineBatch.id }, 'PATCH');

    const res = await postJson(`/api/v1/experiments/${experiment.body.id}/judgments`, {
      baseline_run_id: baselineRun.body.id,
      arm_run_id: armRun.body.id,
      seed: 11,
      left_generation_id: baselineGens[11]!.id,
      right_generation_id: baselineGens[11]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(409);
  });

  it('400s when baseline and arm runs share the same batch', async () => {
    const experiment = await createExperiment();
    const baselineRun = await createRun(experiment.body.id);
    const armRun = await createRun(experiment.body.id);
    const { batch, generations } = await createBatchWithSeeds([11]);
    await postJson(`/api/v1/experiment-runs/${baselineRun.body.id}`, { batch_id: batch.id }, 'PATCH');
    await postJson(`/api/v1/experiment-runs/${armRun.body.id}`, { batch_id: batch.id }, 'PATCH');

    const res = await postJson(`/api/v1/experiments/${experiment.body.id}/judgments`, {
      baseline_run_id: baselineRun.body.id,
      arm_run_id: armRun.body.id,
      seed: 11,
      left_generation_id: generations[11]!.id,
      right_generation_id: generations[11]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(400);
  });

  it('400s when both generations come from the same batch', async () => {
    const ctx = await setupPair();
    const res = await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.baselineGens[22]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(400);
  });

  it('400s when seed does not match the generations', async () => {
    const ctx = await setupPair();
    const res = await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 22,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'left',
    });
    expect(res.status).toBe(400);
  });

  it('409s on a second judgment for the same (baseline, arm, seed)', async () => {
    const ctx = await setupPair();
    const body = {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'left',
    };
    const first = await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, body);
    expect(first.status).toBe(201);
    const second = await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, body);
    expect(second.status).toBe(409);
  });
});

describe('List / Summary PairwiseJudgment', () => {
  it('GET list returns items with winner', async () => {
    const ctx = await setupPair();
    await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'right',
    });

    const list = await getJson<{ items: Judgment[] }>(`/api/v1/experiments/${ctx.experiment.id}/judgments`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]!.winner).toBe('arm');
  });

  it('GET summary returns pairs with win/loss/tie/total and per-run rating counts, including a run without batch', async () => {
    const ctx = await setupPair();
    const extraRun = await createRun(ctx.experiment.id);

    await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'right', // arm wins
    });
    await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 22,
      left_generation_id: ctx.baselineGens[22]!.id,
      right_generation_id: ctx.armGens[22]!.id,
      verdict: 'left', // baseline wins
    });

    await postJson(`/api/v1/generations/${ctx.baselineGens[11]!.id}/rating`, { rating: 'good' }, 'PUT');
    await postJson(`/api/v1/generations/${ctx.armGens[11]!.id}/rating`, { rating: 'bad' }, 'PUT');
    // baselineGens[22] / armGens[22] stay unrated

    const summary = await getJson<SummaryBody>(`/api/v1/experiments/${ctx.experiment.id}/judgments/summary`);
    expect(summary.status).toBe(200);

    const pair = summary.body.pairs.find(
      (p) => p.baseline_run_id === ctx.baselineRun.id && p.arm_run_id === ctx.armRun.id,
    );
    expect(pair).toMatchObject({
      baseline_run_index: ctx.baselineRun.run_index,
      arm_run_index: ctx.armRun.run_index,
      win: 1,
      loss: 1,
      tie: 0,
      total: 2,
    });

    const baselineRunSummary = summary.body.runs.find((r) => r.run_id === ctx.baselineRun.id);
    expect(baselineRunSummary).toMatchObject({
      batch_id: ctx.baselineBatch.id,
      generation_count: 2,
      rating: { good: 1, neutral: 0, bad: 0, unrated: 1 },
    });

    const armRunSummary = summary.body.runs.find((r) => r.run_id === ctx.armRun.id);
    expect(armRunSummary).toMatchObject({
      batch_id: ctx.armBatch.id,
      generation_count: 2,
      rating: { good: 0, neutral: 0, bad: 1, unrated: 1 },
    });

    const extraRunSummary = summary.body.runs.find((r) => r.run_id === extraRun.body.id);
    expect(extraRunSummary).toMatchObject({
      batch_id: null,
      generation_count: 0,
      rating: { good: 0, neutral: 0, bad: 0, unrated: 0 },
    });
  });

  it('accepts an experiment short_id in the summary path', async () => {
    const ctx = await setupPair();
    const res = await getJson<SummaryBody>(`/api/v1/experiments/${ctx.experiment.short_id}/judgments/summary`);
    expect(res.status).toBe(200);
  });
});

interface JudgmentRevealSide {
  run_id: string;
  run_index: number;
  role: string;
}

interface RenderDiffEntry {
  column: string;
  baseline: string | null;
  arm: string | null;
  delta?: string;
}

interface JudgmentWithReveal extends Judgment {
  reveal: { left: JudgmentRevealSide; right: JudgmentRevealSide; render_diff: RenderDiffEntry[] };
}

interface SummaryBodyWithRenderDiff extends SummaryBody {
  pairs: (SummaryBody['pairs'][number] & { render_diff: RenderDiffEntry[] })[];
}

describe('PairwiseJudgment render_facts reveal', () => {
  it('POST response carries reveal.left/right (role matching the generation orientation) and a render_diff covering checkpoint + variables, matching the same-shaped summary.pairs[].render_diff', async () => {
    const ctx = await setupPair();

    const [baselineJobs, armJobs] = await Promise.all([
      getJson<{ jobs: { id: string; index: number }[] }>(`/api/v1/batches/${ctx.baselineBatch.id}`),
      getJson<{ jobs: { id: string; index: number }[] }>(`/api/v1/batches/${ctx.armBatch.id}`),
    ]);
    const baselineFirstJob = baselineJobs.body.jobs.find((j) => j.index === 0)!;
    const armFirstJob = armJobs.body.jobs.find((j) => j.index === 0)!;

    await setJobGraph(baselineFirstJob.id, { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } } });
    await setJobGraph(armFirstJob.id, { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'arm.safetensors' } } });
    await postJson(`/api/v1/experiment-runs/${ctx.armRun.id}`, { variables: { prompt_variant: 'v2' } }, 'PATCH');

    // left = baseline generation, right = arm generation.
    const res = await postJson<JudgmentWithReveal>(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'right',
    });

    expect(res.status).toBe(201);
    expect(res.body.reveal.left).toEqual({ run_id: ctx.baselineRun.id, run_index: ctx.baselineRun.run_index, role: 'baseline' });
    expect(res.body.reveal.right).toEqual({ run_id: ctx.armRun.id, run_index: ctx.armRun.run_index, role: 'arm' });

    expect(res.body.reveal.render_diff).toContainEqual({ column: 'checkpoint', baseline: 'base.safetensors', arm: 'arm.safetensors' });
    expect(res.body.reveal.render_diff).toContainEqual({ column: 'variables.prompt_variant', baseline: null, arm: 'v2' });

    const summary = await getJson<SummaryBodyWithRenderDiff>(`/api/v1/experiments/${ctx.experiment.id}/judgments/summary`);
    const pair = summary.body.pairs.find((p) => p.baseline_run_id === ctx.baselineRun.id && p.arm_run_id === ctx.armRun.id);
    expect(pair?.render_diff).toEqual(res.body.reveal.render_diff);
  });

  it('render_diff carries a positive entry with a delta starting with "+" when the arm run added a prompt token', async () => {
    const ctx = await setupPair();

    const [baselineJobs, armJobs] = await Promise.all([
      getJson<{ jobs: { id: string; index: number }[] }>(`/api/v1/batches/${ctx.baselineBatch.id}`),
      getJson<{ jobs: { id: string; index: number }[] }>(`/api/v1/batches/${ctx.armBatch.id}`),
    ]);
    const baselineFirstJob = baselineJobs.body.jobs.find((j) => j.index === 0)!;
    const armFirstJob = armJobs.body.jobs.find((j) => j.index === 0)!;

    const graphFor = (text: string) => ({
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['4', 1] } },
    });
    await setJobGraph(baselineFirstJob.id, graphFor('1girl, outdoors'));
    await setJobGraph(armFirstJob.id, graphFor('1girl, outdoors, smiling'));

    const res = await postJson<JudgmentWithReveal>(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'right',
    });

    expect(res.status).toBe(201);
    const positiveEntry = res.body.reveal.render_diff.find((d) => d.column === 'positive');
    expect(positiveEntry).toBeDefined();
    expect(positiveEntry?.baseline).toBe('1girl, outdoors');
    expect(positiveEntry?.arm).toBe('1girl, outdoors, smiling');
    expect(positiveEntry?.delta).toMatch(/^\+/);
  });
});
