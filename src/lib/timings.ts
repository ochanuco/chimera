import { chunk, D1_MAX_BOUND_PARAMS, nowIso } from './db';
import { notFound } from './errors';
import { uuidv7 } from './uuidv7';
import type { PutTimingsInput } from '../schemas/timings';

export interface TimingPromptInput {
  prompt_id: string;
  purpose: string;
  resumed: boolean;
  submitted_at?: number | null;
  execution_start_at?: number | null;
  execution_end_at?: number | null;
  outputs_ready_at?: number | null;
  ingested_at?: number | null;
  status: 'success' | 'error' | 'interrupted' | 'unknown';
  nodes: {
    node_id: string;
    class_type: string;
    role?: string | null;
    cached: boolean;
    started_at?: number | null;
    ended_at?: number | null;
    steps_total?: number | null;
    step_ms?: number[] | null;
  }[];
}

export interface AttemptTimingInput {
  worker_id: string | null;
  attempt: number;
  version: 'v1' | 'v2';
  source: 'worker' | 'comfy_history' | 'requests';
  status: 'done' | 'failed' | 'cancelled' | 'released';
  claimed_at?: number | null;
  finished_at?: number | null;
  env?: unknown;
  cold_load?: boolean | null;
  prompts: TimingPromptInput[];
}

/** comfy_prompt_id から Job を引く。同じ prompt_id が複数 Job に付くことは無いが、最初の 1 件を採る。 */
export async function resolveJobIdsByPromptId(db: D1Database, promptIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunk(Array.from(new Set(promptIds)), D1_MAX_BOUND_PARAMS)) {
    const { results } = await db
      .prepare(`SELECT id, comfy_prompt_id FROM comfy_jobs WHERE comfy_prompt_id IN (${part.map(() => '?').join(', ')})`)
      .bind(...part)
      .all<{ id: string; comfy_prompt_id: string }>();
    for (const row of results ?? []) if (!map.has(row.comfy_prompt_id)) map.set(row.comfy_prompt_id, row.id);
  }
  return map;
}

function diff(end: number | null | undefined, start: number | null | undefined): number | null {
  return typeof end === 'number' && typeof start === 'number' ? end - start : null;
}

