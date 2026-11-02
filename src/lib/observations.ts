// REST (src/routes/observations.ts) と MCP tools (src/mcp.ts) の両方がここを呼ぶ。

import { nowIso, type Pagination } from './db';
import { stableStringify } from './json-canonical';
import type { CreateObservationInput } from '../schemas/observations';
import type { ObservationOutcome, ObservationRow, ObservationSource } from '../types';

/** `{ path, line, record }` の正規化 JSON の SHA-256。取り込み経路の廃止後も、既存行の id を変えないためこの形のまま使う。 */
export async function observationId(envelope: { path: string; line: number; record: unknown }): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(envelope));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const INSERT_COLUMNS =
  `id, character, pose, component, parameter, value, outcome, reason, seed, render_id,
   generation_ids_json, recipe, observed_at, supersedes_id, source, created_at`;

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

/** MCP / GUI から1件書く。id は idempotency_key から作るので同じ key の再送は冪等。 */
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
  // 内容から id を作ると再測定が黙って消える。
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
): Promise<{ items: ObservationSummary[]; total: number }> {
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
  const counted = await db
    .prepare(`SELECT COUNT(*) AS total FROM observations ${where}`)
    .bind(...params)
    .first<{ total: number }>();

  return { items: (results ?? []).map(serializeObservation), total: counted?.total ?? 0 };
}
