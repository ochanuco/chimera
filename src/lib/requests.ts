// requests キュー (docs/worker-protocol.md) のクエリと状態遷移。REST routes
// (src/routes/requests.ts) と MCP tools (src/mcp.ts) の両方がここを呼ぶ。
//
// lib/experiments.ts (createExperimentRun) はここの canonicalPayloadHash /
// buildRunRequestPayload を呼んで Run 作成と同じ db.batch で requests 行を
// 起票する。逆方向 (ここから lib/experiments.ts) には依存しない — 循環 import を
// 避けるため、touchExperiment は共通の lib/db.ts 側に置いている。

import {
  chunk,
  D1_MAX_BOUND_PARAMS,
  getBatchByIdOrShortId,
  getGenerationByIdOrShortId,
  nowIso,
  resolveBatchShortIds,
  resolveBatchThumbnails,
  touchExperiment,
} from './db';
import { parseJsonObject, type JsonObject } from './overrides';
import { badRequest, conflict, notFound } from './errors';
import { uuidv7 } from './uuidv7';
import { canonicalizeMaskedRedrawPayload } from '../schemas/requests';
import { applyFinalizeProfile, extractPins, pinPresets } from './presets';
import { stableStringify } from './json-canonical';
import type {
  BatchRow,
  ExperimentRow,
  ExperimentRunRow,
  GenerationRow,
  RequestCreatedBy,
  RequestKind,
  RequestRow,
  RequestStatus,
} from '../types';

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
  const payload: JsonObject = {
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
  // Experiment が起点とする Generation は「再現(rebuild)したい対象」であって、pose/outfit
  // などの構図参照 (composition) とは意味が違うため purpose を分ける (docs/generation-request.md)。
  if (experiment.base_generation_id) {
    payload.references = [{ generation_id: experiment.base_generation_id, purpose: 'rebuild' }];
  }
  return payload;
}

/** `resolveDerivationSource` が遡れる refinement Batch の連鎖の上限。循環データに対する安全弁。 */
const MAX_DERIVATION_HOPS = 10;

export interface DerivationSource {
  generation: GenerationRow;
  batch: BatchRow;
}

/**
 * `derive_request` の起点解決。finalize/repair (comfyui-recipes) が積む refinement Batch
 * は `parameters_json` が hires-chain 等の仕上げ payload であって generate parameters では
 * ないため、これを親として carry forward すると worker 側の parameters バリデーションに
 * 落ちる。incoming `batch_relations` (`type = 'refinement'`) を遡り、対になる
 * `batch_references` (`purpose = 'rebuild'`) が指す raw Generation/Batch まで戻す
 * (lib/lineage.ts の祖先探索と同じ2テーブル)。raw Batch (incoming refinement relation が
 * 無い) に着いたら停止する。
 */
export async function resolveDerivationSource(db: D1Database, generation: GenerationRow): Promise<DerivationSource> {
  let currentGeneration = generation;
  let currentBatch = await getBatchByIdOrShortId(db, generation.batch_id);
  if (!currentBatch) throw notFound(`batch '${generation.batch_id}'`);

  for (let hop = 0; hop < MAX_DERIVATION_HOPS; hop++) {
    const relation = await db
      .prepare(`SELECT source_batch_id FROM batch_relations WHERE target_batch_id = ? AND type = 'refinement' LIMIT 1`)
      .bind(currentBatch.id)
      .first<{ source_batch_id: string }>();
    if (!relation) return { generation: currentGeneration, batch: currentBatch };

    const rebuild = await db
      .prepare(
        `SELECT br.source_generation_id AS generation_id
         FROM batch_references br
         JOIN generations g ON g.id = br.source_generation_id
         WHERE br.target_batch_id = ? AND br.purpose = 'rebuild' AND g.batch_id = ?
         LIMIT 1`,
      )
      .bind(currentBatch.id, relation.source_batch_id)
      .first<{ generation_id: string }>();
    if (!rebuild) {
      throw conflict(`refinement batch '${currentBatch.short_id}' has no rebuild reference; cannot resolve a derivation source`);
    }

    const nextGeneration = await getGenerationByIdOrShortId(db, rebuild.generation_id);
    const nextBatch = await getBatchByIdOrShortId(db, relation.source_batch_id);
    if (!nextGeneration || !nextBatch) {
      throw conflict(`refinement batch '${currentBatch.short_id}' has no rebuild reference; cannot resolve a derivation source`);
    }

    currentGeneration = nextGeneration;
    currentBatch = nextBatch;
  }

  throw conflict(`refinement batch '${currentBatch.short_id}' derivation chain exceeds ${MAX_DERIVATION_HOPS} hops`);
}

