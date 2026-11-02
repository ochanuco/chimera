import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createJob, createRequest, getJson, ingestGeneration, mcpToolCall, postJson } from './helpers';
import { expireTemporaryRecords, retentionCutoff, TEMPORARY_RECORD_RETENTION_DAYS } from '../src/lib/temporary-records';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE = new Date(Date.now() - (TEMPORARY_RECORD_RETENTION_DAYS + 1) * DAY_MS).toISOString();
const RECENT = new Date(Date.now() - (TEMPORARY_RECORD_RETENTION_DAYS - 1) * DAY_MS).toISOString();

interface Judgment {
  id: string;
  experiment_id: string | null;
  baseline_run_id: string | null;
  arm_run_id: string | null;
  left_generation_id: string;
  right_generation_id: string;
  baseline_generation_id: string;
  verdict: string;
  winner: string;
}

async function requestWithGeneration(seed: number, runId: string | null) {
  const request = await createRequest({ run_id: runId });
  const job = await createJob(request.body.id, { seed });
  const ingest = await ingestGeneration(job.body.id, {
    seed,
    original_filename: `out_${seed}_${crypto.randomUUID().slice(0, 8)}.png`,
    comfy_output_index: 0,
  });
  return { requestId: request.body.id, generationId: ingest.body.id };
}

/** baseline / arm の 2 Run と、arm 左・baseline 右で arm を選んだ judgment を 1 件持つ Experiment。 */
async function judgedExperiment() {
  const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: `expiry-${crypto.randomUUID().slice(0, 8)}` });
  const baselineRun = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
  const armRun = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
  const baseline = await requestWithGeneration(7, baselineRun.body.id);
  const arm = await requestWithGeneration(7, armRun.body.id);
  const judgment = await postJson<Judgment>(`/api/v1/experiments/${experiment.body.id}/judgments`, {
    baseline_run_id: baselineRun.body.id,
    arm_run_id: armRun.body.id,
    seed: 7,
    left_generation_id: arm.generationId,
    right_generation_id: baseline.generationId,
    verdict: 'left',
  });
  expect(judgment.status).toBe(201);
  return {
    experimentId: experiment.body.id,
    runIds: [baselineRun.body.id, armRun.body.id],
    baseline,
    arm,
    judgmentId: judgment.body.id,
  };
}

async function backdateExperiment(experimentId: string, at: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE experiments SET updated_at = ? WHERE id = ?').bind(at, experimentId),
    env.DB.prepare('UPDATE experiment_runs SET updated_at = ? WHERE experiment_id = ?').bind(at, experimentId),
  ]);
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

async function recordObservation(): Promise<string> {
  const res = await mcpToolCall<{ id: string }>('record_observation', {
    character: `expiry-${crypto.randomUUID().slice(0, 8)}`,
    pose: 'stand',
    parameter: 'smug',
    value: '1.4',
    outcome: 'accepted',
    reason: 'expiry test',
    idempotency_key: crypto.randomUUID(),
  });
  return res.data!.id;
}

