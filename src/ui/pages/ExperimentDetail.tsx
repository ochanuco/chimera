import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';
import { diffOverrides, formatOverrideValue, type JsonObject } from '../../lib/overrides';
import { EXPERIMENT_STATUSES, allowedNextStatuses } from '../../lib/experiment-status';
import { RENDER_FACT_COLUMNS, summarizeRenderFacts, type RenderFacts } from '../../lib/render-facts';
import { PromptChips } from '../components/PromptChips';
import type { ExperimentStatus } from '../../types';
import { StatusBadge } from './Experiments';

export interface ExperimentDetailRunBatch {
  id: string;
  short_id: string;
  thumbnail_url: string | null;
}

export interface ExperimentDetailRunGeneration {
  id: string;
  short_id: string;
  canonical_url: string;
  image_url: string;
  thumbnail_url: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  character_id: string | null;
  created_at: string;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
}

export interface ExperimentDetailRun {
  id: string;
  experiment_id: string;
  run_index: number;
  parent_run_id: string | null;
  batch_id: string | null;
  generation_id: string | null;
  overrides: JsonObject;
  objective: string | null;
  evaluation: JsonObject | null;
  decision: JsonObject | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  batch: ExperimentDetailRunBatch | null;
  generation: ExperimentDetailRunGeneration | null;
  render_facts: RenderFacts | null;
  variables: Record<string, string | number> | null;
}