export interface BuildDerivedRequestPayloadInput {
  parentGenerationId: string;
  /** Set only when the caller (derive_request) resolved a different Generation than the one requested — the finalized/repaired pick the agent looked at. Adds a second purpose="derive" reference. */
  requestedGenerationId?: string;
  /** null/empty means the parent Batch is graph-mode (no single recipe) and cannot be derived. */
  parentRecipe: string | null;
  parentParameters: JsonObject;
  /** Parent Batch's `patches_json` (the request's own patch layer; the pinned preset's patches are not included), or `[]` if absent. */
  parentPatches: unknown[];
  /** Parent Batch's `preset_versions_json` pins, or `[]` if absent (docs/worker-protocol.md「preset の pin」). */
  parentPresets: { kind: string; name: string; version: number }[];
  /** Whether the parent recipe has any Preset row at all (`recipeHasPresets` in ./presets) — a recipe with none has no preset body that can drift, so replaying its patches without a pin stays safe. */
  parentRecipeHasPresets: boolean;
  instruction: string;
  count: number;
  seeds?: number[];
  parameters?: JsonObject;
  patches?: unknown[];
  replacePatches: boolean;
  semantic: JsonObject;
  reference?: { aspect?: string; instruction?: string };
  /** `generation.identity_override`. Not carried from the parent: the reason covers only the patches of this request. */
  identityOverride?: string;
}

/**
 * request.json v1 payload (docs/generation-request.md) for MCP `derive_request`: the parent
 * Generation's recipe/parameters/patches carried forward and merged with the caller's diff.
 * Pure so it can be unit-tested without D1 — the parent lookup happens in the caller.
 */
export function buildDerivedRequestPayload(input: BuildDerivedRequestPayloadInput): JsonObject {
  if (!input.parentRecipe) {
    throw conflict('parent batch has no recipe; a graph-mode batch cannot be derived');
  }
  // patches は書かれた当時の preset 本文に対する差分で、その本文を特定するのが pin。
  // pin が無ければ worker は現行の版を解決するので、そのまま引き継ぐと差分の宛先がずれ、
  // text op が needle 不在で落ちる (docs/worker-protocol.md「preset の pin」)。
  if (!input.replacePatches && input.parentPatches.length > 0 && input.parentPresets.length === 0 && input.parentRecipeHasPresets) {
    throw conflict(
      'parent batch carries patches but no pinned preset version, so the preset body those patches target may have moved since; ' +
        'pass replace_patches: true with patches restated against the current preset, or derive from a batch that has pins',
    );
  }

  const mergedParameters: JsonObject = { ...input.parentParameters, ...(input.parameters ?? {}) };
  const mergedPatches: unknown[] = input.replacePatches
    ? (input.patches ?? [])
    : [...input.parentPatches, ...(input.patches ?? [])];

  // A pin only carries forward for a kind the caller didn't explicitly override — otherwise the
  // caller named a different pose/costume/expression and the old pin no longer applies. Batch's
  // `parameters_json` holds the worker-resolved `recipe_pose`, not the preset name, so a carried
  // pin overwrites `mergedParameters[kind]` with the pin's `name` to keep the two in sync
  // (docs/worker-protocol.md「preset の pin」).
  const overriddenKinds = new Set(Object.keys(input.parameters ?? {}));
  const carriedPresets = input.parentPresets.filter((pin) => !overriddenKinds.has(pin.kind));
  for (const pin of carriedPresets) mergedParameters[pin.kind] = pin.name;

  const generation: JsonObject = { recipe: input.parentRecipe, parameters: mergedParameters };
  if (mergedPatches.length > 0) generation.patches = mergedPatches;
  if (carriedPresets.length > 0) generation.presets = carriedPresets;
  if (input.identityOverride !== undefined) generation.identity_override = input.identityOverride;

  const request: JsonObject = { instruction: input.instruction, count: input.count };
  if (input.seeds) request.seeds = input.seeds;

  const reference: JsonObject = { generation_id: input.parentGenerationId, purpose: 'derive' };
  if (input.reference?.aspect !== undefined) reference.aspect = input.reference.aspect;
  if (input.reference?.instruction !== undefined) reference.instruction = input.reference.instruction;

  const references: JsonObject[] = [reference];
  if (input.requestedGenerationId && input.requestedGenerationId !== input.parentGenerationId) {
    references.push({ generation_id: input.requestedGenerationId, purpose: 'derive', aspect: 'finalized' });
  }

  return {
    schema_version: 1,
    request,
    generation,
    references,
    semantic: input.semantic,
  };
}

