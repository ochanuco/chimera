import { drawnPoseOf } from './preset-references';
import type { RenderFacts } from './render-facts';

export const STATS_PERIODS = ['7d', '14d', '30d', '90d', 'all'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export type StatsCold = 'include' | 'exclude';

export const TOP_POSES = 10;
const JST_OFFSET_MS = 9 * 3600 * 1000;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

export interface Summary {
  n: number;
  median_ms: number | null;
  p90_ms: number | null;
}

function summarize(values: number[]): Summary {
  return { n: values.length, median_ms: median(values), p90_ms: percentile(values, 0.9) };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export const SEGMENTS = ['pre_submit', 'queue', 'execute', 'post', 'tail'] as const;
export type Segment = (typeof SEGMENTS)[number];

interface RequestRecord {
  id: string;
  kind: string;
  status: string;
  recipe: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  parameters_json: string | null;
  preset_versions_json: string | null;
}

interface AttemptRecord {
  id: string;
  request_id: string;
  version: 'v1' | 'v2';
  source: 'worker' | 'comfy_history' | 'requests';
  status: string;
  claimed_at: number | null;
  finished_at: number | null;
  env_json: string | null;
  cold_load: number | null;
}

interface PromptRecord {
  id: string;
  attempt_timing_id: string;
  submitted_at: number | null;
  execution_start_at: number | null;
  execution_end_at: number | null;
  outputs_ready_at: number | null;
  ingested_at: number | null;
}

interface NodeRecord {
  attempt_timing_id: string;
  role: string | null;
  duration_ms: number | null;
  step_ms_json: string | null;
  comfy_job_id: string | null;
}

interface GenerationRecord {
  rating: string | null;
  kind: string;
  recipe: string | null;
  parameters_json: string | null;
  preset_versions_json: string | null;
  published: number;
}

export interface StatsData {
  requests: RequestRecord[];
  attempts: AttemptRecord[];
  prompts: PromptRecord[];
  nodes: NodeRecord[];
  renderFacts: Map<string, string | null>;
  generations: GenerationRecord[];
}

export interface DailyPoint {
  date: string;
  kind: string;
  version: 'v1' | 'v2';
  n: number;
  median_ms: number | null;
}

export interface SegmentStat extends Summary {
  kind: string;
  segment: Segment;
}

export interface RoleStat extends Summary {
  checkpoint: string;
  canvas: string;
  role: string;
}

export interface StepStat {
  role: string;
  n: number;
  steps: { index: number; n: number; median_ms: number | null }[];
  first_median_ms: number | null;
  rest_median_ms: number | null;
}

export interface EnvironmentStat {
  comfyui_version: string | null;
  attention: string | null;
  argv: string;
  kind: string;
  n: number;
  median_execute_ms: number | null;
}

export interface CountEntry {
  key: string;
  count: number;
}

export interface Stats {
  period: StatsPeriod;
  cold: StatsCold;
  window_start: string | null;
  daily: DailyPoint[];
  segments: SegmentStat[];
  roles: RoleStat[];
  steps: StepStat[];
  environments: EnvironmentStat[];
  counts: {
    generations: number;
    by_rating: { good: number; neutral: number; bad: number; unrated: number };
    published: number;
    by_kind: CountEntry[];
    by_recipe: CountEntry[];
    by_pose: CountEntry[];
    gpu_ms: number;
    /** Σ (finished - claimed) over attempts that only have the requests-table fallback. */
    gpu_approx_ms: number;
    wall_ms: number;
    mean_ms_per_generation: number | null;
    ms_per_good_generation: number | null;
  };
}

export function windowStart(period: StatsPeriod, now: Date): string | null {
  if (period === 'all') return null;
  const days = Number.parseInt(period, 10);
  return new Date(now.getTime() - days * 86400 * 1000).toISOString();
}

export async function loadStatsData(db: D1Database, since: string | null): Promise<StatsData> {
  const cutoff = since ?? '';
  const [requests, attempts, prompts, nodes, jobs, generations] = await Promise.all([
    db
      .prepare(
        `SELECT id, kind, status, recipe, created_at, claimed_at, finished_at, parameters_json, preset_versions_json
         FROM requests WHERE created_at >= ?`,
      )
      .bind(cutoff)
      .all<RequestRecord>(),
    db
      .prepare(
        `SELECT t.id, t.request_id, t.version, t.source, t.status, t.claimed_at, t.finished_at, t.env_json, t.cold_load
         FROM request_attempt_timings t JOIN requests r ON r.id = t.request_id WHERE r.created_at >= ?`,
      )
      .bind(cutoff)
      .all<AttemptRecord>(),
    db
      .prepare(
        `SELECT p.id, p.attempt_timing_id, p.submitted_at, p.execution_start_at, p.execution_end_at, p.outputs_ready_at, p.ingested_at
         FROM prompt_timings p JOIN requests r ON r.id = p.request_id WHERE r.created_at >= ?`,
      )
      .bind(cutoff)
      .all<PromptRecord>(),
    db
      .prepare(
        `SELECT n.role, n.duration_ms, n.step_ms_json, p.comfy_job_id, p.attempt_timing_id
         FROM node_timings n JOIN prompt_timings p ON p.id = n.prompt_timing_id JOIN requests r ON r.id = p.request_id
         WHERE r.created_at >= ? AND n.cached = 0 AND n.role IS NOT NULL`,
      )
      .bind(cutoff)
      .all<NodeRecord>(),
    db
      .prepare(
        `SELECT DISTINCT j.id, j.render_facts_json
         FROM comfy_jobs j JOIN prompt_timings p ON p.comfy_job_id = j.id JOIN requests r ON r.id = p.request_id
         WHERE r.created_at >= ?`,
      )
      .bind(cutoff)
      .all<{ id: string; render_facts_json: string | null }>(),
    db
      .prepare(
        `SELECT g.rating, r.kind, r.recipe, r.parameters_json, r.preset_versions_json,
                EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id) AS published
         FROM generations g JOIN comfy_jobs j ON j.id = g.comfy_job_id JOIN requests r ON r.id = j.request_id
         WHERE g.created_at >= ?`,
      )
      .bind(cutoff)
      .all<GenerationRecord>(),
  ]);
  return {
    requests: requests.results ?? [],
    attempts: attempts.results ?? [],
    prompts: prompts.results ?? [],
    nodes: nodes.results ?? [],
    renderFacts: new Map((jobs.results ?? []).map((j) => [j.id, j.render_facts_json])),
    generations: generations.results ?? [],
  };
}

interface Attempt {
  request: RequestRecord;
  version: 'v1' | 'v2';
  source: AttemptRecord['source'];
  claimed_at: number | null;
  finished_at: number | null;
  total_ms: number | null;
  prompts: PromptRecord[];
  env: Record<string, unknown> | null;
  /** Attempt row id; null for the requests-table fallback. */
  id: string | null;
}

function nonNegative(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function sumPairs(pairs: [number | null, number | null][]): number | null {
  let total = 0;
  let any = false;
  for (const [end, start] of pairs) {
    if (end === null || start === null || end < start) continue;
    total += end - start;
    any = true;
  }
  return any ? total : null;
}

function executeMs(prompts: PromptRecord[]): number | null {
  return sumPairs(prompts.map((p) => [p.execution_end_at, p.execution_start_at]));
}

function segmentsOf(attempt: Attempt): Record<Segment, number | null> {
  const { prompts, claimed_at: claimedAt, finished_at: finishedAt } = attempt;
  const submitted = prompts.map((p) => p.submitted_at).filter((v): v is number => v !== null);
  const done = (p: PromptRecord) => p.ingested_at ?? p.outputs_ready_at;
  const doneAt = prompts.map(done).filter((v): v is number => v !== null);
  return {
    pre_submit: claimedAt !== null && submitted.length > 0 ? nonNegative(Math.min(...submitted) - claimedAt) : null,
    queue: sumPairs(prompts.map((p) => [p.execution_start_at, p.submitted_at])),
    execute: executeMs(prompts),
    post: sumPairs(prompts.map((p) => [done(p), p.execution_end_at])),
    tail: finishedAt !== null && doneAt.length > 0 ? nonNegative(finishedAt - Math.max(...doneAt)) : null,
  };
}

function parseEnv(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function buildAttempts(data: StatsData, cold: StatsCold): Attempt[] {
  const requestById = new Map(data.requests.map((r) => [r.id, r]));
  const promptsByAttempt = groupBy(data.prompts, (p) => p.attempt_timing_id);
  const hasTimings = new Set<string>();
  const attempts: Attempt[] = [];

  for (const row of data.attempts) {
    const request = requestById.get(row.request_id);
    if (!request) continue;
    hasTimings.add(row.request_id);
    if (cold === 'exclude' && row.cold_load === 1) continue;
    if (row.status !== 'done' && row.status !== 'failed') continue;
    attempts.push({
      request,
      version: row.version,
      source: row.source,
      claimed_at: row.claimed_at,
      finished_at: row.finished_at,
      total_ms: row.claimed_at !== null && row.finished_at !== null ? nonNegative(row.finished_at - row.claimed_at) : null,
      prompts: promptsByAttempt.get(row.id) ?? [],
      env: parseEnv(row.env_json),
      id: row.id,
    });
  }

  for (const request of data.requests) {
    if (hasTimings.has(request.id)) continue;
    if ((request.status !== 'done' && request.status !== 'failed') || !request.claimed_at || !request.finished_at) continue;
    const total = Date.parse(request.finished_at) - Date.parse(request.claimed_at);
    if (Number.isNaN(total) || total < 0) continue;
    attempts.push({ request, version: 'v1', source: 'requests', claimed_at: null, finished_at: null, total_ms: total, prompts: [], env: null, id: null });
  }
  return attempts;
}

function jstDate(iso: string): string {
  return new Date(Date.parse(iso) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function dailySeries(attempts: Attempt[]): DailyPoint[] {
  const groups = groupBy(
    attempts.filter((a) => a.total_ms !== null),
    (a) => `${jstDate(a.request.created_at)}\t${a.request.kind}\t${a.version}`,
  );
  return Array.from(groups, ([key, list]) => {
    const [date, kind, version] = key.split('\t') as [string, string, 'v1' | 'v2'];
    return { date, kind, version, n: list.length, median_ms: median(list.map((a) => a.total_ms!)) };
  }).sort((a, b) => (a.date === b.date ? (a.kind + a.version).localeCompare(b.kind + b.version) : a.date.localeCompare(b.date)));
}

function segmentStats(attempts: Attempt[]): SegmentStat[] {
  const v2 = attempts.filter((a) => a.version === 'v2' && a.id);
  const out: SegmentStat[] = [];
  for (const [kind, list] of groupBy(v2, (a) => a.request.kind)) {
    const perAttempt = list.map(segmentsOf);
    for (const segment of SEGMENTS) {
      const values = perAttempt.map((s) => s[segment]).filter((v): v is number => v !== null);
      out.push({ kind, segment, ...summarize(values) });
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind));
}

interface Canvas {
  checkpoint: string;
  canvas: string;
}

function canvasOf(json: string | null | undefined): Canvas {
  const unknown = { checkpoint: 'unknown', canvas: 'unknown' };
  if (!json) return unknown;
  try {
    const facts = JSON.parse(json) as RenderFacts;
    const c = facts.canvas;
    const base = c && c.width !== null && c.height !== null ? `${c.width}x${c.height}` : null;
    const final = c?.final_size ? `${c.final_size.width}x${c.final_size.height}` : null;
    return {
      checkpoint: facts.checkpoints?.length ? facts.checkpoints.join('+') : 'unknown',
      canvas: base ? (final ? `${base} → ${final}` : base) : (final ?? 'unknown'),
    };
  } catch {
    return unknown;
  }
}

function roleStats(data: StatsData, allowed: Set<string>): RoleStat[] {
  const rows = data.nodes.filter((n) => n.duration_ms !== null && allowed.has(n.attempt_timing_id));
  const groups = groupBy(rows, (n) => {
    const c = canvasOf(n.comfy_job_id ? data.renderFacts.get(n.comfy_job_id) : null);
    return `${c.checkpoint}\t${c.canvas}\t${n.role}`;
  });
  return Array.from(groups, ([key, list]) => {
    const [checkpoint, canvas, role] = key.split('\t') as [string, string, string];
    return { checkpoint, canvas, role, ...summarize(list.map((n) => n.duration_ms!)) };
  }).sort((a, b) => `${a.checkpoint}${a.canvas}${a.role}`.localeCompare(`${b.checkpoint}${b.canvas}${b.role}`));
}

function stepStats(data: StatsData, allowed: Set<string>): StepStat[] {
  const rows = data.nodes.filter((n) => n.step_ms_json && allowed.has(n.attempt_timing_id));
  const out: StepStat[] = [];
  for (const [role, list] of groupBy(rows, (n) => n.role!)) {
    const series: number[][] = [];
    for (const node of list) {
      try {
        const parsed = JSON.parse(node.step_ms_json!) as unknown;
        if (Array.isArray(parsed)) series.push(parsed.filter((v): v is number => typeof v === 'number'));
      } catch {
        continue;
      }
    }
    if (series.length === 0) continue;
    const longest = Math.max(...series.map((s) => s.length));
    const steps = Array.from({ length: longest }, (_, index) => {
      const values = series.map((s) => s[index]).filter((v): v is number => v !== undefined);
      return { index: index + 1, n: values.length, median_ms: median(values) };
    });
    out.push({
      role,
      n: series.length,
      steps,
      first_median_ms: median(series.map((s) => s[0]).filter((v): v is number => v !== undefined)),
      rest_median_ms: median(series.flatMap((s) => s.slice(1))),
    });
  }
  return out.sort((a, b) => a.role.localeCompare(b.role));
}

function environmentStats(attempts: Attempt[]): EnvironmentStat[] {
  const v2 = attempts.filter((a) => a.version === 'v2' && a.id && executeMs(a.prompts) !== null);
  const envOf = (a: Attempt) => {
    const argv = Array.isArray(a.env?.argv) ? (a.env!.argv as unknown[]).map(String).join(' ') : '';
    const version = typeof a.env?.comfyui_version === 'string' ? a.env.comfyui_version : null;
    const attention = typeof a.env?.attention === 'string' ? a.env.attention : null;
    return { version, attention, argv };
  };
  const groups = groupBy(v2, (a) => {
    const e = envOf(a);
    return `${e.version ?? ''}\t${e.attention ?? ''}\t${e.argv}\t${a.request.kind}`;
  });
  return Array.from(groups, ([, list]) => {
    const e = envOf(list[0]!);
    return {
      comfyui_version: e.version,
      attention: e.attention,
      argv: e.argv,
      kind: list[0]!.request.kind,
      n: list.length,
      median_execute_ms: median(list.map((a) => executeMs(a.prompts)!)),
    };
  }).sort((a, b) => `${a.comfyui_version}${a.attention}${a.argv}${a.kind}`.localeCompare(`${b.comfyui_version}${b.attention}${b.argv}${b.kind}`));
}

function tally(keys: string[], limit?: number): CountEntry[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const sorted = Array.from(counts, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (limit === undefined || sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit).reduce((sum, e) => sum + e.count, 0);
  return [...sorted.slice(0, limit), { key: '(その他)', count: rest }];
}

function countStats(data: StatsData, attempts: Attempt[]): Stats['counts'] {
  const by_rating = { good: 0, neutral: 0, bad: 0, unrated: 0 };
  for (const g of data.generations) {
    if (g.rating === 'good' || g.rating === 'neutral' || g.rating === 'bad') by_rating[g.rating] += 1;
    else by_rating.unrated += 1;
  }
  let gpu = 0;
  let approx = 0;
  let wall = 0;
  for (const a of attempts) {
    wall += a.total_ms ?? 0;
    if (a.source === 'requests') approx += a.total_ms ?? 0;
    else gpu += executeMs(a.prompts) ?? 0;
  }
  const total = data.generations.length;
  return {
    generations: total,
    by_rating,
    published: data.generations.filter((g) => g.published === 1).length,
    by_kind: tally(data.generations.map((g) => g.kind)),
    by_recipe: tally(data.generations.map((g) => g.recipe ?? '(none)')),
    by_pose: tally(
      data.generations.map((g) => drawnPoseOf(g) ?? '(none)'),
      TOP_POSES,
    ),
    gpu_ms: gpu,
    gpu_approx_ms: approx,
    wall_ms: wall,
    mean_ms_per_generation: total > 0 ? wall / total : null,
    ms_per_good_generation: by_rating.good > 0 ? wall / by_rating.good : null,
  };
}

export function computeStats(data: StatsData, period: StatsPeriod, cold: StatsCold, now: Date = new Date()): Stats {
  const attempts = buildAttempts(data, cold);
  const allowed = new Set(attempts.flatMap((a) => (a.id ? [a.id] : [])));
  return {
    period,
    cold,
    window_start: windowStart(period, now),
    daily: dailySeries(attempts),
    segments: segmentStats(attempts),
    roles: roleStats(data, allowed),
    steps: stepStats(data, allowed),
    environments: environmentStats(attempts),
    counts: countStats(data, attempts),
  };
}

export async function getStats(db: D1Database, period: StatsPeriod, cold: StatsCold, now: Date = new Date()): Promise<Stats> {
  return computeStats(await loadStatsData(db, windowStart(period, now)), period, cold, now);
}
