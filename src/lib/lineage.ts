// Generation の系譜 (lineage) を Batch 単位で辿る。MCP tool
// `get_generation_lineage` (src/mcp.ts) 専用 — REST 側に同等のエンドポイントは無い。
//
// ancestors: このBatchが材料として使った側 (batch_references: このBatch →
// source_generation_id が属するBatch) と、このBatchの直接の起点側
// (batch_relations: source_batch_id → このBatch) を遡る。
// descendants はどちらも逆方向。既に訪れたBatchは再訪しない (visited set)。

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
  via: 'reference' | 'relation';
  purpose_or_kind: string | null;
  batch: { id: string; short_id: string; recipe: string | null; raw_instruction: string | null; created_at: string };
  generations: { short_id: string; rating: Rating | null; semantic_summary: string | null }[];
}

interface Edge {
  batchId: string;
  via: 'reference' | 'relation';
  purposeOrKind: string | null;
}

async function nextAncestorEdges(db: D1Database, batchIds: string[]): Promise<Edge[]> {
  const edges: Edge[] = [];
  for (const part of chunk(batchIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const [refRows, relRows] = await Promise.all([
      db
        .prepare(
          `SELECT g.batch_id AS ancestor_batch_id, br.purpose AS purpose_or_kind
           FROM batch_references br
           JOIN generations g ON g.id = br.source_generation_id
           WHERE br.target_batch_id IN (${placeholders})`,
        )
        .bind(...part)
        .all<{ ancestor_batch_id: string; purpose_or_kind: string | null }>(),
      db
        .prepare(`SELECT source_batch_id AS ancestor_batch_id, type AS purpose_or_kind FROM batch_relations WHERE target_batch_id IN (${placeholders})`)
        .bind(...part)
        .all<{ ancestor_batch_id: string; purpose_or_kind: string | null }>(),
    ]);
    for (const r of refRows.results ?? []) edges.push({ batchId: r.ancestor_batch_id, via: 'reference', purposeOrKind: r.purpose_or_kind });
    for (const r of relRows.results ?? []) edges.push({ batchId: r.ancestor_batch_id, via: 'relation', purposeOrKind: r.purpose_or_kind });
  }
  return edges;
}

async function nextDescendantEdges(db: D1Database, batchIds: string[]): Promise<Edge[]> {
  const edges: Edge[] = [];
  for (const part of chunk(batchIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const [refRows, relRows] = await Promise.all([
      db
        .prepare(
          `SELECT br.target_batch_id AS descendant_batch_id, br.purpose AS purpose_or_kind
           FROM batch_references br
           JOIN generations g ON g.id = br.source_generation_id
           WHERE g.batch_id IN (${placeholders})`,
        )
        .bind(...part)
        .all<{ descendant_batch_id: string; purpose_or_kind: string | null }>(),
      db
        .prepare(`SELECT target_batch_id AS descendant_batch_id, type AS purpose_or_kind FROM batch_relations WHERE source_batch_id IN (${placeholders})`)
        .bind(...part)
        .all<{ descendant_batch_id: string; purpose_or_kind: string | null }>(),
    ]);
    for (const r of refRows.results ?? []) edges.push({ batchId: r.descendant_batch_id, via: 'reference', purposeOrKind: r.purpose_or_kind });
    for (const r of relRows.results ?? []) edges.push({ batchId: r.descendant_batch_id, via: 'relation', purposeOrKind: r.purpose_or_kind });
  }
  return edges;
}

interface BatchInfo {
  id: string;
  short_id: string;
  recipe: string | null;
  raw_instruction: string | null;
  created_at: string;
}

async function fetchBatchInfos(db: D1Database, ids: string[]): Promise<Map<string, BatchInfo>> {
  const map = new Map<string, BatchInfo>();
  for (const part of chunk(ids, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id, recipe, raw_instruction, created_at FROM batches WHERE id IN (${placeholders})`)
      .bind(...part)
      .all<BatchInfo>();
    for (const r of results ?? []) map.set(r.id, r);
  }
  return map;
}

async function fetchGenerationInfos(
  db: D1Database,
  batchIds: string[],
): Promise<Map<string, { short_id: string; rating: Rating | null; semantic_summary: string | null }[]>> {
  const map = new Map<string, { short_id: string; rating: Rating | null; semantic_summary: string | null }[]>();
  for (const part of chunk(batchIds, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT batch_id, short_id, rating, summary FROM generations WHERE batch_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...part)
      .all<{ batch_id: string; short_id: string; rating: Rating | null; summary: string | null }>();
    for (const r of results ?? []) {
      const list = map.get(r.batch_id) ?? [];
      list.push({ short_id: r.short_id, rating: r.rating, semantic_summary: r.summary });
      map.set(r.batch_id, list);
    }
  }
  return map;
}

async function walk(
  db: D1Database,
  startBatchId: string,
  depth: number,
  nextEdges: (db: D1Database, batchIds: string[]) => Promise<Edge[]>,
): Promise<LineageNode[]> {
  const visited = new Set<string>([startBatchId]);
  const nodes: LineageNode[] = [];
  let frontier = [startBatchId];

  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const edges = await nextEdges(db, frontier);
    const levelIds: string[] = [];
    const firstEdgeByBatchId = new Map<string, Edge>();
    for (const edge of edges) {
      if (visited.has(edge.batchId) || firstEdgeByBatchId.has(edge.batchId)) continue;
      firstEdgeByBatchId.set(edge.batchId, edge);
      levelIds.push(edge.batchId);
    }
    if (levelIds.length === 0) break;
    for (const id of levelIds) visited.add(id);

    const [batchInfos, generationInfos] = await Promise.all([
      fetchBatchInfos(db, levelIds),
      fetchGenerationInfos(db, levelIds),
    ]);

    for (const id of levelIds) {
      const batchInfo = batchInfos.get(id);
      if (!batchInfo) continue; // dangling reference to a deleted batch; skip
      const edge = firstEdgeByBatchId.get(id)!;
      nodes.push({
        depth: level,
        via: edge.via,
        purpose_or_kind: edge.purposeOrKind,
        batch: batchInfo,
        generations: generationInfos.get(id) ?? [],
      });
    }

    frontier = levelIds.filter((id) => batchInfos.has(id));
  }

  nodes.sort((a, b) => a.depth - b.depth || a.batch.created_at.localeCompare(b.batch.created_at));
  return nodes;
}

export interface GenerationLineageInput {
  id: string;
  short_id: string;
  batch_id: string;
}

export async function getGenerationLineage(db: D1Database, generation: GenerationLineageInput, depth?: number) {
  const clampedDepth = clampLineageDepth(depth);
  const [ancestors, descendants] = await Promise.all([
    walk(db, generation.batch_id, clampedDepth, nextAncestorEdges),
    walk(db, generation.batch_id, clampedDepth, nextDescendantEdges),
  ]);
  return {
    generation: { id: generation.id, short_id: generation.short_id, batch_id: generation.batch_id },
    ancestors,
    descendants,
  };
}
