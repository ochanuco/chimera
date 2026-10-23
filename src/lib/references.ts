// `/references` ページの一覧: kind reference の Request と、worker が result に書いた当てたタグ・外したタグ・積んだ generate (docs/ui.md「参考画像」)。

import type { RequestStatus } from '../types';

export const REFERENCES_PAGE_SIZE = 30;

export interface ReferenceGenerate {
  id: string;
  short_id: string | null;
  status: RequestStatus;
  generation_short_ids: string[];
}

export interface ReferenceItem {
  id: string;
  short_id: string | null;
  status: RequestStatus;
  created_at: string;
  seed: number | null;
  error: string | null;
  pose: string | null;
  /** part 名 → 当てたタグ。worker が done に書く。 */
  applied: Record<string, string[]> | null;
  dropped: string[] | null;
  /** result の generate_request_id が指す generate。行が見つからなければ id だけ持つ。 */
  generate: ReferenceGenerate | { id: string; short_id: null; status: null; generation_short_ids: [] } | null;
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

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
}

function appliedParts(value: unknown): Record<string, string[]> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const parts: Record<string, string[]> = {};
  for (const [part, tags] of Object.entries(value)) {
    const list = stringList(tags);
    if (list && list.length > 0) parts[part] = list;
  }
  return parts;
}

interface ReferenceRow {
  id: string;
  short_id: string | null;
  status: RequestStatus;
  created_at: string;
  error: string | null;
  payload_json: string;
  result_json: string | null;
}

export async function listReferences(db: D1Database, limit = REFERENCES_PAGE_SIZE): Promise<ReferenceItem[]> {
  const { results } = await db
    .prepare(
      `SELECT id, short_id, status, created_at, error, payload_json, result_json FROM requests
       WHERE kind = 'reference' ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<ReferenceRow>();
  const rows = results ?? [];

  const parsed = rows.map((row) => {
    const result = parseObject(row.result_json);
    const generateId = typeof result.generate_request_id === 'string' ? result.generate_request_id : null;
    return { row, result, generateId };
  });

  const generateIds = parsed.map((p) => p.generateId).filter((id): id is string => id !== null);
  const generates = new Map<string, ReferenceGenerate>();
  if (generateIds.length > 0) {
    const placeholders = generateIds.map(() => '?').join(', ');
    const [requests, generations] = await Promise.all([
      db
        .prepare(`SELECT id, short_id, status FROM requests WHERE id IN (${placeholders})`)
        .bind(...generateIds)
        .all<{ id: string; short_id: string | null; status: RequestStatus }>(),
      db
        .prepare(`SELECT request_id, short_id FROM generations WHERE request_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
        .bind(...generateIds)
        .all<{ request_id: string; short_id: string }>(),
    ]);
    for (const r of requests.results ?? []) generates.set(r.id, { ...r, generation_short_ids: [] });
    for (const g of generations.results ?? []) generates.get(g.request_id)?.generation_short_ids.push(g.short_id);
  }

  return parsed.map(({ row, result, generateId }) => {
    const payload = parseObject(row.payload_json);
    return {
      id: row.id,
      short_id: row.short_id,
      status: row.status,
      created_at: row.created_at,
      seed: typeof payload.seed === 'number' ? payload.seed : null,
      error: row.error,
      pose: typeof result.pose === 'string' ? result.pose : null,
      applied: appliedParts(result.applied),
      dropped: stringList(result.dropped),
      generate: generateId ? (generates.get(generateId) ?? { id: generateId, short_id: null, status: null, generation_short_ids: [] }) : null,
    };
  });
}