export async function getRequestOr404(db: D1Database, id: string): Promise<RequestRow> {
  const row = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<RequestRow>();
  if (!row) throw notFound('request');
  return row;
}

/** The most recent finalize/repair/masked_redraw request whose `result.generation_ids` includes `generationId` — the request that produced it. */
export async function findProducingRequest(db: D1Database, generationId: string): Promise<RequestRow | null> {
  return db
    .prepare(
      `SELECT * FROM requests
       WHERE kind IN ('finalize', 'repair', 'masked_redraw') AND result_json IS NOT NULL
       AND EXISTS (SELECT 1 FROM json_each(result_json, '$.generation_ids') WHERE value = ?)
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(generationId)
    .first<RequestRow>();
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

/**
 * recipe_ref の既定。契約上は "production" だが、段階 4 まで box にそのブランチは無いので
 * wrangler の var で "main" に寄せている（docs/worker-protocol.md「注意」節）。
 */
export function defaultRecipeRef(env: { REQUESTS_DEFAULT_RECIPE_REF?: string }): string {
  return env.REQUESTS_DEFAULT_RECIPE_REF || 'production';
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
  /** `recipe_ref` 省略時の値。routes / MCP は defaultRecipeRef(env) を渡す。 */
  defaultRecipeRef?: string;
}

export async function createRequest(
  db: D1Database,
  input: CreateRequestInput,
  options: CreateRequestOptions = {},
): Promise<CreateRequestResult> {
  const { runValidation = true } = options;
  // Keep the persisted/hashed worker contract stable when callers use the short
  // masked-redraw aliases, pin preset versions before generate payloads are hashed
  // (docs/worker-protocol.md「preset の pin」), and expand a finalize profile into options
  // before it is hashed (docs/worker-protocol.md「finalize profile」). REST and MCP validate
  // the envelope before reaching here; this shared normalization also covers internal
  // callers and idempotency replays.
  const payload =
    input.kind === 'masked_redraw'
      ? (canonicalizeMaskedRedrawPayload(input.payload) as JsonObject)
      : input.kind === 'generate'
        ? await pinPresets(db, input.payload)
        : input.kind === 'finalize'
          ? await applyFinalizeProfile(db, input.payload)
          : input.payload;
  const payloadHash = await canonicalPayloadHash(input.kind, payload);

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
  // kind = finalize / repair / masked_redraw の payload に experiment があっても無視する
  // （上の分岐に入らない）。

  const id = uuidv7();
  const now = nowIso();
  const recipeRef = input.recipe_ref ?? options.defaultRecipeRef ?? 'production';

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
        JSON.stringify(payload),
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
  /** claim した worker。自分が握ったまま落ちた行を起動時に拾うために使う。 */
  worker_id?: string;
  /** UUID / short_id どちらでも受ける。該当する Generation が無ければ空リストを返す。 */
  generation_id?: string;
  /** UUID / short_id どちらでも受ける。Batch 配下の全 Generation を対象に finalize / repair / masked_redraw request を集約する。 */
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
  if (filters.worker_id) {
    conditions.push('worker_id = ?');
    binds.push(filters.worker_id);
  }
  if (filters.generation_id) {
    const generation = await getGenerationByIdOrShortId(db, filters.generation_id);
    if (!generation) return [];
    conditions.push("kind IN ('finalize', 'repair', 'masked_redraw') AND json_extract(payload_json, '$.generation_id') IN (?, ?)");
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
    conditions.push(
      `kind IN ('finalize', 'repair', 'masked_redraw') AND json_extract(payload_json, '$.generation_id') IN (${placeholders})`,
    );
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

export interface RequeuedRequestRow {
  id: string;
  kind: RequestKind;
  recipe_ref: string;
  status: RequestStatus;
}

/**
 * stale な running 行 (`heartbeat_at` が5分より古い) を回収する。`attempt < max_attempts`
 * なら queued に戻し、それ以外は `error = "heartbeat timeout"` で failed にする
 * (worker-protocol.md「状態遷移」節)。claimRequest (段階2、claim の直前) と WorkerHub の
 * alarm (段階3) の両方がこれを呼ぶ — 回収の規則は1つだけ持つ。
 */
export async function requeueStaleRunning(db: D1Database, now: string): Promise<RequeuedRequestRow[]> {
  const staleThreshold = new Date(new Date(now).getTime() - HEARTBEAT_TIMEOUT_MS).toISOString();
  const { results } = await db
    .prepare(
      `UPDATE requests
       SET status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempt >= max_attempts THEN 'heartbeat timeout' ELSE error END,
           finished_at = CASE WHEN attempt >= max_attempts THEN ? ELSE finished_at END,
           worker_id = NULL,
           updated_at = ?
       WHERE status = 'running' AND heartbeat_at < ?
       RETURNING id, kind, recipe_ref, status`,
    )
    .bind(now, now, staleThreshold)
    .all<RequeuedRequestRow>();
  return results ?? [];
}

export async function claimRequest(
  db: D1Database,
  workerId: string,
  kinds?: RequestKind[],
): Promise<{ row: RequestRow | null; requeued: RequeuedRequestRow[] }> {
  // 1) stale な running 行を回収する。claim の直前にだけ走査するので cron は要らない。
  const requeued = await requeueStaleRunning(db, nowIso());

  // 2) queued の最古の1件を1文で running にする。複数 worker が同時に呼んでも
  // 同じ行を2度渡さない (worker-protocol.md「Claim」節)。
  const kindsList = kinds && kinds.length > 0 ? kinds : (['generate', 'finalize', 'repair', 'masked_redraw'] as RequestKind[]);
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
  return { row: row ?? null, requeued };
}

export interface UpdateRequestInput {
  status: 'running' | 'queued' | 'done' | 'failed' | 'cancelled';
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

  // release。自分が claim したまま落ちた行を、途絶の 5 分を待たずに手放す。行き先は
  // 途絶と同じ規則にする — 手放す理由が違うだけで、結果として起きることは同じなので、
  // 規則を 2 つ持つと attempt の扱いが 2 通りに割れる (docs/worker-protocol.md「状態遷移」)。
  if (body.status === 'queued') {
    const exhausted = row.attempt >= row.max_attempts;
    await db
      .prepare(
        exhausted
          ? `UPDATE requests SET status = 'failed', error = ?, finished_at = ?, worker_id = NULL, updated_at = ? WHERE id = ?`
          : `UPDATE requests SET status = 'queued', worker_id = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(...(exhausted ? ['released after max attempts', now, now, row.id] : [now, row.id]))
      .run();
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

  // pin が無ければ preset_versions_json は書かない — payload.generation.presets は
  // request 作成時に pinPresets が置いたものだけを持つ（graph-mode や preset 未導入の
  // recipe では presets キー自体が無い）。
  const pins = extractPins(JSON.parse(row.payload_json));
  const presetVersionsJson = pins && pins.length > 0 ? JSON.stringify(pins) : null;

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
    const statements = [
      db
        .prepare('UPDATE requests SET status = ?, result_json = ?, finished_at = ?, updated_at = ? WHERE id = ?')
        .bind('done', resultJson, now, now, row.id),
      db
        .prepare('UPDATE experiment_runs SET batch_id = ?, updated_at = ? WHERE id = ? AND (batch_id IS NULL OR batch_id = ?)')
        .bind(batch.id, now, run.id, batch.id),
    ];
    if (presetVersionsJson) {
      statements.push(
        db.prepare('UPDATE batches SET preset_versions_json = ?, updated_at = ? WHERE id = ?').bind(presetVersionsJson, now, batch.id),
      );
    }
    await db.batch(statements);
    await touchExperiment(db, run.experiment_id, now);
  } else {
    // pin の記録は付随的なもの。result.batch_id が解決できないときは request の完了を
    // 妨げず、preset_versions_json の書き込みだけを飛ばす（run_id 経路はもともと
    // batch 未解決を 409/404 で拒む契約なので、そちらの挙動は変えない）。
    const batch = presetVersionsJson ? await getBatchByIdOrShortId(db, result.batch_id) : null;
    if (presetVersionsJson && batch) {
      await db.batch([
        db
          .prepare('UPDATE requests SET status = ?, result_json = ?, finished_at = ?, updated_at = ? WHERE id = ?')
          .bind('done', resultJson, now, now, row.id),
        db.prepare('UPDATE batches SET preset_versions_json = ?, updated_at = ? WHERE id = ?').bind(presetVersionsJson, now, batch.id),
      ]);
    } else {
      await db
        .prepare('UPDATE requests SET status = ?, result_json = ?, finished_at = ?, updated_at = ? WHERE id = ?')
        .bind('done', resultJson, now, now, row.id)
        .run();
    }
  }

  return getRequestOr404(db, row.id);
}

