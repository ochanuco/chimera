// PairwiseJudgment のクエリと作成ロジック。左右の向き (left/right) は表示時に
// ランダムに割り当てられたものなので、baseline / arm のどちらが勝ったかは
// verdict と各 Generation の batch_id (baseline_run / arm_run のどちらの
// batch から出たか) を突き合わせて導く。

import { chunk, D1_MAX_BOUND_PARAMS, nowIso } from './db';
import { badRequest, conflict } from './errors';
import { getRunOr404, listRuns, resolveGenerationOr404, touchExperiment } from './experiments';
import { uuidv7 } from './uuidv7';
import { parseJsonObjectOrNull } from './overrides';
import { diffFactSummaries, resolveBatchRenderFacts, summarizeRenderFacts, type FactDiffEntry } from './render-facts';
import type { ExperimentRow, ExperimentRunRow, JudgmentVerdict, JudgmentWinner, PairwiseJudgmentRow } from '../types';

/**
 * Run ごとの render_facts サマリに variables を `variables.<key>` として合流させる。
 * A/B の reveal と judgments/summary の render_diff は同じこのマップから作る
 * (docs/api.md 参照)。
 */
export async function runFactSummary(
  db: D1Database,
  runs: ExperimentRunRow[],
): Promise<Map<string, Record<string, string | null>>> {
  const batchIds = runs.map((r) => r.batch_id).filter((id): id is string => id !== null);
  const factsByBatch = await resolveBatchRenderFacts(db, batchIds);

  const map = new Map<string, Record<string, string | null>>();
  for (const run of runs) {
    const facts = run.batch_id ? factsByBatch.get(run.batch_id) ?? null : null;
    const summary: Record<string, string | null> = summarizeRenderFacts(facts);
    summary.positive = facts?.samplers[0]?.prompt.positive ?? null;
    summary.negative = facts?.samplers[0]?.prompt.negative ?? null;
    const variables = parseJsonObjectOrNull(run.variables_json);
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        summary[`variables.${key}`] = String(value);
      }
    }
    map.set(run.id, summary);
  }
  return map;
}

export interface CreateJudgmentInput {
  baseline_run_id: string;
  arm_run_id: string;
  seed: number;
  left_generation_id: string;
  right_generation_id: string;
  verdict: JudgmentVerdict;
}

/** `leftIsArm` = 左側の Generation が arm run の batch から出たものか。 */
function computeWinner(verdict: JudgmentVerdict, leftIsArm: boolean): JudgmentWinner {
  if (verdict === 'tie') return 'tie';
  const chosenIsArm = verdict === 'left' ? leftIsArm : !leftIsArm;
  return chosenIsArm ? 'arm' : 'baseline';
}

export interface JudgmentRevealSide {
  run_id: string;
  run_index: number;
  role: 'baseline' | 'arm';
}

export interface JudgmentReveal {
  left: JudgmentRevealSide;
  right: JudgmentRevealSide;
  render_diff: FactDiffEntry[];
}

