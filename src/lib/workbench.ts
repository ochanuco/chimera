// ワークベンチ: 元絵 (raw Generation) から下の仕上げ連鎖 (refines_generation_id) を木として返し、フェーズごとの採用・スキップを保存する。

import { getGenerationByIdOrShortId, nowIso } from './db';
import { badRequest, notFound } from './errors';
import { isDeliveredRequest } from './requests';
import { uuidv7 } from './uuidv7';
import type { WorkbenchPicks } from '../schemas/workbenches';
import type { GenerationRow, RequestKind, RequestStatus } from '../types';

const MAX_ROOT_HOPS = 100;

/** redraw の canvas / hires = 1、light = 2、repair / masked_redraw = 3、deliver = 4、dof = 5。それ以外は null。 */
export function workbenchPhase(kind: string, method: string | null): number | null {
  if (kind === 'redraw') return method === 'light' ? 2 : method === 'canvas' || method === 'hires' ? 1 : null;
  if (kind === 'repair' || kind === 'masked_redraw') return 3;
  if (kind === 'deliver') return 4;
  if (kind === 'dof') return 5;
  return null;
}

function parseOptions(payloadJson: string): Record<string, unknown> | null {
  try {
    const options = (JSON.parse(payloadJson) as { options?: unknown }).options;
    return options && typeof options === 'object' && !Array.isArray(options) ? (options as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function methodOf(kind: string, options: Record<string, unknown> | null): string | null {
  return kind === 'redraw' && typeof options?.method === 'string' ? options.method : null;
}

/** 仕上げ元を raw Generation までさかのぼる。 */
export async function findRootGeneration(db: D1Database, generation: GenerationRow): Promise<GenerationRow> {
  let current = generation;
  for (let hop = 0; hop < MAX_ROOT_HOPS && current.refines_generation_id; hop += 1) {
    const parent = await db.prepare('SELECT * FROM generations WHERE id = ?').bind(current.refines_generation_id).first<GenerationRow>();
    if (!parent) break;
    current = parent;
  }
  return current;
}

const SUBTREE_CTE = `WITH RECURSIVE subtree(id) AS (
  SELECT ?
  UNION
  SELECT g.id FROM generations g JOIN subtree s ON g.refines_generation_id = s.id
)`;

export interface WorkbenchNode {
  id: string;
  short_id: string;
  refines_generation_id: string | null;
  kind: RequestKind;
  method: string | null;
  phase: number | null;
  options: Record<string, unknown> | null;
  rating: string | null;
  delivered: boolean;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  created_at: string;
}

export interface WorkbenchPending {
  request_id: string;
  kind: RequestKind;
  method: string | null;
  phase: number | null;
  options: Record<string, unknown> | null;
  source_generation_id: string;
  status: RequestStatus;
  created_at: string;
}

export interface WorkbenchTree {
  root_id: string;
  nodes: WorkbenchNode[];
  pending: WorkbenchPending[];
}

export async function buildWorkbenchTree(db: D1Database, root: GenerationRow): Promise<WorkbenchTree> {
  const { results } = await db
    .prepare(
      `${SUBTREE_CTE}
       SELECT g.id, g.short_id, g.refines_generation_id, g.rating, g.created_at, g.image_width, g.image_height, g.image_size,
              r.kind AS request_kind, r.payload_json, r.parameters_json
       FROM generations g
       JOIN subtree s ON s.id = g.id
       JOIN requests r ON r.id = g.request_id
       ORDER BY g.created_at ASC, g.id ASC`,
    )
    .bind(root.id)
    .all<{
      id: string;
      short_id: string;
      refines_generation_id: string | null;
      rating: string | null;
      created_at: string;
      image_width: number | null;
      image_height: number | null;
      image_size: number | null;
      request_kind: RequestKind;
      payload_json: string;
      parameters_json: string | null;
    }>();

  const rows = results ?? [];
  const nodes: WorkbenchNode[] = rows.map((row) => {
    const options = row.request_kind === 'generate' ? null : parseOptions(row.payload_json);
    const method = methodOf(row.request_kind, options);
    return {
      id: row.id,
      short_id: row.short_id,
      refines_generation_id: row.refines_generation_id,
      kind: row.request_kind,
      method,
      phase: workbenchPhase(row.request_kind, method),
      options,
      rating: row.rating,
      delivered: isDeliveredRequest({ kind: row.request_kind, parameters_json: row.parameters_json }),
      image_width: row.image_width,
      image_height: row.image_height,
      image_size: row.image_size,
      created_at: row.created_at,
    };
  });

  const idByRef = new Map<string, string>();
  for (const n of nodes) {
    idByRef.set(n.id, n.id);
    idByRef.set(n.short_id, n.id);
  }
  const refs = JSON.stringify([...idByRef.keys()]);
  const pendingRows = await db
    .prepare(
      `SELECT id, kind, status, payload_json, created_at FROM requests
       WHERE kind IN ('redraw', 'repair', 'masked_redraw', 'deliver', 'dof')
         AND status IN ('queued', 'running')
         AND json_extract(payload_json, '$.generation_id') IN (SELECT value FROM json_each(?))
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(refs)
    .all<{ id: string; kind: RequestKind; status: RequestStatus; payload_json: string; created_at: string }>();

  const pending: WorkbenchPending[] = [];
  for (const row of pendingRows.results ?? []) {
    const source = idByRef.get((JSON.parse(row.payload_json) as { generation_id: string }).generation_id);
    if (!source) continue;
    const options = parseOptions(row.payload_json);
    const method = methodOf(row.kind, options);
    pending.push({
      request_id: row.id,
      kind: row.kind,
      method,
      phase: workbenchPhase(row.kind, method),
      options,
      source_generation_id: source,
      status: row.status,
      created_at: row.created_at,
    });
  }
  return { root_id: root.id, nodes, pending };
}

async function requireRoot(db: D1Database, rootRef: string): Promise<GenerationRow> {
  const root = await getGenerationByIdOrShortId(db, rootRef);
  if (!root) throw notFound('generation');
  if (root.refines_generation_id) throw badRequest(`generation '${root.short_id}' is not a raw Generation; use its root`);
  return root;
}

interface WorkbenchRow {
  picks_json: string;
  updated_at: string;
}

export async function getWorkbench(db: D1Database, rootRef: string) {
  const root = await requireRoot(db, rootRef);
  const row = await db.prepare('SELECT picks_json, updated_at FROM workbenches WHERE root_generation_id = ?').bind(root.id).first<WorkbenchRow>();
  return {
    root_generation_id: root.id,
    picks: row ? (JSON.parse(row.picks_json) as WorkbenchPicks) : {},
    updated_at: row?.updated_at ?? null,
  };
}

export async function putWorkbench(db: D1Database, rootRef: string, picks: WorkbenchPicks) {
  const root = await requireRoot(db, rootRef);
  const normalized: WorkbenchPicks = {};
  const wanted = Object.entries(picks).flatMap(([phase, pick]) => ('generation_id' in pick ? [[phase, pick.generation_id] as const] : []));
  const ids = new Map<string, string>();
  if (wanted.length > 0) {
    const { results } = await db
      .prepare(`${SUBTREE_CTE} SELECT g.id, g.short_id FROM generations g JOIN subtree s ON s.id = g.id`)
      .bind(root.id)
      .all<{ id: string; short_id: string }>();
    for (const g of results ?? []) {
      ids.set(g.id, g.id);
      ids.set(g.short_id, g.id);
    }
  }
  for (const [phase, pick] of Object.entries(picks)) {
    if ('skip' in pick) {
      normalized[phase] = pick;
      continue;
    }
    const id = ids.get(pick.generation_id);
    if (!id) throw badRequest(`picks.${phase}: generation '${pick.generation_id}' is not in the subtree of '${root.short_id}'`);
    normalized[phase] = { generation_id: id };
  }

  const now = nowIso();
  const picksJson = JSON.stringify(normalized);
  await db
    .prepare(
      `INSERT INTO workbenches (id, root_generation_id, picks_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (root_generation_id) DO UPDATE SET picks_json = excluded.picks_json, updated_at = excluded.updated_at`,
    )
    .bind(uuidv7(), root.id, picksJson, now, now)
    .run();
  return { root_generation_id: root.id, picks: normalized, updated_at: now };
}