/** (request_id, attempt, version) の行と子行を削除して入れ直す。子の削除は FK の CASCADE に任せず明示する。 */
export async function replaceAttemptTimings(
  db: D1Database,
  requestId: string,
  input: AttemptTimingInput,
  jobIdByPrompt: Map<string, string>,
): Promise<void> {
  const attemptId = uuidv7();
  const where = 'request_id = ? AND attempt = ? AND version = ?';
  const key = [requestId, input.attempt, input.version] as const;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `DELETE FROM node_timings WHERE prompt_timing_id IN (
         SELECT id FROM prompt_timings WHERE attempt_timing_id IN (SELECT id FROM request_attempt_timings WHERE ${where}))`,
    ).bind(...key),
    db.prepare(
      `DELETE FROM prompt_timings WHERE attempt_timing_id IN (SELECT id FROM request_attempt_timings WHERE ${where})`,
    ).bind(...key),
    db.prepare(`DELETE FROM request_attempt_timings WHERE ${where}`).bind(...key),
    db.prepare(
      `INSERT INTO request_attempt_timings (id, request_id, attempt, version, source, status, claimed_at, finished_at, env_json, cold_load, worker_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      attemptId,
      requestId,
      input.attempt,
      input.version,
      input.source,
      input.status,
      input.claimed_at ?? null,
      input.finished_at ?? null,
      input.env ? JSON.stringify(input.env) : null,
      input.cold_load === null || input.cold_load === undefined ? null : input.cold_load ? 1 : 0,
      input.worker_id,
      nowIso(),
    ),
  ];
  for (const prompt of input.prompts) {
    const promptTimingId = uuidv7();
    statements.push(
      db.prepare(
        `INSERT INTO prompt_timings (id, attempt_timing_id, request_id, prompt_id, comfy_job_id, purpose, resumed, submitted_at, execution_start_at, execution_end_at, outputs_ready_at, ingested_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        promptTimingId,
        attemptId,
        requestId,
        prompt.prompt_id,
        jobIdByPrompt.get(prompt.prompt_id) ?? null,
        prompt.purpose,
        prompt.resumed ? 1 : 0,
        prompt.submitted_at ?? null,
        prompt.execution_start_at ?? null,
        prompt.execution_end_at ?? null,
        prompt.outputs_ready_at ?? null,
        prompt.ingested_at ?? null,
        prompt.status,
      ),
    );
    const seen = new Set<string>();
    for (const node of prompt.nodes) {
      if (seen.has(node.node_id)) continue;
      seen.add(node.node_id);
      statements.push(
        db.prepare(
          `INSERT INTO node_timings (prompt_timing_id, node_id, class_type, role, cached, started_at, ended_at, duration_ms, steps_total, step_ms_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          promptTimingId,
          node.node_id,
          node.class_type,
          node.role ?? null,
          node.cached ? 1 : 0,
          node.started_at ?? null,
          node.ended_at ?? null,
          diff(node.ended_at, node.started_at),
          node.steps_total ?? null,
          node.step_ms ? JSON.stringify(node.step_ms) : null,
        ),
      );
    }
  }
  await db.batch(statements);
}

export async function putRequestTimings(db: D1Database, requestId: string, input: PutTimingsInput): Promise<void> {
  const exists = await db.prepare('SELECT 1 AS ok FROM requests WHERE id = ?').bind(requestId).first();
  if (!exists) throw notFound(`request ${requestId}`);
  const jobIds = await resolveJobIdsByPromptId(
    db,
    input.prompts.map((p) => p.prompt_id),
  );
  await replaceAttemptTimings(db, requestId, input, jobIds);
}

interface HistoryMessage {
  type: string;
  timestamp: number | null;
  nodes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHistoryMessages(entry: unknown): HistoryMessage[] {
  const status = isRecord(entry) && isRecord(entry.status) ? entry.status : null;
  const raw = status && Array.isArray(status.messages) ? status.messages : [];
  const out: HistoryMessage[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !isRecord(item[1])) continue;
    const data = item[1];
    out.push({
      type: item[0],
      timestamp: typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? Math.round(data.timestamp) : null,
      nodes: Array.isArray(data.nodes) ? data.nodes.filter((n): n is string => typeof n === 'string') : [],
    });
  }
  return out;
}

const HISTORY_END_STATUS: Record<string, TimingPromptInput['status']> = {
  execution_success: 'success',
  execution_error: 'error',
  execution_interrupted: 'interrupted',
};

function graphNodeInfo(graph: string | null, nodeId: string): { class_type: string; role: string | null } {
  if (!graph) return { class_type: 'unknown', role: null };
  try {
    const node = (JSON.parse(graph) as Record<string, unknown>)[nodeId];
    if (!isRecord(node)) return { class_type: 'unknown', role: null };
    const title = isRecord(node._meta) && typeof node._meta.title === 'string' && node._meta.title ? node._meta.title : null;
    return { class_type: typeof node.class_type === 'string' ? node.class_type : 'unknown', role: title };
  } catch {
    return { class_type: 'unknown', role: null };
  }
}

function isoToEpoch(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export interface ImportComfyHistoryResult {
  imported_requests: number;
  imported_prompts: number;
  skipped_prompt_ids: string[];
}

/** ComfyUI の /history スナップショットを version v1 / source comfy_history の試行として取り込む。 */
export async function importComfyHistory(db: D1Database, history: Record<string, unknown>): Promise<ImportComfyHistoryResult> {
  const promptIds = Object.keys(history);
  const jobs = new Map<string, { id: string; request_id: string; graph: string | null }>();
  for (const part of chunk(promptIds, D1_MAX_BOUND_PARAMS)) {
    const { results } = await db
      .prepare(`SELECT id, request_id, comfy_prompt_id, graph FROM comfy_jobs WHERE comfy_prompt_id IN (${part.map(() => '?').join(', ')})`)
      .bind(...part)
      .all<{ id: string; request_id: string; comfy_prompt_id: string; graph: string | null }>();
    for (const row of results ?? []) if (!jobs.has(row.comfy_prompt_id)) jobs.set(row.comfy_prompt_id, row);
  }

  const skipped = promptIds.filter((id) => !jobs.has(id));
  const byRequest = new Map<string, string[]>();
  for (const promptId of promptIds) {
    const job = jobs.get(promptId);
    if (!job) continue;
    byRequest.set(job.request_id, [...(byRequest.get(job.request_id) ?? []), promptId]);
  }

  const requestRows = new Map<string, { id: string; attempt: number; status: string; worker_id: string | null; claimed_at: string | null; finished_at: string | null }>();
  for (const part of chunk(Array.from(byRequest.keys()), D1_MAX_BOUND_PARAMS)) {
    const { results } = await db
      .prepare(`SELECT id, attempt, status, worker_id, claimed_at, finished_at FROM requests WHERE id IN (${part.map(() => '?').join(', ')})`)
      .bind(...part)
      .all<{ id: string; attempt: number; status: string; worker_id: string | null; claimed_at: string | null; finished_at: string | null }>();
    for (const row of results ?? []) requestRows.set(row.id, row);
  }

  let importedRequests = 0;
  let importedPrompts = 0;
  for (const [requestId, ids] of byRequest) {
    const request = requestRows.get(requestId);
    if (!request) {
      skipped.push(...ids);
      continue;
    }
    const prompts: TimingPromptInput[] = ids.map((promptId) => {
      const messages = parseHistoryMessages(history[promptId]);
      const start = messages.find((m) => m.type === 'execution_start');
      const end = messages.find((m) => m.type in HISTORY_END_STATUS);
      const job = jobs.get(promptId)!;
      const cachedIds = new Set(messages.filter((m) => m.type === 'execution_cached').flatMap((m) => m.nodes));
      return {
        prompt_id: promptId,
        purpose: 'render',
        resumed: false,
        execution_start_at: start?.timestamp ?? null,
        execution_end_at: end?.timestamp ?? null,
        status: end ? HISTORY_END_STATUS[end.type]! : 'unknown',
        nodes: Array.from(cachedIds, (nodeId) => ({ node_id: nodeId, cached: true, ...graphNodeInfo(job.graph, nodeId) })),
      };
    });
    await replaceAttemptTimings(
      db,
      requestId,
      {
        worker_id: request.worker_id,
        attempt: request.attempt,
        version: 'v1',
        source: 'comfy_history',
        status: request.status === 'done' || request.status === 'failed' || request.status === 'cancelled' ? request.status : 'released',
        claimed_at: isoToEpoch(request.claimed_at),
        finished_at: isoToEpoch(request.finished_at),
        prompts,
      },
      new Map(ids.map((id) => [id, jobs.get(id)!.id])),
    );
    importedRequests += 1;
    importedPrompts += prompts.length;
  }
  return { imported_requests: importedRequests, imported_prompts: importedPrompts, skipped_prompt_ids: skipped };
}
