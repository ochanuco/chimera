// 参考画像のページ (docs/ui.md「参考画像」): `/references` の一覧と、`/references/{short_id}` のタグ画面と描いた絵。

import { parseReferenceAnalysis, type ReferenceCandidate } from './reference-renders';
import { REFERENCE_RENDER_POSES } from './request-rules';
import type { RequestRow, RequestStatus } from '../types';

export const REFERENCES_PAGE_SIZE = 30;

export interface ReferenceListItem {
  id: string;
  short_id: string | null;
  status: RequestStatus;
  created_at: string;
  error: string | null;
  renders: number;
}

export async function listReferences(db: D1Database, limit = REFERENCES_PAGE_SIZE): Promise<ReferenceListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.short_id, r.status, r.created_at, r.error,
              (SELECT COUNT(*) FROM requests rr WHERE rr.kind = 'reference_render' AND json_extract(rr.payload_json, '$.reference_request_id') = r.id) AS renders
       FROM requests r WHERE r.kind = 'reference' ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<ReferenceListItem>();
  return results ?? [];
}

export interface ReferenceRenderGeneration {
  id: string;
  short_id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
}

export interface ReferenceRenderItem {
  id: string;
  short_id: string | null;
  status: RequestStatus;
  error: string | null;
  created_at: string;
  pose: string | null;
  seed: number | null;
  applied: Record<string, string[]>;
  /** worker が done の result に書いた generate。done 前と、行が見つからないときは generate の status が null。 */
  generate: { id: string; short_id: string | null; status: RequestStatus | null; error: string | null } | null;
  /** generate が描いた Generation、新しい順。 */
  generations: ReferenceRenderGeneration[];
}

export interface ReferenceDetail {
  id: string;
  short_id: string | null;
  status: RequestStatus;
  error: string | null;
  created_at: string;
  /** worker の提案。許可リストに無ければ bust。 */
  pose: (typeof REFERENCE_RENDER_POSES)[number];
  poses: readonly string[];
  candidates: ReferenceCandidate[];
  renders: ReferenceRenderItem[];
}

function parseObject(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const value = JSON.parse(json) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function appliedParts(value: unknown): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return parts;
  for (const [part, tags] of Object.entries(value)) {
    if (Array.isArray(tags)) parts[part] = tags.filter((t): t is string => typeof t === 'string');
  }
  return parts;
}

/** この reference から描いた reference_render を新しい順に、render → generate → Generation の順に引く。 */
export async function listReferenceRenders(db: D1Database, referenceId: string): Promise<ReferenceRenderItem[]> {
  const { results } = await db
    .prepare(
      `SELECT id, short_id, status, error, created_at, payload_json, result_json FROM requests
       WHERE kind = 'reference_render' AND json_extract(payload_json, '$.reference_request_id') = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(referenceId)
    .all<Pick<RequestRow, 'id' | 'short_id' | 'status' | 'error' | 'created_at' | 'payload_json' | 'result_json'>>();
  const rows = (results ?? []).map((row) => {
    const result = parseObject(row.result_json);
    return { row, payload: parseObject(row.payload_json), generateId: typeof result.generate_request_id === 'string' ? result.generate_request_id : null };
  });

  const generateIds = rows.map((r) => r.generateId).filter((id): id is string => id !== null);
  const generates = new Map<string, { id: string; short_id: string | null; status: RequestStatus; error: string | null }>();
  const generations = new Map<string, ReferenceRenderGeneration[]>();
  if (generateIds.length > 0) {
    const placeholders = generateIds.map(() => '?').join(', ');
    const [reqs, gens] = await Promise.all([
      db
        .prepare(`SELECT id, short_id, status, error FROM requests WHERE id IN (${placeholders})`)
        .bind(...generateIds)
        .all<{ id: string; short_id: string | null; status: RequestStatus; error: string | null }>(),
      db
        .prepare(`SELECT request_id, id, short_id, rating, bookmark FROM generations WHERE request_id IN (${placeholders}) ORDER BY created_at DESC, id DESC`)
        .bind(...generateIds)
        .all<{ request_id: string; id: string; short_id: string; rating: ReferenceRenderGeneration['rating']; bookmark: number }>(),
    ]);
    for (const r of reqs.results ?? []) generates.set(r.id, r);
    for (const g of gens.results ?? []) {
      const list = generations.get(g.request_id) ?? [];
      list.push({ id: g.id, short_id: g.short_id, rating: g.rating, bookmark: g.bookmark === 1 });
      generations.set(g.request_id, list);
    }
  }

  return rows.map(({ row, payload, generateId }) => ({
    id: row.id,
    short_id: row.short_id,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    pose: typeof payload.pose === 'string' ? payload.pose : null,
    seed: typeof payload.seed === 'number' ? payload.seed : null,
    applied: appliedParts(payload.applied),
    generate: generateId ? (generates.get(generateId) ?? { id: generateId, short_id: null, status: null, error: null }) : null,
    generations: generateId ? (generations.get(generateId) ?? []) : [],
  }));
}

export async function getReferenceDetail(db: D1Database, source: RequestRow): Promise<ReferenceDetail> {
  const analysis = parseReferenceAnalysis(source.status === 'done' ? source.result_json : null);
  const pose = REFERENCE_RENDER_POSES.find((p) => p === analysis.pose) ?? 'bust';
  return {
    id: source.id,
    short_id: source.short_id,
    status: source.status,
    error: source.error,
    created_at: source.created_at,
    pose,
    poses: REFERENCE_RENDER_POSES,
    candidates: analysis.candidates,
    renders: await listReferenceRenders(db, source.id),
  };
}

/** タグ画面と描いた絵の一覧が、待つべきものを抱えているか（解析中、または描き終わっていない render / generate）。 */
export function referencePending(detail: ReferenceDetail): boolean {
  const open = (s: RequestStatus | null | undefined) => s === 'queued' || s === 'running';
  if (open(detail.status)) return true;
  return detail.renders.some((r) => open(r.status) || (r.status === 'done' && (r.generate === null || open(r.generate.status) || r.generate.status === null)));
}
