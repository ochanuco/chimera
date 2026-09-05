// requests キュー (docs/worker-protocol.md) のクエリと状態遷移。REST routes
// (src/routes/requests.ts) と MCP tools (src/mcp.ts) の両方がここを呼ぶ。
//
// lib/experiments.ts (createExperimentRun) はここの canonicalPayloadHash /
// buildRunRequestPayload を呼んで Run 作成と同じ db.batch で requests 行を
// 起票する。逆方向 (ここから lib/experiments.ts) には依存しない — 循環 import を
// 避けるため、touchExperiment は共通の lib/db.ts 側に置いている。

import { getBatchByIdOrShortId, getGenerationByIdOrShortId, nowIso, touchExperiment } from './db';
import { parseJsonObject, type JsonObject } from './overrides';
import { badRequest, conflict, notFound } from './errors';
import { uuidv7 } from './uuidv7';
import type {
  ExperimentRow,
  ExperimentRunRow,
  RequestCreatedBy,
  RequestKind,
  RequestRow,
  RequestStatus,
} from '../types';

/** キーを再帰的にソートしてから stringify する。ハッシュがキー順序に依存しないようにする。 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries) out[key] = sortKeysDeep(child);
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** `kind + "\n" + 正規化 payload` の SHA-256 hex（idempotency 再送の一致判定に使う）。 */
export async function canonicalPayloadHash(kind: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\n${stableStringify(payload)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ExperimentRun 由来の generate payload。今 watch.build_request (comfy-recipes 側)
 * が Run から組み立てているものと同じ request.json v1 の形にする。語彙の解釈は
 * しない（base_parameters の詰め替えだけ）。
 */
export function buildRunRequestPayload(experiment: ExperimentRow, run: ExperimentRunRow): JsonObject {
  const baseParameters = parseJsonObject(experiment.base_parameters_json) as JsonObject & { count?: unknown };
  const { count, ...parameters } = baseParameters;
  const instruction = run.objective ?? `run #${run.run_index} of ${experiment.name}`;
  return {
    schema_version: 1,
    request: { instruction, count: typeof count === 'number' ? count : 1 },
    generation: { recipe: experiment.base_recipe, parameters },
    semantic: { summary: instruction },
    experiment: {
      experiment_id: experiment.id,
      run_id: run.id,
      overrides: parseJsonObject(run.overrides_json),
    },
  };
}

export async function getRequestOr404(db: D1Database, id: string): Promise<RequestRow> {
  const row = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<RequestRow>();
  if (!row) throw notFound('request');
  return row;
}

/**
 * backfill 行 (migrations/0011_requests.sql) は payload_hash に SQL では再現できない
 * TS 側の SHA-256 を持てないため 'backfill' を仮置きしている。再送の一致判定では
 * その場で payload_json から計算し直す。
 */
async function resolvedStoredHash(row: RequestRow): Promise<string> {
  if (row.payload_hash !== 'backfill') return row.payload_hash;
  return canonicalPayloadHash(row.kind, JSON.parse(row.payload_json));
}

async function replayOrConflict(existing: RequestRow, kind: RequestKind, newHash: string): Promise<CreateRequestResult> {
  const storedHash = await resolvedStoredHash(existing);
  if (existing.kind !== kind || storedHash !== newHash) {
    throw conflict('idempotency_key reused with a different kind or payload');
  }
  return { row: existing, created: false };
}

export interface CreateRequestInput {
  kind: RequestKind;
  payload: JsonObject;
  recipe_ref?: string;
  idempotency_key: string;
  created_by: RequestCreatedBy;
}

export interface CreateRequestResult {
  row: RequestRow;
  /** false ならキーの再送で既存行をそのまま返した（何も作成していない）。 */
  created: boolean;
}

export interface CreateRequestOptions {
  /**
   * `kind = generate` かつ `payload.experiment.run_id` があるときの Run 解決・
   * 所属検証 (worker-protocol.md 参照) を行うかどうか。既定 true。
   * createExperimentRun の自動起票は Run 自身をまだコミットしていない同じ
   * db.batch の中で呼ばれる (SELECT で見えない) ため false で呼ぶ。
   */
  runValidation?: boolean;
}

export async function createRequest(
  db: D1Database,
  input: CreateRequestInput,
  options: CreateRequestOptions = {},
): Promise<CreateRequestResult> {
  const { runValidation = true } = options;
  const payloadHash = await canonicalPayloadHash(input.kind, input.payload);

  const existing = await db
    .prepare('SELECT * FROM requests WHERE idempotency_key = ?')
    .bind(input.idempotency_key)
    .first<RequestRow>();
  if (existing) return replayOrConflict(existing, input.kind, payloadHash);

  let runId: string | null = null;
  if (runValidation && input.kind === 'generate') {
    const experimentBlock = (input.payload as { experiment?: { run_id?: unknown; experiment_id?: unknown } }).experiment;
    const candidateRunId = typeof experimentBlock?.run_id === 'string' ? experimentBlock.run_id : undefined;
    if (candidateRunId) {
      const run = await db
        .prepare('SELECT id, experiment_id FROM experiment_runs WHERE id = ?')
        .bind(candidateRunId)
        .first<{ id: string; experiment_id: string }>();
      if (!run) throw notFound('experiment run');
      if (run.experiment_id !== experimentBlock?.experiment_id) {
        throw badRequest("payload.experiment.experiment_id does not match the run's experiment");
      }
      runId = run.id;
    }
  }
  // kind = finalize の payload に experiment があっても無視する（上の分岐に入らない）。

  const id = uuidv7();
  const now = nowIso();
  const recipeRef = input.recipe_ref ?? 'production';

  try {
    await db
      .prepare(
        `INSERT INTO requests (
           id, kind, status, payload_json, payload_hash, recipe_ref, run_id, worker_id, attempt, max_attempts,
           claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at
         ) VALUES (?, ?, 'queued', ?, ?, ?, ?, NULL, 0, 3, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.kind,
        JSON.stringify(input.payload),
        payloadHash,
        recipeRef,
        runId,
        input.idempotency_key,
        input.created_by,
        now,
        now,
      )
      .run();
  } catch (err) {
    // 同時 create が UNIQUE (idempotency_key) で衝突するレース。先に確定した側を読み直す。
    const raced = await db
      .prepare('SELECT * FROM requests WHERE idempotency_key = ?')
      .bind(input.idempotency_key)
      .first<RequestRow>();
    if (!raced) throw err;
    return replayOrConflict(raced, input.kind, payloadHash);
  }

  return { row: await getRequestOr404(db, id), created: true };
}

export interface RequestListFilters {
  status?: RequestStatus;
  kind?: RequestKind;
  run_id?: string;
  /** UUID / short_id どちらでも受ける。該当する Generation が無ければ空リストを返す。 */
  generation_id?: string;
  /** UUID / short_id どちらでも受ける。Batch 配下の全 Generation を対象に finalize request を集約する。 */
  batch_id?: string;
}

export async function listRequests(
  db: D1Database,
  filters: RequestListFilters,
  limit: number,
  offset: number,
): Promise<RequestRow[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    binds.push(filters.status);
  }
  if (filters.kind) {
    conditions.push('kind = ?');
    binds.push(filters.kind);
  }
  if (filters.run_id) {
    conditions.push('run_id = ?');
    binds.push(filters.run_id);
  }
  if (filters.generation_id) {
    const generation = await getGenerationByIdOrShortId(db, filters.generation_id);
    if (!generation) return [];
    conditions.push("kind = 'finalize' AND json_extract(payload_json, '$.generation_id') IN (?, ?)");
    binds.push(generation.id, generation.short_id);
  }
  if (filters.batch_id) {
    const batch = await getBatchByIdOrShortId(db, filters.batch_id);
    if (!batch) return [];
    const { results } = await db
      .prepare('SELECT id, short_id FROM generations WHERE batch_id = ?')
      .bind(batch.id)
      .all<{ id: string; short_id: string }>();
    const idsAndShortIds = (results ?? []).flatMap((g) => [g.id, g.short_id]);
    if (idsAndShortIds.length === 0) return [];
    const placeholders = idsAndShortIds.map(() => '?').join(', ');
    conditions.push(`kind = 'finalize' AND json_extract(payload_json, '$.generation_id') IN (${placeholders})`);
    binds.push(...idsAndShortIds);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await db
    .prepare(`SELECT * FROM requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<RequestRow>();
  return results ?? [];
}

/** heartbeat 途絶の判定閾値: `status = running` かつ `heartbeat_at` がこれより古い。 */
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;

export async function claimRequest(db: D1Database, workerId: string, kinds?: RequestKind[]): Promise<RequestRow | null> {
  const now = nowIso();
  const staleThreshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();

  // 1) stale な running 行を回収する。claim の直前にだけ走査するので cron は要らない
  // (worker-protocol.md「状態遷移」節)。
  await db
    .prepare(
      `UPDATE requests
       SET status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempt >= max_attempts THEN 'heartbeat timeout' ELSE error END,
           finished_at = CASE WHEN attempt >= max_attempts THEN ? ELSE finished_at END,
           worker_id = NULL,
           updated_at = ?
       WHERE status = 'running' AND heartbeat_at < ?`,
    )
    .bind(now, now, staleThreshold)
    .run();

  // 2) queued の最古の1件を1文で running にする。複数 worker が同時に呼んでも
  // 同じ行を2度渡さない (worker-protocol.md「Claim」節)。
  const kindsList = kinds && kinds.length > 0 ? kinds : (['generate', 'finalize'] as RequestKind[]);
  const placeholders = kindsList.map(() => '?').join(', ');
  const claimedAt = nowIso();
  const row = await db
    .prepare(
      `UPDATE requests
       SET status = 'running', worker_id = ?, claimed_at = ?, heartbeat_at = ?, attempt = attempt + 1, updated_at = ?
       WHERE id = (
         SELECT id FROM requests WHERE status = 'queued' AND kind IN (${placeholders})
         ORDER BY created_at ASC, id ASC LIMIT 1
       )
       RETURNING *`,
    )
    .bind(workerId, claimedAt, claimedAt, claimedAt, ...kindsList)
    .first<RequestRow>();
  return row ?? null;
}

export interface UpdateRequestInput {
  status: 'running' | 'done' | 'failed' | 'cancelled';
  worker_id?: string;
  result?: { batch_id: string; generation_ids: string[]; recipe_commit?: string };
  error?: string;
}

const TERMINAL_STATUSES: RequestStatus[] = ['done', 'failed', 'cancelled'];

export async function updateRequest(db: D1Database, row: RequestRow, body: UpdateRequestInput): Promise<RequestRow> {
  if (TERMINAL_STATUSES.includes(row.status)) {
    throw conflict('request is already in a terminal state');
  }

  const now = nowIso();

  if (body.status === 'cancelled') {
    // queued 以外からの cancelled は409 (worker-protocol.md「Update Request」節)。
    if (row.status !== 'queued') throw conflict('cancelled is only allowed from a queued request');
    await db
      .prepare('UPDATE requests SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?')
      .bind('cancelled', now, now, row.id)
      .run();
    return getRequestOr404(db, row.id);
  }

  // running/done/failed は claim した worker だけが書ける。stale 判定で別 worker に
  // 渡った後の旧 worker からの書き込みはここで弾く。
  if (row.status !== 'running') throw conflict('request is not running');
  if (body.worker_id !== row.worker_id) throw conflict('worker_id does not match the claim');

  if (body.status === 'running') {
    await db.prepare('UPDATE requests SET heartbeat_at = ?, updated_at = ? WHERE id = ?').bind(now, now, row.id).run();
    return getRequestOr404(db, row.id);
  }

  if (body.status === 'failed') {
    await db
      .prepare('UPDATE requests SET status = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?')
      .bind('failed', body.error ?? null, now, now, row.id)
      .run();
    return getRequestOr404(db, row.id);
  }

  // done
  const result = body.result;
  if (!result) throw badRequest('result is required when status is done');
  const resultJson = JSON.stringify(result);

  if (row.run_id) {
    const run = await db.prepare('SELECT * FROM experiment_runs WHERE id = ?').bind(row.run_id).first<ExperimentRunRow>();
    if (!run) throw notFound('experiment run');

    const batch = await getBatchByIdOrShortId(db, result.batch_id);
    if (!batch) throw notFound(`batch '${result.batch_id}'`);

    // Run に既に別の batch が付いていれば409で、request 行も done になりません
    // (worker-protocol.md「Update Request」節)。
    if (run.batch_id && run.batch_id !== batch.id) {
      throw conflict('run already has a different batch attached');
    }

    // request の done と experiment_runs.batch_id の attach を単一トランザクションにする。
    // request だけが done になって Run に batch が付かない状態は作らない。
    await db.batch([
      db
        .prepare('UPDATE requests SET status = ?, result_json = ?, finished_at = ?, updated_at = ? WHERE id = ?')
        .bind('done', resultJson, now, now, row.id),
      db
        .prepare('UPDATE experiment_runs SET batch_id = ?, updated_at = ? WHERE id = ? AND (batch_id IS NULL OR batch_id = ?)')
        .bind(batch.id, now, run.id, batch.id),
    ]);
    await touchExperiment(db, run.experiment_id, now);
  } else {
    await db
      .prepare('UPDATE requests SET status = ?, result_json = ?, finished_at = ?, updated_at = ? WHERE id = ?')
      .bind('done', resultJson, now, now, row.id)
      .run();
  }

  return getRequestOr404(db, row.id);
}
