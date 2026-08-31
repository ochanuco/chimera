import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';
import { diffOverrides, formatOverrideValue, type JsonObject } from '../../lib/overrides';
import { EXPERIMENT_STATUSES, allowedNextStatuses } from '../../lib/experiment-status';
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

function renderRunDelta(run: ExperimentDetailRun, runs: ExperimentDetailRun[]) {
  const base = findBaseRun(run, runs);
  const entries = diffOverrides(base ? base.overrides : {}, run.overrides);
  const label = base ? `Changed from #${base.run_index}` : 'Initial overrides';
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

function renderRun(run: ExperimentDetailRun, runs: ExperimentDetailRun[]) {
  const overall = run.evaluation && typeof run.evaluation.overall === 'string' ? run.evaluation.overall : null;
  return (
    <section class="exp-run" id={`run-${run.id}`}>
      <div class="exp-run-head">
        <span class="exp-run-index">#{run.run_index}</span>
        {overall ? <StatusBadge value={overall} /> : null}
        {run.objective ? <span class="exp-run-objective">{run.objective}</span> : null}
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

export function ExperimentDetailPage({ experiment }: { experiment: ExperimentDetailData }) {
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
      {experiment.runs.length === 0 ? (
        <p class="empty-state">No runs yet.</p>
      ) : (
        experiment.runs.map((run) => renderRun(run, experiment.runs))
      )}

      <h2>Promotions</h2>
      {experiment.promotions.length === 0 ? (
        <p class="empty-state">No promotions yet.</p>
      ) : (
        experiment.promotions.map((p) => renderPromotion(p, experiment.runs))
      )}
    </Layout>
  );
}
