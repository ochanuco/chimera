// reference_render の作成: 元の reference の解析結果（result の candidates）に照らして、選ばれたタグを検査する (docs/worker-protocol.md「reference_render」)。

import { ApiError, badRequest, notFound } from './errors';
import type { RequestRow } from '../types';

export interface ReferenceCandidate {
  tag: string;
  part: string;
  score: number | null;
  kept: boolean;
  d1: number | null;
  applied: boolean;
}

export interface ReferenceAnalysis {
  candidates: ReferenceCandidate[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** reference の done の result から候補を読む。形の崩れた候補は落とす。 */
export function parseReferenceAnalysis(resultJson: string | null): ReferenceAnalysis {
  let result: Record<string, unknown> | null = null;
  try {
    result = asObject(resultJson ? JSON.parse(resultJson) : null);
  } catch {
    result = null;
  }
  const candidates: ReferenceCandidate[] = [];
  for (const raw of Array.isArray(result?.candidates) ? result.candidates : []) {
    const c = asObject(raw);
    if (!c || typeof c.tag !== 'string' || typeof c.part !== 'string') continue;
    candidates.push({
      tag: c.tag,
      part: c.part,
      score: typeof c.score === 'number' ? c.score : null,
      kept: c.kept === true,
      d1: typeof c.d1 === 'number' ? c.d1 : null,
      applied: c.applied === true,
    });
  }
  return { candidates };
}

export async function getReferenceByIdOrShortId(db: D1Database, idOrShortId: string): Promise<RequestRow> {
  const row = await db
    .prepare(`SELECT * FROM requests WHERE kind = 'reference' AND (id = ? OR short_id = ?)`)
    .bind(idOrShortId, idOrShortId)
    .first<RequestRow>();
  if (!row) throw notFound('reference request');
  return row;
}

/** 元の reference が done で、applied の各 (part, tag) がその候補に同じ part で在ることを確かめ、空の part を落とした applied を返す。 */
export function checkReferenceRenderTags(source: RequestRow, applied: Record<string, string[]>): Record<string, string[]> {
  if (source.status !== 'done') {
    throw new ApiError(400, 'reference_not_analyzed', `reference '${source.short_id ?? source.id}' is ${source.status}, not done`);
  }
  const known = new Set(parseReferenceAnalysis(source.result_json).candidates.map((c) => `${c.part}\u0000${c.tag}`));
  const unknown: string[] = [];
  const normalized: Record<string, string[]> = {};
  for (const [part, tags] of Object.entries(applied)) {
    const unique = Array.from(new Set(tags));
    for (const tag of unique) if (!known.has(`${part}\u0000${tag}`)) unknown.push(`${part}: ${tag}`);
    if (unique.length > 0) normalized[part] = unique;
  }
  if (unknown.length > 0) throw badRequest(`not a candidate of the analysis: ${unknown.join(', ')}`);
  return normalized;
}