describe('retention cutoff', () => {
  it('is TEMPORARY_RECORD_RETENTION_DAYS before now', () => {
    const now = Date.parse('2026-11-15T00:00:00.000Z');
    expect(retentionCutoff(now)).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('expireTemporaryRecords: Experiment / ExperimentRun', () => {
  it('deletes a stale Experiment and its Runs, nulls the references and keeps Generations and the judgment', async () => {
    const ctx = await judgedExperiment();
    await backdateExperiment(ctx.experimentId, STALE);

    const result = await expireTemporaryRecords(env.DB, Date.now());
    expect(result.experiments).toBeGreaterThanOrEqual(1);

    expect(await count('SELECT COUNT(*) AS n FROM experiments WHERE id = ?', ctx.experimentId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM experiment_runs WHERE experiment_id = ?', ctx.experimentId)).toBe(0);

    for (const side of [ctx.baseline, ctx.arm]) {
      const request = await env.DB.prepare('SELECT run_id FROM requests WHERE id = ?').bind(side.requestId).first<{ run_id: string | null }>();
      expect(request).not.toBeNull();
      expect(request!.run_id).toBeNull();
      const generation = await getJson<{ id: string }>(`/api/v1/generations/${side.generationId}`);
      expect(generation.status).toBe(200);
    }

    const judgment = await env.DB.prepare('SELECT * FROM pairwise_judgments WHERE id = ?').bind(ctx.judgmentId).first<Judgment>();
    expect(judgment).toMatchObject({
      experiment_id: null,
      baseline_run_id: null,
      arm_run_id: null,
      left_generation_id: ctx.arm.generationId,
      right_generation_id: ctx.baseline.generationId,
      baseline_generation_id: ctx.baseline.generationId,
      verdict: 'left',
    });
  });

  it('keeps an Experiment touched within the retention period', async () => {
    const ctx = await judgedExperiment();
    await backdateExperiment(ctx.experimentId, RECENT);

    await expireTemporaryRecords(env.DB, Date.now());

    expect(await count('SELECT COUNT(*) AS n FROM experiments WHERE id = ?', ctx.experimentId)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM experiment_runs WHERE experiment_id = ?', ctx.experimentId)).toBe(2);
    const judgments = await getJson<{ items: Judgment[] }>(`/api/v1/experiments/${ctx.experimentId}/judgments`);
    expect(judgments.status).toBe(200);
    expect(judgments.body.items.map((j) => j.winner)).toEqual(['arm']);
  });

  it('keeps a stale Experiment whose Run was updated within the retention period', async () => {
    const ctx = await judgedExperiment();
    await backdateExperiment(ctx.experimentId, STALE);
    await env.DB.prepare('UPDATE experiment_runs SET updated_at = ? WHERE id = ?').bind(RECENT, ctx.runIds[1]).run();

    await expireTemporaryRecords(env.DB, Date.now());

    expect(await count('SELECT COUNT(*) AS n FROM experiments WHERE id = ?', ctx.experimentId)).toBe(1);
  });

  it('nulls a parent_run_id that points into the deleted Experiment from another one', async () => {
    const stale = await judgedExperiment();
    await backdateExperiment(stale.experimentId, STALE);
    const other = await postJson<{ id: string }>('/api/v1/experiments', { name: `expiry-${crypto.randomUUID().slice(0, 8)}` });
    const child = await postJson<{ id: string }>(`/api/v1/experiments/${other.body.id}/runs`, {});
    await env.DB.prepare('UPDATE experiment_runs SET parent_run_id = ? WHERE id = ?').bind(stale.runIds[0], child.body.id).run();

    await expireTemporaryRecords(env.DB, Date.now());

    const row = await env.DB.prepare('SELECT parent_run_id FROM experiment_runs WHERE id = ?').bind(child.body.id).first<{ parent_run_id: string | null }>();
    expect(row).toEqual({ parent_run_id: null });
  });
});

describe('expireTemporaryRecords: Observation', () => {
  it('deletes only Observations created before the cutoff and nulls supersedes_id pointing at them', async () => {
    const stale = await recordObservation();
    const recent = await recordObservation();
    const superseding = await recordObservation();
    await env.DB.batch([
      env.DB.prepare('UPDATE observations SET created_at = ? WHERE id = ?').bind(STALE, stale),
      env.DB.prepare('UPDATE observations SET created_at = ? WHERE id = ?').bind(RECENT, recent),
      env.DB.prepare('UPDATE observations SET supersedes_id = ? WHERE id = ?').bind(stale, superseding),
    ]);

    const result = await expireTemporaryRecords(env.DB, Date.now());
    expect(result.observations).toBeGreaterThanOrEqual(1);

    expect(await count('SELECT COUNT(*) AS n FROM observations WHERE id = ?', stale)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM observations WHERE id = ?', recent)).toBe(1);
    const row = await env.DB.prepare('SELECT supersedes_id FROM observations WHERE id = ?').bind(superseding).first<{ supersedes_id: string | null }>();
    expect(row).toEqual({ supersedes_id: null });
  });
});
