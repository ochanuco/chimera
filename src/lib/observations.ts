// Observation のクエリ。REST (src/routes/observations.ts) と MCP tools
// list_observations / get_observation / record_observation (src/mcp.ts) の両方が
// ここを呼ぶ。sync (JSONL からの取り込み) と1件書く createObservation は経路が
// 違うが、id の計算規則 (observationId) はどちらも共有する。

import { nowIso, chunk, D1_MAX_BOUND_PARAMS, type Pagination } from './db';
import { stableStringify } from './json-canonical';
import type { CreateObservationInput } from '../schemas/observations';
import type { ObservationOutcome, ObservationRow, ObservationSource } from '../types';

const OUTCOMES: readonly ObservationOutcome[] = ['accepted', 'rejected', 'inconclusive'];

/**
 * `{ path, line, record }` の正規化 JSON の SHA-256 (docs/domain-model.md「Observation」)。
 * `record` は変換前の元レコードそのもの — 正規化ロジック (not adopted の読み替え、形 C の
 * 変換) を後から直しても既存行の id が動かないようにするため。sync 由来でない直接書き込み
 * (createObservation) には実ファイルが無いので `path: 'direct', line: 0` を使う。
 */
export async function observationId(envelope: { path: string; line: number; record: unknown }): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(envelope));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface NormalizedObservation {
  character: string;
  pose: string | null;
  component: string | null;
  parameter: string;
  value: string;
  outcome: ObservationOutcome;
  reason: string;
  seed: number | null;
  render_id: string | null;
  generation_ids: string[] | null;
  recipe: string | null;
  observed_at: string | null;
}

export type NormalizeResult = { ok: true; row: NormalizedObservation } | { ok: false; reason: string };

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `value` は数値のこともあるので文字列化して受ける。character/parameter/reason は文字列のみ。 */
function stringifyValue(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeGenerationIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((v) => String(v)).filter((v) => v.length > 0);
  return ids.length > 0 ? ids : null;
}

/**
 * 実験のアーム (Batch と seed を指名し、verdict / observation を持つ形) のうち、axis と
 * arms を持つ形（形 C）だけは Observation に変換して受理する (docs/domain-model.md
 * 「実験のアームは Observation ではない」)。アーム分けそのもの (どの arm が選ばれたか) は
 * chimera に対応する行が無いので持ち込まず、JSONL 側に残す。
 */
function transformFormC(r: Record<string, unknown>): Record<string, unknown> {
  const arms = r.arms;
  const armNames = arms && typeof arms === 'object' && !Array.isArray(arms) ? Object.keys(arms as Record<string, unknown>) : [];
  const picked = r.picked;
  const pickedIds = Array.isArray(picked) ? picked.map((v) => String(v)) : nonEmptyString(picked) ? [picked as string] : [];
  return {
    character: r.character,
    parameter: r.axis,
    value: armNames.join(', '),
    outcome: pickedIds.length > 0 ? 'accepted' : 'inconclusive',
    reason: r.observation,
    seed: r.seed,
    render_id: r.render_id,
    generation_ids: pickedIds,
    recipe: r.recipe,
    observed_at: r.date,
  };
}

export interface NormalizeOptions {
  /**
   * record 自身が pose も component も持たないときだけ使う既定 component。sync の
   * records 要素が明示したもの — ファイル名からは推測しない (docs/domain-model.md
   * 「Observation」)。id の計算には入らない。
   */
  component?: string;
}