export async function createJudgment(
  db: D1Database,
  experiment: ExperimentRow,
  body: CreateJudgmentInput,
): Promise<{ row: PairwiseJudgmentRow; winner: JudgmentWinner; reveal: JudgmentReveal }> {
  if (body.baseline_run_id === body.arm_run_id) {
    throw badRequest('baseline_run_id and arm_run_id must be different runs');
  }

  const [baseline, arm] = await Promise.all([
    getRunOr404(db, body.baseline_run_id),
    getRunOr404(db, body.arm_run_id),
  ]);
  if (baseline.experiment_id !== experiment.id || arm.experiment_id !== experiment.id) {
    throw badRequest('baseline_run_id / arm_run_id belongs to a different experiment');
  }
  if (!baseline.batch_id || !arm.batch_id) {
    throw conflict('run has no batch attached');
  }
  // 同じ Batch を指す 2 つの Run では、どちらの Generation も両方の Run のものになり勝者を導けない。
  if (baseline.batch_id === arm.batch_id) {
    throw badRequest('baseline and arm runs share the same batch');
  }

  const [leftGeneration, rightGeneration] = await Promise.all([
    resolveGenerationOr404(db, body.left_generation_id),
    resolveGenerationOr404(db, body.right_generation_id),
  ]);

  const leftIsBaseline = leftGeneration.batch_id === baseline.batch_id;
  const leftIsArm = leftGeneration.batch_id === arm.batch_id;
  const rightIsBaseline = rightGeneration.batch_id === baseline.batch_id;
  const rightIsArm = rightGeneration.batch_id === arm.batch_id;
  const validOrientation = (leftIsBaseline && rightIsArm) || (leftIsArm && rightIsBaseline);
  if (!validOrientation) {
    throw badRequest(
      'left/right generations must be one from the baseline run batch and one from the arm run batch',
    );
  }

  if (leftGeneration.seed !== body.seed || rightGeneration.seed !== body.seed) {
    throw badRequest('generation seed does not match');
  }

  const now = nowIso();
  const id = uuidv7();
  try {
    await db
      .prepare(
        `INSERT INTO pairwise_judgments
           (id, experiment_id, baseline_run_id, arm_run_id, seed, left_generation_id, right_generation_id, verdict, judged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        experiment.id,
        baseline.id,
        arm.id,
        body.seed,
        leftGeneration.id,
        rightGeneration.id,
        body.verdict,
        now,
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw conflict('this seed is already judged for the pair');
    }
    throw err;
  }
  await touchExperiment(db, experiment.id, now);

  const row = await db
    .prepare('SELECT * FROM pairwise_judgments WHERE id = ?')
    .bind(id)
    .first<PairwiseJudgmentRow>();

  const factSummaries = await runFactSummary(db, [baseline, arm]);
  const renderDiff = diffFactSummaries(factSummaries.get(baseline.id) ?? {}, factSummaries.get(arm.id) ?? {});
  const reveal: JudgmentReveal = {
    left: { run_id: leftIsBaseline ? baseline.id : arm.id, run_index: leftIsBaseline ? baseline.run_index : arm.run_index, role: leftIsBaseline ? 'baseline' : 'arm' },
    right: { run_id: rightIsBaseline ? baseline.id : arm.id, run_index: rightIsBaseline ? baseline.run_index : arm.run_index, role: rightIsBaseline ? 'baseline' : 'arm' },
    render_diff: renderDiff,
  };

  return { row: row!, winner: computeWinner(body.verdict, leftIsArm), reveal };
}

interface JudgmentListRow extends PairwiseJudgmentRow {
  left_is_arm: number;
}

export async function listJudgments(
  db: D1Database,
  experimentId: string,
): Promise<{ row: PairwiseJudgmentRow; winner: JudgmentWinner }[]> {
  const { results } = await db
    .prepare(
      `SELECT j.*, (g.batch_id = a.batch_id) AS left_is_arm
       FROM pairwise_judgments j
       JOIN experiment_runs a ON a.id = j.arm_run_id
       JOIN generations g ON g.id = j.left_generation_id
       WHERE j.experiment_id = ?
       ORDER BY j.judged_at ASC`,
    )
    .bind(experimentId)
    .all<JudgmentListRow>();
  return (results ?? []).map((row) => ({ row, winner: computeWinner(row.verdict, row.left_is_arm === 1) }));
}

export async function judgedSeedsForPair(
  db: D1Database,
  baselineRunId: string,
  armRunId: string,
): Promise<Set<number>> {
  const { results } = await db
    .prepare('SELECT seed FROM pairwise_judgments WHERE baseline_run_id = ? AND arm_run_id = ?')
    .bind(baselineRunId, armRunId)
    .all<{ seed: number }>();
  return new Set((results ?? []).map((r) => r.seed));
}

export interface JudgmentPairSummary {
  baseline_run_id: string;
  baseline_run_index: number;
  arm_run_id: string;
  arm_run_index: number;
  win: number;
  loss: number;
  tie: number;
  total: number;
  render_diff: FactDiffEntry[];
}

export interface JudgmentRunSummary {
  run_id: string;
  run_index: number;
  batch_id: string | null;
  generation_count: number;
  rating: { good: number; neutral: number; bad: number; unrated: number };
}

/** Experiment 全体の A/B 集計。runs は Experiment の全 Run (batch 未 attach でも 0 件で含む)。 */
export async function judgmentSummary(
  db: D1Database,
  experiment: ExperimentRow,
): Promise<{ pairs: JudgmentPairSummary[]; runs: JudgmentRunSummary[] }> {
  const [pairsResult, runs] = await Promise.all([
    db
      .prepare(
        `SELECT j.baseline_run_id, b.run_index AS baseline_run_index, j.arm_run_id, a.run_index AS arm_run_index,
           COUNT(*) AS total,
           SUM(CASE
                 WHEN j.verdict = 'tie' THEN 0
                 WHEN j.verdict = 'left' AND g.batch_id = a.batch_id THEN 1
                 WHEN j.verdict = 'right' AND g.batch_id != a.batch_id THEN 1
                 ELSE 0
               END) AS win,
           SUM(CASE
                 WHEN j.verdict = 'tie' THEN 0
                 WHEN j.verdict = 'left' AND g.batch_id != a.batch_id THEN 1
                 WHEN j.verdict = 'right' AND g.batch_id = a.batch_id THEN 1
                 ELSE 0
               END) AS loss,
           SUM(CASE WHEN j.verdict = 'tie' THEN 1 ELSE 0 END) AS tie
         FROM pairwise_judgments j
         JOIN experiment_runs b ON b.id = j.baseline_run_id
         JOIN experiment_runs a ON a.id = j.arm_run_id
         JOIN generations g ON g.id = j.left_generation_id
         WHERE j.experiment_id = ?
         GROUP BY j.baseline_run_id, j.arm_run_id, b.run_index, a.run_index
         ORDER BY b.run_index ASC, a.run_index ASC`,
      )
      .bind(experiment.id)
      .all<{
        baseline_run_id: string;
        baseline_run_index: number;
        arm_run_id: string;
        arm_run_index: number;
        total: number;
        win: number;
        loss: number;
        tie: number;
      }>(),
    listRuns(db, experiment.id),
  ]);

  const batchIds = runs.map((r) => r.batch_id).filter((id): id is string => id !== null);
  const ratingByBatch = new Map<
    string,
    { good: number; neutral: number; bad: number; unrated: number; total: number }
  >();
  for (const part of chunk(batchIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT batch_id, rating, COUNT(*) AS n
         FROM generations
         WHERE batch_id IN (${placeholders})
         GROUP BY batch_id, rating`,
      )
      .bind(...part)
      .all<{ batch_id: string; rating: string | null; n: number }>();
    for (const row of results ?? []) {
      const entry = ratingByBatch.get(row.batch_id) ?? { good: 0, neutral: 0, bad: 0, unrated: 0, total: 0 };
      if (row.rating === 'good') entry.good += row.n;
      else if (row.rating === 'neutral') entry.neutral += row.n;
      else if (row.rating === 'bad') entry.bad += row.n;
      else entry.unrated += row.n;
      entry.total += row.n;
      ratingByBatch.set(row.batch_id, entry);
    }
  }

  const factSummaryByRunId = await runFactSummary(db, runs);

  return {
    pairs: (pairsResult.results ?? []).map((p) => ({
      baseline_run_id: p.baseline_run_id,
      baseline_run_index: p.baseline_run_index,
      arm_run_id: p.arm_run_id,
      arm_run_index: p.arm_run_index,
      win: p.win,
      loss: p.loss,
      tie: p.tie,
      total: p.total,
      render_diff: diffFactSummaries(
        factSummaryByRunId.get(p.baseline_run_id) ?? {},
        factSummaryByRunId.get(p.arm_run_id) ?? {},
      ),
    })),
    runs: runs.map((r) => {
      const counts = r.batch_id ? ratingByBatch.get(r.batch_id) : undefined;
      return {
        run_id: r.id,
        run_index: r.run_index,
        batch_id: r.batch_id,
        generation_count: counts?.total ?? 0,
        rating: {
          good: counts?.good ?? 0,
          neutral: counts?.neutral ?? 0,
          bad: counts?.bad ?? 0,
          unrated: counts?.unrated ?? 0,
        },
      };
    }),
  };
}