export interface ExperimentDetailPromotion {
  id: string;
  experiment_id: string;
  source_run_id: string | null;
  promoted_overrides: JsonObject;
  status: string;
  target_repository: string;
  target_path: string | null;
  commit_sha: string | null;
  pull_request_url: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ExperimentJudgmentPairSummary {
  baseline_run_id: string;
  baseline_run_index: number;
  arm_run_id: string;
  arm_run_index: number;
  win: number;
  loss: number;
  tie: number;
  total: number;
}

export interface ExperimentJudgmentRunSummary {
  run_id: string;
  run_index: number;
  batch_id: string | null;
  generation_count: number;
  rating: { good: number; neutral: number; bad: number; unrated: number };
}

export interface ExperimentJudgmentSummary {
  pairs: ExperimentJudgmentPairSummary[];
  runs: ExperimentJudgmentRunSummary[];
}

export interface ExperimentDetailData {
  id: string;
  short_id: string;
  name: string;
  description: string | null;
  note: string | null;
  status: string;
  base_recipe: string | null;
  character_id: string | null;
  bookmark: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  character: { id: string; name: string } | null;
  tags: string[];
  run_count: number;
  runs: ExperimentDetailRun[];
  promotions: ExperimentDetailPromotion[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `experiment.status` is typed `string`; narrow it to the known enum before looking up its allowed transitions. */
function isExperimentStatus(value: string): value is ExperimentStatus {
  return (EXPERIMENT_STATUSES as readonly string[]).includes(value);
}

/** Rows written before pull_request_url validation existed may hold a non-http(s) scheme (e.g. `javascript:`); only link out when it's safe. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Base run for a delta: the run named by parent_run_id when set, else the
 * previous entry in the (run_index ASC) list, else none.
 */
function findBaseRun(run: ExperimentDetailRun, runs: ExperimentDetailRun[]): ExperimentDetailRun | null {
  if (run.parent_run_id) {
    return runs.find((r) => r.id === run.parent_run_id) ?? null;
  }
  const idx = runs.findIndex((r) => r.id === run.id);
  return idx > 0 ? runs[idx - 1]! : null;
}

function renderDeltaLine(entry: ReturnType<typeof diffOverrides>[number]) {
  const value =
    entry.kind === 'changed'
      ? `${entry.before} → ${entry.after}`
      : entry.kind === 'added'
        ? `+ ${entry.after}`
        : `- ${entry.before}`;
  return (
    <div class={`exp-delta-line exp-delta-${entry.kind}`}>
      <span class="exp-delta-path">{entry.path}</span> {value}
    </div>
  );
}

type Patch = Record<string, unknown>;

/**
 * Recognizes the comfyui-recipes patch shape (`overrides.patches`): an array
 * whose entries are all plain objects. Chimera never validates the entries
 * themselves (target/op/value are opaque to it) — this is purely a rendering
 * hint, so anything else (missing key, non-array, an array with a non-object
 * entry) returns null and callers fall back to the leaf diff.
 */
function readPatches(overrides: JsonObject): Patch[] | null {
  const patches = overrides.patches;
  if (!Array.isArray(patches)) return null;
  return patches.every(isPlainObject) ? patches : null;
}

/** `value`, or `old` for remove, or `old → value` for replace. Missing fields render as `?`. */
function formatPatchOperand(patch: Patch): string {
  const hasOld = 'old' in patch;
  const hasValue = 'value' in patch;
  if (patch.op === 'remove') return hasOld ? formatOverrideValue(patch.old) : '?';
  if (patch.op === 'replace') {
    return `${hasOld ? formatOverrideValue(patch.old) : '?'} → ${hasValue ? formatOverrideValue(patch.value) : '?'}`;
  }
  return hasValue ? formatOverrideValue(patch.value) : '?';
}

function renderPatchLine(patch: Patch, marker: 'added' | 'removed' | 'kept') {
  const target = typeof patch.target === 'string' ? patch.target : '?';
  const op = typeof patch.op === 'string' ? patch.op : '?';
  const reason = typeof patch.reason === 'string' ? patch.reason : null;
  const prefix = marker === 'added' ? '+ ' : marker === 'removed' ? '- ' : '';
  return (
    <div class={`exp-delta-line exp-delta-${marker === 'kept' ? 'kept' : marker}`}>
      {prefix}
      <span class="exp-delta-path">{target}</span> {op} {formatPatchOperand(patch)}
      {reason ? <span class="exp-delta-reason"> {reason}</span> : null}
    </div>
  );
}

/**
 * `overrides.patches` is already a diff against the base recipe, so comparing
 * two runs' patch lists leaf-by-leaf (via diffOverrides) collapses to one
 * unreadable "patches[] changed" entry. Instead show this run's patch list
 * directly, marking each line against the base run's list by JSON identity.
 */
function countByKey(patches: Patch[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const patch of patches) {
    const key = JSON.stringify(patch);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * `basePatches` が null のときは比較相手のない最初の Run。その patch は
 * 「前回からの追加」ではないので marker を付けない。
 * 同一 patch が複数入りうるので Set ではなく多重集合として突き合わせる。
 * patch を全部外した Run も変更なので、removed 行だけが残る場合はそれを出す。
 */
function renderPatchDelta(runPatches: Patch[], basePatches: Patch[] | null, label: string) {
  const remaining = countByKey(basePatches ?? []);
  const lines = runPatches.map((patch) => {
    if (!basePatches) return renderPatchLine(patch, 'kept');
    const key = JSON.stringify(patch);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return renderPatchLine(patch, 'added');
    remaining.set(key, left - 1);
    return renderPatchLine(patch, 'kept');
  });
  for (const patch of basePatches ?? []) {
    const key = JSON.stringify(patch);
    const left = remaining.get(key) ?? 0;
    if (left === 0) continue;
    remaining.set(key, left - 1);
    lines.push(renderPatchLine(patch, 'removed'));
  }
  return (
    <div class="exp-delta">
      <div class="exp-delta-label">{label}</div>
      {lines.length === 0 ? <div class="exp-delta-empty">(no override change)</div> : lines}
    </div>
  );
}

function renderRunDelta(run: ExperimentDetailRun, runs: ExperimentDetailRun[]) {
  const base = findBaseRun(run, runs);
  const label = base ? `Changed from #${base.run_index}` : 'Initial overrides';
  const runPatches = readPatches(run.overrides);
  if (runPatches) {
    // base が patch 形式でないなら比較軸が違う。patch リストとして突き合わせると
    // base 側の中身が全部消えたように見えるので、その組み合わせは leaf diff に落とす。
    const basePatches = base ? readPatches(base.overrides) : null;
    if (!base || basePatches) {
      return renderPatchDelta(runPatches, basePatches, label);
    }
  }
  const entries = diffOverrides(base ? base.overrides : {}, run.overrides);
  return (
    <div class="exp-delta">
      <div class="exp-delta-label">{label}</div>
      {entries.length === 0 ? <div class="exp-delta-empty">(no override change)</div> : entries.map(renderDeltaLine)}
    </div>
  );
}

function renderRunThumbnail(run: ExperimentDetailRun) {
  if (!run.generation && !run.batch) return null;
  return (
    <div class="exp-run-thumb">
      {run.generation ? (
        <a href={run.generation.canonical_url}>
          <img src={run.generation.thumbnail_url} alt="" />
        </a>
      ) : run.batch && run.batch.thumbnail_url ? (
        <a href={`/b/${run.batch.short_id}`}>
          <img src={run.batch.thumbnail_url} alt="" />
        </a>
      ) : null}
      {run.batch ? (
        <a class="exp-run-batch-link" href={`/b/${run.batch.short_id}`}>
          batch {run.batch.short_id}
        </a>
      ) : null}
    </div>
  );
}

function renderEvaluation(evaluation: JsonObject | null) {
  if (!evaluation) return null;
  const overall = typeof evaluation.overall === 'string' ? evaluation.overall : null;
  const aspects = isPlainObject(evaluation.aspects) ? evaluation.aspects : null;
  const notes = Array.isArray(evaluation.notes) ? evaluation.notes : null;
  const recognized = overall !== null || aspects !== null || notes !== null;

  return (
    <div class="exp-evaluation">
      <div class="exp-evaluation-head">
        Evaluation {overall ? <StatusBadge value={overall} /> : null}
      </div>
      {recognized ? (
        <>
          {aspects && Object.keys(aspects).length > 0 ? (
            <table class="kv-table exp-aspects">
              {Object.entries(aspects).map(([key, value]) => (
                <tr>
                  <td>{key}</td>
                  <td>
                    <StatusBadge value={typeof value === 'string' ? value : formatOverrideValue(value)} />
                  </td>
                </tr>
              ))}
            </table>
          ) : null}
          {notes && notes.length > 0 ? (
            <ul class="exp-notes">
              {notes.map((n) => (
                <li>{typeof n === 'string' ? n : formatOverrideValue(n)}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <pre>{JSON.stringify(evaluation, null, 2)}</pre>
      )}
    </div>
  );
}

function renderDecision(decision: JsonObject | null) {
  if (!decision) return null;
  const action = typeof decision.action === 'string' ? decision.action : null;
  const reason = typeof decision.reason === 'string' ? decision.reason : null;
  const nextOverrides = isPlainObject(decision.next_overrides) ? decision.next_overrides : null;
  const recognized = action !== null || reason !== null || nextOverrides !== null;

  return (
    <div class="exp-decision">
      <div class="exp-decision-head">
        Decision {action ? <span class="exp-decision-action">{action}</span> : null}
      </div>
      {recognized ? (
        <>
          {reason ? <p class="exp-decision-reason">{reason}</p> : null}
          {nextOverrides ? (
            <details>
              <summary>next_overrides</summary>
              <pre>{JSON.stringify(nextOverrides, null, 2)}</pre>
            </details>
          ) : null}
        </>
      ) : (
        <pre>{JSON.stringify(decision, null, 2)}</pre>
      )}
    </div>
  );
}

function renderRun(run: ExperimentDetailRun, runs: ExperimentDetailRun[], experimentShortId: string, baseline: ExperimentDetailRun | null) {
  const overall = run.evaluation && typeof run.evaluation.overall === 'string' ? run.evaluation.overall : null;
  const showAbLink = baseline !== null && run.id !== baseline.id && run.batch_id !== null && baseline.batch_id !== null;
  return (
    <section class="exp-run" id={`run-${run.id}`}>
      <div class="exp-run-head">
        <span class="exp-run-index">#{run.run_index}</span>
        {overall ? <StatusBadge value={overall} /> : null}
        {run.objective ? <span class="exp-run-objective">{run.objective}</span> : null}
        {showAbLink ? (
          <a class="exp-run-ab-link" href={`/experiments/${experimentShortId}/ab?baseline=${baseline!.id}&arm=${run.id}`}>
            A/B vs #{baseline!.run_index}
          </a>
        ) : null}
      </div>
      {renderRunDelta(run, runs)}
      <details>
        <summary>Overrides</summary>
        <pre>{JSON.stringify(run.overrides, null, 2)}</pre>
      </details>
      {renderRunThumbnail(run)}
      {renderEvaluation(run.evaluation)}
      {renderDecision(run.decision)}
    </section>
  );
}

function renderPromotion(promotion: ExperimentDetailPromotion, runs: ExperimentDetailRun[]) {
  const sourceRun = promotion.source_run_id ? runs.find((r) => r.id === promotion.source_run_id) ?? null : null;
  return (
    <div class="exp-promotion">
      <div class="exp-promotion-head">
        <StatusBadge value={promotion.status} />
        <span class="exp-promotion-target">
          {promotion.target_repository}
          {promotion.target_path ? ` / ${promotion.target_path}` : ''}
        </span>
      </div>
      {sourceRun ? (
        <p>
          source: <a href={`#run-${sourceRun.id}`}>#{sourceRun.run_index}</a>
        </p>
      ) : null}
      {promotion.commit_sha ? (
        <p>
          commit: <span class="exp-mono">{promotion.commit_sha}</span>
        </p>
      ) : null}
      {promotion.pull_request_url ? (
        <p>
          {isHttpUrl(promotion.pull_request_url) ? (
            <a href={promotion.pull_request_url}>{promotion.pull_request_url}</a>
          ) : (
            promotion.pull_request_url
          )}
        </p>
      ) : null}
      {promotion.note ? <p>{promotion.note}</p> : null}
      <p class="exp-promotion-meta">
        created {promotion.created_at}
        {promotion.completed_at ? ` · completed ${promotion.completed_at}` : ''}
      </p>
      <details>
        <summary>Promoted overrides</summary>
        <pre>{JSON.stringify(promotion.promoted_overrides, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Baseline = the run with the lowest run_index (docs/domain-model.md#experimentrun). */
function findBaseline(runs: ExperimentDetailRun[]): ExperimentDetailRun | null {
  if (runs.length === 0) return null;
  return runs.reduce((min, r) => (r.run_index < min.run_index ? r : min), runs[0]!);
}

function formatVariableValue(value: string | number): string {
  return String(value);
}

/** Pass-1 prompt text (the sampler that's node-id first) from a Run's render_facts, or null. */
function passOnePrompt(facts: RenderFacts | null, polarity: 'positive' | 'negative'): string | null {
  return facts?.samplers[0]?.prompt[polarity] ?? null;
}

/**
 * Prompt rows below the patches breakdown: the baseline's own pass-1 positive/negative (omitted
 * when null), then for every other Run the same pair but only when it differs from the
 * baseline's — rendered diffed against it so added/removed/weight-changed chips stand out.
 */
function renderExpFactsPromptRows(runs: ExperimentDetailRun[], baseline: ExperimentDetailRun | null, columnCount: number) {
  if (!baseline) return null;

  interface PromptRowEntry {
    runIndex: number;
    polarity: 'positive' | 'negative';
    text: string | null;
    parentText: string | null;
  }
  const entries: PromptRowEntry[] = [];

  for (const polarity of ['positive', 'negative'] as const) {
    const baselineText = passOnePrompt(baseline.render_facts, polarity);
    if (baselineText === null) continue;
    entries.push({ runIndex: baseline.run_index, polarity, text: baselineText, parentText: null });
  }

  for (const run of runs) {
    if (run.id === baseline.id) continue;
    for (const polarity of ['positive', 'negative'] as const) {
      const baselineText = passOnePrompt(baseline.render_facts, polarity);
      const runText = passOnePrompt(run.render_facts, polarity);
      if ((runText ?? '').trim() === (baselineText ?? '').trim()) continue;
      entries.push({ runIndex: run.run_index, polarity, text: runText, parentText: baselineText });
    }
  }

  return entries.map((e) => (
    <tr>
      <td>
        #{e.runIndex} {e.polarity}
      </td>
      <td colspan={columnCount - 1}>
        <PromptChips text={e.text} parentText={e.parentText} variant={e.polarity} />
      </td>
    </tr>
  ));
}

/**
 * Facts table above the per-run list: one row per Run with its render_facts summary and
 * variables, plus a patches breakdown below. Shown only when at least one Run carries
 * render_facts or variables — most Experiments never got this far, and an all-empty table
 * would just be noise.
 */
function renderExpFactsTable(runs: ExperimentDetailRun[], baseline: ExperimentDetailRun | null) {
  const hasAnything = runs.some((r) => r.render_facts !== null || (r.variables && Object.keys(r.variables).length > 0));
  if (!hasAnything) return null;

  const variableKeys = Array.from(
    new Set(runs.flatMap((r) => (r.variables ? Object.keys(r.variables) : []))),
  ).sort();
  const columnCount = 1 + RENDER_FACT_COLUMNS.length + variableKeys.length;

  const baselineSummary = baseline ? summarizeRenderFacts(baseline.render_facts) : null;

  return (
    <>
      <table class="kv-table exp-facts">
        <thead>
          <tr>
            <th>run</th>
            {RENDER_FACT_COLUMNS.map((col) => (
              <th>{col}</th>
            ))}
            {variableKeys.map((key) => (
              <th>{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const summary = summarizeRenderFacts(run.render_facts);
            const isBaseline = baseline !== null && run.id === baseline.id;
            return (
              <tr>
                <td>#{run.run_index}</td>
                {RENDER_FACT_COLUMNS.map((col) => {
                  const value = summary[col];
                  const differsFromBaseline = !isBaseline && baselineSummary !== null && value !== baselineSummary[col];
                  return <td class={differsFromBaseline ? 'exp-facts-diff' : undefined}>{value ?? '—'}</td>;
                })}
                {variableKeys.map((key) => {
                  const raw = run.variables?.[key];
                  const value = raw === undefined ? null : formatVariableValue(raw);
                  const baselineRaw = baseline?.variables?.[key];
                  const baselineValue = baselineRaw === undefined ? null : formatVariableValue(baselineRaw);
                  const differsFromBaseline = !isBaseline && value !== baselineValue;
                  return <td class={differsFromBaseline ? 'exp-facts-diff' : undefined}>{value ?? '—'}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
        <tbody class="exp-facts-patches">
          {runs.flatMap((run) => {
            const patches = readPatches(run.overrides);
            if (!patches) return [];
            return patches.map((patch) => (
              <tr>
                <td>#{run.run_index}</td>
                <td colspan={columnCount - 1}>
                  <code>{typeof patch.target === 'string' ? patch.target : '?'}</code>{' '}
                  {typeof patch.op === 'string' ? patch.op : '?'} {formatPatchOperand(patch)}
                </td>
              </tr>
            ));
          })}
        </tbody>
        <tbody class="exp-facts-prompts">{renderExpFactsPromptRows(runs, baseline, columnCount)}</tbody>
      </table>
      {baseline ? <p class="exp-facts-legend">Highlighted cells differ from #{baseline.run_index}</p> : null}
    </>
  );
}

export function ExperimentDetailPage({
  experiment,
  judgments,
}: {
  experiment: ExperimentDetailData;
  judgments: ExperimentJudgmentSummary;
}) {
  const baseline = findBaseline(experiment.runs);
  return (
    <Layout title={experiment.name}>
      <h1>
        {experiment.name} <span class="exp-short-id">{experiment.short_id}</span> <CopyIdButton value={experiment.short_id} />{' '}
        <button
          type="button"
          class="bookmark-btn"
          data-kind="experiments"
          data-id={experiment.id}
          data-bookmarked={experiment.bookmark ? 'true' : 'false'}
        >
          🔖
        </button>
      </h1>

      <div class="exp-status-row">
        <select class="exp-status-select" data-id={experiment.id} data-current={experiment.status}>
          {(isExperimentStatus(experiment.status) ? allowedNextStatuses(experiment.status) : [experiment.status]).map(
            (s) => (
              <option value={s} selected={experiment.status === s}>
                {s}
              </option>
            ),
          )}
        </select>
      </div>

      {experiment.description ? <p>{experiment.description}</p> : null}

      <table class="kv-table">
        <tr>
          <td>Base Recipe</td>
          <td>{experiment.base_recipe ?? '-'}</td>
        </tr>
        <tr>
          <td>Character</td>
          <td>{experiment.character ? experiment.character.name : '-'}</td>
        </tr>
        <tr>
          <td>Tags</td>
          <td>
            {experiment.tags.length > 0 ? (
              <div class="tag-chips">
                {experiment.tags.map((t) => (
                  <span class="tag-chip">#{t}</span>
                ))}
              </div>
            ) : (
              '-'
            )}
          </td>
        </tr>
        <tr>
          <td>Created</td>
          <td>{experiment.created_at}</td>
        </tr>
        <tr>
          <td>Updated</td>
          <td>{experiment.updated_at}</td>
        </tr>
        <tr>
          <td>Completed</td>
          <td>{experiment.completed_at ?? '-'}</td>
        </tr>
      </table>

      <h2>Runs</h2>
      {renderExpFactsTable(experiment.runs, baseline)}
      {experiment.runs.length === 0 ? (
        <p class="empty-state">No runs yet.</p>
      ) : (
        experiment.runs.map((run) => renderRun(run, experiment.runs, experiment.short_id, baseline))
      )}

      <h2>A/B</h2>
      {judgments.pairs.length === 0 ? (
        <p class="empty-state">No judgments yet.</p>
      ) : (
        <table class="kv-table exp-ab-pairs">
          <tr>
            <th>pair</th>
            <th>arm wins</th>
            <th>baseline wins</th>
            <th>tie</th>
            <th>total</th>
          </tr>
          {judgments.pairs.map((p) => (
            <tr>
              <td>
                <a href={`/experiments/${experiment.short_id}/ab?baseline=${p.baseline_run_id}&arm=${p.arm_run_id}`}>
                  #{p.baseline_run_index} vs #{p.arm_run_index}
                </a>
              </td>
              <td>{p.win}</td>
              <td>{p.loss}</td>
              <td>{p.tie}</td>
              <td>{p.total}</td>
            </tr>
          ))}
        </table>
      )}
      {experiment.runs.length > 0 ? (
        <table class="kv-table exp-ab-ratings">
          <tr>
            <th>run</th>
            <th>generations</th>
            <th>good</th>
            <th>neutral</th>
            <th>bad</th>
            <th>unrated</th>
          </tr>
          {judgments.runs.map((r) => (
            <tr>
              <td>#{r.run_index}</td>
              <td>{r.generation_count}</td>
              <td>{r.rating.good}</td>
              <td>{r.rating.neutral}</td>
              <td>{r.rating.bad}</td>
              <td>{r.rating.unrated}</td>
            </tr>
          ))}
        </table>
      ) : null}

      <h2>Promotions</h2>
      {experiment.promotions.length === 0 ? (
        <p class="empty-state">No promotions yet.</p>
      ) : (
        experiment.promotions.map((p) => renderPromotion(p, experiment.runs))
      )}
    </Layout>
  );
}