/** JSONL 1行を chimera の Observation の語彙に正規化する。受理しないものは reason 付きで返す。 */
export function normalizeRecord(record: unknown, options: NormalizeOptions = {}): NormalizeResult {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'record must be an object' };
  }
  const r = record as Record<string, unknown>;

  const hasAxisArms = 'axis' in r && 'arms' in r;

  let pose = nonEmptyString(r.pose);
  let component = nonEmptyString(r.component);
  if (pose === null && component === null) {
    component = nonEmptyString(options.component);
  }
  if (pose === null && component === null) {
    return { ok: false, reason: 'no pose or component' };
  }

  if (!hasAxisArms && ('verdict' in r || 'observation' in r || 'arms' in r)) {
    return { ok: false, reason: 'experiment arm, not an observation' };
  }

  const fields = hasAxisArms ? transformFormC(r) : r;

  const outcomeRaw = fields.outcome;
  if (outcomeRaw === undefined || outcomeRaw === null) {
    return { ok: false, reason: 'no outcome' };
  }
  let outcome = String(outcomeRaw);
  if (outcome === 'not adopted') outcome = 'rejected';
  if (!(OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: false, reason: `unknown outcome: ${outcome}` };
  }

  const character = nonEmptyString(fields.character);
  const parameter = nonEmptyString(fields.parameter);
  const reason = nonEmptyString(fields.reason);
  const value = stringifyValue(fields.value);
  if (character === null || parameter === null || value === null || reason === null) {
    return { ok: false, reason: 'missing required field' };
  }

  return {
    ok: true,
    row: {
      character,
      pose,
      component,
      parameter,
      value,
      outcome: outcome as ObservationOutcome,
      reason,
      seed: typeof fields.seed === 'number' && Number.isFinite(fields.seed) ? fields.seed : null,
      render_id: nonEmptyString(fields.render_id),
      generation_ids: normalizeGenerationIds(fields.generation_ids),
      recipe: nonEmptyString(fields.recipe),
      observed_at: nonEmptyString(fields.observed_at),
    },
  };
}

export interface SyncFileRecord {
  line: number;
  component?: string;
  record: unknown;
}

export interface SyncFile {
  path: string;
  records: SyncFileRecord[];
}

export interface SyncSkipped {
  path: string;
  line: number;
  reason: string;
  record: unknown;
}

export interface SyncResult {
  inserted: number;
  unchanged: number;
  skipped: SyncSkipped[];
}

const INSERT_COLUMNS =
  `id, character, pose, component, parameter, value, outcome, reason, seed, render_id,
   generation_ids_json, recipe, observed_at, supersedes_id, source, created_at`;

/**
 * files を丸ごと冪等に upsert する。同じ (path, line) は同じ id になるので何度送っても
 * 行は増えない (docs/domain-model.md「Observation」)。payload に無い既存行は消さない
 * (sync は追加のみ)。import 由来の行は supersedes_id を持たない不変条件があるため、
 * レコードにその欄があっても読まず常に NULL を書く。
 */
export async function syncObservations(db: D1Database, files: SyncFile[]): Promise<SyncResult> {
  const now = nowIso();
  const skipped: SyncSkipped[] = [];
  const statements: D1PreparedStatement[] = [];

  const insertStatement = db.prepare(
    `INSERT INTO observations (${INSERT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'import', ?)
     ON CONFLICT (id) DO NOTHING`,
  );

  for (const file of files) {
    for (const entry of file.records) {
      const normalized = normalizeRecord(entry.record, { component: entry.component });
      if (!normalized.ok) {
        skipped.push({ path: file.path, line: entry.line, reason: normalized.reason, record: entry.record });
        continue;
      }
      const id = await observationId({ path: file.path, line: entry.line, record: entry.record });
      const row = normalized.row;
      statements.push(
        insertStatement.bind(
          id,
          row.character,
          row.pose,
          row.component,
          row.parameter,
          row.value,
          row.outcome,
          row.reason,
          row.seed,
          row.render_id,
          row.generation_ids ? JSON.stringify(row.generation_ids) : null,
          row.recipe,
          row.observed_at,
          now,
        ),
      );
    }
  }

  let inserted = 0;
  for (const part of chunk(statements, D1_MAX_BOUND_PARAMS)) {
    const results = await db.batch(part);
    for (const result of results) {
      if ((result.meta?.changes ?? 0) > 0) inserted++;
    }
  }

  return { inserted, unchanged: statements.length - inserted, skipped };
}

