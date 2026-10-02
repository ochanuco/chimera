// Generation の系譜 (lineage) を Request 単位で辿る。MCP tool `get_generation_lineage` 専用
// — REST 側に同等のエンドポイントは無い。ancestors は request_references (素材) と
// generations.refines_generation_id (仕上げ元) を遡り、descendants は逆方向。既に訪れた Request は再訪しない (visited set)。

import { chunk, D1_MAX_BOUND_PARAMS } from './db';
import type { Rating } from '../types';

export const DEFAULT_LINEAGE_DEPTH = 5;
export const MAX_LINEAGE_DEPTH = 10;

export function clampLineageDepth(depth?: number): number {
  if (depth === undefined) return DEFAULT_LINEAGE_DEPTH;
  return Math.min(MAX_LINEAGE_DEPTH, Math.max(0, Math.round(depth)));
}

export interface LineageNode {
  depth: number;
  /** 'reference' は素材参照 (purpose_or_kind = purpose)、'refinement' は仕上げ元 (purpose_or_kind = 仕上げた Request の kind)。 */
  via: 'reference' | 'refinement';
  purpose_or_kind: string | null;
  request: { id: string; short_id: string | null; recipe: string | null; raw_instruction: string | null; created_at: string };
  generations: { short_id: string; rating: Rating | null; semantic_summary: string | null }[];
}

interface Edge {
  requestId: string;
  via: 'reference' | 'refinement';
  purposeOrKind: string | null;
}