/** ナビの queue pill が出す件数の窓 (docs/ui.md「キュー状態」)。24h を超えた failed は落ちる。 */
const SUMMARY_FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** キュー pill の展開パネルに出すグループ数の上限。 */
const SUMMARY_GROUP_CAP = 20;

export interface RequestSummaryWorker {
  worker_id: string | null;
  kinds: RequestKind[] | null;
  connected_at: string | null;
}

export interface RequestSummaryGroup {
  key: string;
  batch: { id: string; short_id: string; thumbnail_generation_short_id: string | null } | null;
  experiment: { id: string; short_id: string } | null;
  /** Batch 詳細 (`/b/:short_id`) または Experiment 詳細 (`/experiments/:short_id`) への遷移先。無ければ null。 */
  href: string | null;
  kinds: Partial<Record<RequestKind, number>>;
  counts: { queued: number; running: number; failed: number };
  /** claimed_at / finished_at / created_at のうちグループ内最大値 (ISO8601、文字列比較で十分)。 */
  latest_at: string;
}

export interface RequestSummary {
  counts: { queued: number; running: number; failed_24h: number };
  groups: RequestSummaryGroup[];
}

interface SummaryRequestRow {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  payload_json: string;
  run_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function extractPayloadGenerationId(payloadJson: string): string | null {
  try {
    const payload = JSON.parse(payloadJson) as { generation_id?: unknown };
    return typeof payload.generation_id === 'string' ? payload.generation_id : null;
  } catch {
    return null;
  }
}

/** finalize/repair/masked_redraw の payload.generation_id (UUID か short_id) から所属 Batch id を引く。 */
async function resolveGenerationBatchIds(db: D1Database, refs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(refs));
  if (unique.length === 0) return map;
  for (const part of chunk(unique, Math.floor(D1_MAX_BOUND_PARAMS / 2))) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id, batch_id FROM generations WHERE id IN (${placeholders}) OR short_id IN (${placeholders})`)
      .bind(...part, ...part)
      .all<{ id: string; short_id: string; batch_id: string }>();
    for (const r of results ?? []) {
      map.set(r.id, r.batch_id);
      map.set(r.short_id, r.batch_id);
    }
  }
  return map;
}

type SummaryExperimentRef = { id: string; short_id: string };

/** generate request の run_id から所属 Experiment を引く (Run 単体の詳細ページは無いので遷移先は Experiment)。 */
async function resolveRunExperiments(db: D1Database, runIds: string[]): Promise<Map<string, SummaryExperimentRef>> {
  const map = new Map<string, SummaryExperimentRef>();
  const unique = Array.from(new Set(runIds));
  if (unique.length === 0) return map;
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT er.id AS run_id, e.id AS experiment_id, e.short_id AS experiment_short_id
         FROM experiment_runs er JOIN experiments e ON e.id = er.experiment_id
         WHERE er.id IN (${placeholders})`,
      )
      .bind(...part)
      .all<{ run_id: string; experiment_id: string; experiment_short_id: string }>();
    for (const r of results ?? []) map.set(r.run_id, { id: r.experiment_id, short_id: r.experiment_short_id });
  }
  return map;
}