export interface ObservationSummary {
  id: string;
  character: string;
  pose: string | null;
  component: string | null;
  parameter: string;
  value: string;
  outcome: ObservationOutcome;
  reason: string;
  seed: number | null;
  render_id: string | null;
  generation_ids: string[] | null;
  recipe: string | null;
  observed_at: string | null;
  supersedes_id: string | null;
  source: ObservationSource;
  created_at: string;
}

function serializeObservation(row: ObservationRow): ObservationSummary {
  return {
    id: row.id,
    character: row.character,
    pose: row.pose,
    component: row.component,
    parameter: row.parameter,
    value: row.value,
    outcome: row.outcome,
    reason: row.reason,
    seed: row.seed,
    render_id: row.render_id,
    generation_ids: row.generation_ids_json ? (JSON.parse(row.generation_ids_json) as string[]) : null,
    recipe: row.recipe,
    observed_at: row.observed_at,
    supersedes_id: row.supersedes_id,
    source: row.source,
    created_at: row.created_at,
  };
}

/**
 * MCP / GUI から1件書く (docs/api.md「Observation」)。id は sync と同じ content-hash
 * 規則 (`path: 'direct', line: 0`) で計算するので、同じ内容の呼び出しは新しい行を
 * 作らずに既存行をそのまま返す (冪等)。
 */
export async function createObservation(
  db: D1Database,
  input: CreateObservationInput,
  source: ObservationSource,
): Promise<ObservationSummary> {
  const record = {
    character: input.character,
    pose: input.pose ?? null,
    component: input.component ?? null,
    parameter: input.parameter,
    value: input.value,
    outcome: input.outcome,
    reason: input.reason,
    seed: input.seed ?? null,
    render_id: input.render_id ?? null,
    generation_ids: input.generation_ids && input.generation_ids.length > 0 ? input.generation_ids : null,
    recipe: input.recipe ?? null,
    observed_at: input.observed_at ?? null,
    supersedes_id: input.supersedes_id ?? null,
  };
  // 直接書き込みの id は内容ではなく idempotency_key から作る。内容から作ると、同期側と
  // 同じ理由で再測定が黙って消える (docs/domain-model.md「Observation」不変条件)。
  const id = await observationId({ path: 'direct', line: 0, record: { idempotency_key: input.idempotency_key } });
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO observations (${INSERT_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      id,
      record.character,
      record.pose,
      record.component,
      record.parameter,
      record.value,
      record.outcome,
      record.reason,
      record.seed,
      record.render_id,
      record.generation_ids ? JSON.stringify(record.generation_ids) : null,
      record.recipe,
      record.observed_at,
      record.supersedes_id,
      source,
      now,
    )
    .run();

  return (await getObservation(db, id))!;
}

export async function getObservation(db: D1Database, id: string): Promise<ObservationSummary | null> {
  const row = await db.prepare('SELECT * FROM observations WHERE id = ?').bind(id).first<ObservationRow>();
  return row ? serializeObservation(row) : null;
}

export interface ListObservationsFilters {
  character?: string;
  pose?: string;
  component?: string;
  parameter?: string;
  outcome?: ObservationOutcome;
  /** parameter / value / reason の部分一致 (大文字小文字を区別しない、SQLite LIKE の既定挙動)。 */
  q?: string;
}

export async function listObservations(
  db: D1Database,
  filters: ListObservationsFilters,
  pagination: Pagination,
): Promise<ObservationSummary[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.character) {
    conditions.push('character = ?');
    params.push(filters.character);
  }
  if (filters.pose) {
    conditions.push('pose = ?');
    params.push(filters.pose);
  }
  if (filters.component) {
    conditions.push('component = ?');
    params.push(filters.component);
  }
  if (filters.parameter) {
    conditions.push('parameter = ?');
    params.push(filters.parameter);
  }
  if (filters.outcome) {
    conditions.push('outcome = ?');
    params.push(filters.outcome);
  }
  if (filters.q) {
    conditions.push('(parameter LIKE ? OR value LIKE ? OR reason LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await db
    .prepare(`SELECT * FROM observations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, pagination.limit, pagination.offset)
    .all<ObservationRow>();

  return (results ?? []).map(serializeObservation);
}