async function nextAncestorEdges(db: D1Database, requestIds: string[]): Promise<Edge[]> {
  const edges: Edge[] = [];
  for (const part of chunk(requestIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const [refRows, refineRows] = await Promise.all([
      db
        .prepare(
          `SELECT g.request_id AS other_request_id, rr.purpose AS purpose_or_kind
           FROM request_references rr
           JOIN generations g ON g.id = rr.source_generation_id
           WHERE rr.target_request_id IN (${placeholders}) AND g.request_id IS NOT NULL`,
        )
        .bind(...part)
        .all<{ other_request_id: string; purpose_or_kind: string | null }>(),
      db
        .prepare(
          `SELECT DISTINCT src.request_id AS other_request_id, r.kind AS purpose_or_kind
           FROM generations g
           JOIN generations src ON src.id = g.refines_generation_id
           JOIN requests r ON r.id = g.request_id
           WHERE g.request_id IN (${placeholders}) AND src.request_id IS NOT NULL`,
        )
        .bind(...part)
        .all<{ other_request_id: string; purpose_or_kind: string | null }>(),
    ]);
    for (const r of refRows.results ?? []) edges.push({ requestId: r.other_request_id, via: 'reference', purposeOrKind: r.purpose_or_kind });
    for (const r of refineRows.results ?? []) edges.push({ requestId: r.other_request_id, via: 'refinement', purposeOrKind: r.purpose_or_kind });
  }
  return edges;
}

async function nextDescendantEdges(db: D1Database, requestIds: string[]): Promise<Edge[]> {
  const edges: Edge[] = [];
  for (const part of chunk(requestIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const [refRows, refineRows] = await Promise.all([
      db
        .prepare(
          `SELECT rr.target_request_id AS other_request_id, rr.purpose AS purpose_or_kind
           FROM request_references rr
           JOIN generations g ON g.id = rr.source_generation_id
           WHERE g.request_id IN (${placeholders})`,
        )
        .bind(...part)
        .all<{ other_request_id: string; purpose_or_kind: string | null }>(),
      db
        .prepare(
          `SELECT DISTINCT g.request_id AS other_request_id, r.kind AS purpose_or_kind
           FROM generations g
           JOIN generations src ON src.id = g.refines_generation_id
           JOIN requests r ON r.id = g.request_id
           WHERE src.request_id IN (${placeholders}) AND g.request_id IS NOT NULL`,
        )
        .bind(...part)
        .all<{ other_request_id: string; purpose_or_kind: string | null }>(),
    ]);
    for (const r of refRows.results ?? []) edges.push({ requestId: r.other_request_id, via: 'reference', purposeOrKind: r.purpose_or_kind });
    for (const r of refineRows.results ?? []) edges.push({ requestId: r.other_request_id, via: 'refinement', purposeOrKind: r.purpose_or_kind });
  }
  return edges;
}

type RequestInfo = LineageNode['request'];

async function fetchRequestInfos(db: D1Database, ids: string[]): Promise<Map<string, RequestInfo>> {
  const map = new Map<string, RequestInfo>();
  for (const part of chunk(ids, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id, recipe, raw_instruction, created_at FROM requests WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<RequestInfo>();
    for (const r of results ?? []) map.set(r.id, r);
  }
  return map;
}

async function fetchGenerationInfos(
  db: D1Database,
  requestIds: string[],
): Promise<Map<string, { short_id: string; rating: Rating | null; semantic_summary: string | null }[]>> {
  const map = new Map<string, { short_id: string; rating: Rating | null; semantic_summary: string | null }[]>();
  for (const part of chunk(requestIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT request_id, short_id, rating, summary FROM generations WHERE request_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...part)
      .all<{ request_id: string; short_id: string; rating: Rating | null; summary: string | null }>();
    for (const r of results ?? []) {
      const list = map.get(r.request_id) ?? [];
      list.push({ short_id: r.short_id, rating: r.rating, semantic_summary: r.summary });
      map.set(r.request_id, list);
    }
  }
  return map;
}

async function walk(
  db: D1Database,
  startRequestId: string,
  depth: number,
  nextEdges: (db: D1Database, requestIds: string[]) => Promise<Edge[]>,
): Promise<LineageNode[]> {
  const visited = new Set<string>([startRequestId]);
  const nodes: LineageNode[] = [];
  let frontier = [startRequestId];

  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const edges = await nextEdges(db, frontier);
    const levelIds: string[] = [];
    const firstEdgeByRequestId = new Map<string, Edge>();
    for (const edge of edges) {
      if (visited.has(edge.requestId) || firstEdgeByRequestId.has(edge.requestId)) continue;
      firstEdgeByRequestId.set(edge.requestId, edge);
      levelIds.push(edge.requestId);
    }
    if (levelIds.length === 0) break;
    for (const id of levelIds) visited.add(id);

    const [requestInfos, generationInfos] = await Promise.all([
      fetchRequestInfos(db, levelIds),
      fetchGenerationInfos(db, levelIds),
    ]);

    for (const id of levelIds) {
      const requestInfo = requestInfos.get(id);
      if (!requestInfo) continue; // dangling reference to a deleted request; skip
      const edge = firstEdgeByRequestId.get(id)!;
      nodes.push({
        depth: level,
        via: edge.via,
        purpose_or_kind: edge.purposeOrKind,
        request: requestInfo,
        generations: generationInfos.get(id) ?? [],
      });
    }

    frontier = levelIds.filter((id) => requestInfos.has(id));
  }

  nodes.sort((a, b) => a.depth - b.depth || a.request.created_at.localeCompare(b.request.created_at));
  return nodes;
}

export interface GenerationLineageInput {
  id: string;
  short_id: string;
  request_id: string | null;
}

export async function getGenerationLineage(db: D1Database, generation: GenerationLineageInput, depth?: number) {
  const clampedDepth = clampLineageDepth(depth);
  const requestId = generation.request_id;
  const [ancestors, descendants] = requestId
    ? await Promise.all([
        walk(db, requestId, clampedDepth, nextAncestorEdges),
        walk(db, requestId, clampedDepth, nextDescendantEdges),
      ])
    : [[], []];
  return {
    generation: { id: generation.id, short_id: generation.short_id, request_id: requestId },
    ancestors,
    descendants,
  };
}