function latestTimestamp(row: SummaryRequestRow): string {
  let latest = row.created_at;
  if (row.claimed_at && row.claimed_at > latest) latest = row.claimed_at;
  if (row.finished_at && row.finished_at > latest) latest = row.finished_at;
  return latest;
}

interface SummaryBucket {
  key: string;
  batchId: string | null;
  experiment: SummaryExperimentRef | null;
  kinds: Partial<Record<RequestKind, number>>;
  counts: { queued: number; running: number; failed: number };
  latest_at: string;
}

/**
 * ナビの queue pill / パネル (docs/ui.md「キュー状態」) 向けの集計。1 グループ = 1 遷移先:
 * Batch (finalize/repair/masked_redraw)、Experiment (generate で run_id があるとき)、
 * request 単体 (generate で run_id が無いとき) — src/routes/requests.ts のルートはこれを呼んで組み立てるだけ。
 */
export async function summarizeRequests(db: D1Database, now: string): Promise<RequestSummary> {
  const cutoff = new Date(new Date(now).getTime() - SUMMARY_FAILED_WINDOW_MS).toISOString();

  const { results } = await db
    .prepare(
      `SELECT id, kind, status, payload_json, run_id, claimed_at, finished_at, created_at
       FROM requests
       WHERE status IN ('queued', 'running') OR (status = 'failed' AND finished_at >= ?)`,
    )
    .bind(cutoff)
    .all<SummaryRequestRow>();
  const rows = results ?? [];

  const counts = { queued: 0, running: 0, failed_24h: 0 };
  for (const row of rows) {
    if (row.status === 'queued') counts.queued += 1;
    else if (row.status === 'running') counts.running += 1;
    else if (row.status === 'failed') counts.failed_24h += 1;
  }

  const generationRefs: string[] = [];
  const runIds: string[] = [];
  for (const row of rows) {
    if (row.kind === 'generate') {
      if (row.run_id) runIds.push(row.run_id);
    } else {
      const generationId = extractPayloadGenerationId(row.payload_json);
      if (generationId) generationRefs.push(generationId);
    }
  }
  const [generationToBatch, runToExperiment] = await Promise.all([
    resolveGenerationBatchIds(db, generationRefs),
    resolveRunExperiments(db, runIds),
  ]);

  const buckets = new Map<string, SummaryBucket>();
  for (const row of rows) {
    let key: string;
    let batchId: string | null = null;
    let experiment: SummaryExperimentRef | null = null;

    if (row.kind === 'generate') {
      const resolved = row.run_id ? (runToExperiment.get(row.run_id) ?? null) : null;
      if (resolved) {
        key = `experiment:${resolved.id}`;
        experiment = resolved;
      } else {
        key = `request:${row.id}`;
      }
    } else {
      const generationId = extractPayloadGenerationId(row.payload_json);
      const resolvedBatchId = generationId ? (generationToBatch.get(generationId) ?? null) : null;
      if (resolvedBatchId) {
        key = `batch:${resolvedBatchId}`;
        batchId = resolvedBatchId;
      } else {
        key = `request:${row.id}`;
      }
    }

    const rowLatest = latestTimestamp(row);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, batchId, experiment, kinds: {}, counts: { queued: 0, running: 0, failed: 0 }, latest_at: rowLatest };
      buckets.set(key, bucket);
    }
    bucket.kinds[row.kind] = (bucket.kinds[row.kind] ?? 0) + 1;
    if (row.status === 'queued') bucket.counts.queued += 1;
    else if (row.status === 'running') bucket.counts.running += 1;
    else if (row.status === 'failed') bucket.counts.failed += 1;
    if (rowLatest > bucket.latest_at) bucket.latest_at = rowLatest;
  }

  const batchIds = Array.from(buckets.values())
    .map((b) => b.batchId)
    .filter((id): id is string => id !== null);
  const [batchShortIds, batchThumbnails] = await Promise.all([
    resolveBatchShortIds(db, batchIds),
    resolveBatchThumbnails(db, batchIds),
  ]);

  const groups: RequestSummaryGroup[] = Array.from(buckets.values()).map((b) => {
    let batch: RequestSummaryGroup['batch'] = null;
    let href: string | null = null;
    if (b.batchId) {
      const shortId = batchShortIds.get(b.batchId);
      if (shortId) {
        batch = { id: b.batchId, short_id: shortId, thumbnail_generation_short_id: batchThumbnails.get(b.batchId) ?? null };
        href = `/b/${shortId}`;
      }
    } else if (b.experiment) {
      href = `/experiments/${b.experiment.short_id}`;
    }
    return { key: b.key, batch, experiment: b.experiment, href, kinds: b.kinds, counts: b.counts, latest_at: b.latest_at };
  });

  groups.sort((a, b) => {
    const aRunning = a.counts.running > 0 ? 0 : 1;
    const bRunning = b.counts.running > 0 ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    if (a.latest_at === b.latest_at) return 0;
    return a.latest_at > b.latest_at ? -1 : 1;
  });

  return { counts, groups: groups.slice(0, SUMMARY_GROUP_CAP) };
}
