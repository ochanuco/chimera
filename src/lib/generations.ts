// Generation detail / 一覧のドメインロジック。REST (src/routes/generations.ts) と
// MCP tool `get_generation` / `list_generations` (src/mcp.ts) の両方がここを呼ぶ —
// どちらも GET /api/v1/generations{,/id} と同じ形を返す。

import { normalizeDateRange, parsePagination, resolveGenerationShortIds, toBool } from './db';
import { canonicalGenerationUrl, generationImageUrl } from './serialize';
import { listTagsForTarget } from './tags';
import { listPublicationsForGeneration, serializePublication } from './publications';
import { renderFactsForJob } from './render-facts';
import { getPoseReferenceOfGeneration, type GenerationPoseReference } from './preset-references';
import { isUuid } from './uuidv7';
import { badRequest } from './errors';
import type { BatchReferenceRow, BatchRow, CharacterRow, ComfyJobRow, GenerationRow, RequestStatus } from '../types';

function parseSemantic(row: GenerationRow) {
  if (!row.semantic_json) return null;
  return JSON.parse(row.semantic_json) as unknown;
}

export interface PromptNotReusable {
  reason: 'repair' | 'masked_redraw' | 'finalize_repair';
  message: string;
}

const PROMPT_NOT_REUSABLE_MESSAGES: Record<PromptNotReusable['reason'], string> = {
  repair:
    "render_facts prompts here were built for a masked hands/feet repair: face, hair and hood tags were dropped and part tags appended. Do not reuse them as a generate prompt (e.g. a prompt.positive replace) — the character's eyes and hair would be lost. To generate from this image, call derive_request with this Generation; it resolves back to the raw source and carries its recipe forward.",
  masked_redraw:
    "render_facts prompts here were built for a masked region redraw: face, hair and hood tags were dropped and the region's prompt_patch appended. Do not reuse them as a generate prompt (e.g. a prompt.positive replace) — the character's eyes and hair would be lost. To generate from this image, call derive_request with this Generation; it resolves back to the raw source and carries its recipe forward.",
  finalize_repair:
    "this finalize also ran a masked hands/feet repair pass, whose render_facts prompt had face, hair and hood tags dropped. Do not reuse render_facts prompts as a generate prompt (e.g. a prompt.positive replace) — the character's eyes and hair would be lost. To generate from this image, call derive_request with this Generation; it resolves back to the raw source and carries its recipe forward.",
};

/** repair/masked_redraw/hires-chain+repair の Batch は render_facts prompt から face/hair/hood タグを落としている — そのまま generate に転用すると identity を失う。 */
export function promptNotReusable(parametersJson: string | null): PromptNotReusable | null {
  if (!parametersJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(parametersJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const kind = (parsed as Record<string, unknown>).kind;
  if (kind === 'repair' || kind === 'masked_redraw') {
    return { reason: kind, message: PROMPT_NOT_REUSABLE_MESSAGES[kind] };
  }
  if (kind === 'hires-chain') {
    const repair = (parsed as Record<string, unknown>).repair;
    if (repair && typeof repair === 'object') {
      return { reason: 'finalize_repair', message: PROMPT_NOT_REUSABLE_MESSAGES.finalize_repair };
    }
  }
  return null;
}

export async function buildContext(db: D1Database, org: string, generation: GenerationRow) {
  const [character, tags, references] = await Promise.all([
    generation.character_id
      ? db.prepare('SELECT * FROM characters WHERE id = ?').bind(generation.character_id).first<CharacterRow>()
      : Promise.resolve(null),
    listTagsForTarget(db, 'generation_tags', generation.id),
    db
      .prepare('SELECT * FROM batch_references WHERE source_generation_id = ? ORDER BY created_at ASC')
      .bind(generation.id)
      .all<BatchReferenceRow>(),
  ]);

  return {
    id: generation.id,
    short_id: generation.short_id,
    canonical_url: canonicalGenerationUrl(org, generation.short_id),
    image: { url: generationImageUrl(org, generation.short_id) },
    character: character ? { id: character.id, name: character.name } : null,
    created_at: generation.created_at,
    rating: generation.rating,
    bookmark: toBool(generation.bookmark),
    tags: tags.map((t) => t.name),
    note: generation.note,
    summary: generation.summary,
    semantic: parseSemantic(generation),
    batch: { id: generation.batch_id },
    references: (references.results ?? []).map((r) => ({
      id: r.id,
      target_batch_id: r.target_batch_id,
      purpose: r.purpose,
      aspect: r.aspect,
      instruction: r.instruction,
      created_at: r.created_at,
    })),
    // Batches that used this Generation as reference material ("children" via Reference).
    // Same underlying batch_references rows as `references` above (both keyed by
    // source_generation_id = this Generation), kept as a separate field so callers
    // reading "who used me as material" don't have to infer it from `references`.
    used_by: (references.results ?? []).map((r) => ({
      id: r.id,
      batch_id: r.target_batch_id,
      purpose: r.purpose,
      aspect: r.aspect,
      instruction: r.instruction,
      created_at: r.created_at,
    })),
  };
}

/** GET /api/v1/generations/{id} 及び MCP `get_generation` が返す形。 */
export async function getGenerationDetail(db: D1Database, org: string, generation: GenerationRow) {
  const [context, batch, job, publications, poseReference] = await Promise.all([
    buildContext(db, org, generation),
    db.prepare('SELECT * FROM batches WHERE id = ?').bind(generation.batch_id).first<BatchRow>(),
    db.prepare('SELECT * FROM comfy_jobs WHERE id = ?').bind(generation.comfy_job_id).first<ComfyJobRow>(),
    listPublicationsForGeneration(db, generation.id),
    getPoseReferenceOfGeneration(db, generation.id),
  ]);
  const renderFacts = job ? await renderFactsForJob(db, job) : null;

  return {
    ...context,
    publications: publications.map(serializePublication),
    pose_reference: poseReference,
    batch: batch
      ? {
          id: batch.id,
          short_id: batch.short_id,
          prompt: batch.prompt,
          negative_prompt: batch.negative_prompt,
          recipe: batch.recipe,
          raw_instruction: batch.raw_instruction,
          git_commit: batch.git_commit,
          git_dirty: toBool(batch.git_dirty),
        }
      : null,
    comfy_job: job
      ? {
          id: job.id,
          seed: job.seed,
          comfy_prompt_id: job.comfy_prompt_id,
          status: job.status,
          graph: job.graph ? JSON.parse(job.graph) : null,
          render_facts: renderFacts,
          prompt_not_reusable: promptNotReusable(batch?.parameters_json ?? null),
        }
      : null,
    original_filename: generation.original_filename,
  };
}

export interface GenerationListItem {
  id: string;
  short_id: string;
  canonical_url: string;
  image_url: string;
  thumbnail_url: string;
  rating: GenerationRow['rating'];
  bookmark: boolean;
  summary: string | null;
  character: { id: string; name: string | null } | null;
  tags: string[];
  created_at: string;
  batch_id: string;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  /** short_id of the raw Generation this item's Batch refines (finalize/repair/masked_redraw output), or null for a raw Generation. */
  refines_generation_short_id: string | null;
  /** 少なくとも1件の Publication を持つか (docs/domain-model.md#publication)。 */
  published: boolean;
  /** このGenerationを対象にした最新のfinalize/repair/masked_redraw request (GenerationCardの進捗ピル)。無ければnull。 */
  finalize_request: GenerationFinalizeRequestBadge | null;
  /** このGenerationが pose の基準 render として pin されているか (preset_references, 現行行のみ)。無ければnull。 */
  reference: GenerationPoseReference | null;
}

export interface GenerationFinalizeRequestBadge {
  id: string;
  kind: 'finalize' | 'repair' | 'masked_redraw';
  status: RequestStatus;
  /** result_json.generation_ids[0] を解決したshort_id。done以外、または未解決ならnull。 */
  result_short_id: string | null;
}

/**
 * このページに載る各Generationを対象にした最新のfinalize/repair/masked_redraw requestを1クエリで集める
 * (`GET /api/v1/generations`のfinalize_request、docs/ui.md「Gallery」カードの進捗ピル)。
 * request.payload.generation_id はUUIDでもshort_idでもよい (worker-protocol.md「payload」) ので、
 * 両方をIN句に渡し、行側でどちらのGenerationを指しているか引き直す。created_at DESCで取り、
 * 各Generationについて最初に見つかった行(=最新)だけを採用する。
 */
export async function getLatestFinalizeRequestsForGenerations(
  db: D1Database,
  generations: { id: string; short_id: string }[],
): Promise<Map<string, GenerationFinalizeRequestBadge>> {
  const result = new Map<string, GenerationFinalizeRequestBadge>();
  if (generations.length === 0) return result;

  const targetByPayloadId = new Map<string, string>();
  const payloadIds: string[] = [];
  for (const g of generations) {
    targetByPayloadId.set(g.id, g.id);
    targetByPayloadId.set(g.short_id, g.id);
    payloadIds.push(g.id, g.short_id);
  }

  // D1 の1クエリ bind 数上限 (queryGenerations の ids フィルタと同じ理由、上のコメント参照) を
  // ページサイズ x2 で越えうるので、placeholders ではなく json_each の1 bind にまとめる。
  const { results } = await db
    .prepare(
      `SELECT id, kind, status, payload_json, result_json FROM requests
       WHERE kind IN ('finalize', 'repair', 'masked_redraw')
         AND json_extract(payload_json, '$.generation_id') IN (SELECT value FROM json_each(?))
       ORDER BY created_at DESC`,
    )
    .bind(JSON.stringify(payloadIds))
    .all<{
      id: string;
      kind: GenerationFinalizeRequestBadge['kind'];
      status: RequestStatus;
      payload_json: string;
      result_json: string | null;
    }>();

  const rows = results ?? [];

  // done行のresult.generation_ids[0]をまとめて解決する (行ごとに叩かない)。
  const firstResultGenerationIds: string[] = [];
  for (const r of rows) {
    if (r.status !== 'done' || !r.result_json) continue;
    try {
      const parsed = JSON.parse(r.result_json) as { generation_ids?: string[] };
      if (parsed.generation_ids?.[0]) firstResultGenerationIds.push(parsed.generation_ids[0]);
    } catch {
      // 壊れたresult_jsonは無視 (result_short_id は null のまま)
    }
  }
  const resultShortIds = await resolveGenerationShortIds(db, firstResultGenerationIds);

  for (const r of rows) {
    let payload: { generation_id?: unknown };
    try {
      payload = JSON.parse(r.payload_json) as { generation_id?: unknown };
    } catch {
      continue;
    }
    const payloadGenerationId = typeof payload.generation_id === 'string' ? payload.generation_id : null;
    const targetGenerationId = payloadGenerationId ? targetByPayloadId.get(payloadGenerationId) : undefined;
    if (!targetGenerationId || result.has(targetGenerationId)) continue; // rows は created_at DESC なので既にあれば最新

    let resultShortId: string | null = null;
    if (r.status === 'done' && r.result_json) {
      try {
        const parsed = JSON.parse(r.result_json) as { generation_ids?: string[] };
        const firstId = parsed.generation_ids?.[0];
        resultShortId = firstId ? (resultShortIds.get(firstId) ?? null) : null;
      } catch {
        resultShortId = null;
      }
    }
    result.set(targetGenerationId, { id: r.id, kind: r.kind, status: r.status, result_short_id: resultShortId });
  }

  return result;
}

/** `ids=` の入力上限 (src/routes/pages.tsx の Gallery ids フィルタも同じ上限で使う)。 */
export const MAX_GENERATION_IDS = 100;

function parseIdsParam(raw: string): string[] {
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length > MAX_GENERATION_IDS) {
    throw badRequest(`ids accepts at most ${MAX_GENERATION_IDS} values`);
  }
  return tokens;
}

interface GenerationCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: GenerationCursor): string {
  const bytes = new TextEncoder().encode(`${cursor.createdAt}|${cursor.id}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw: string): GenerationCursor {
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder().decode(bytes);
    const sep = decoded.lastIndexOf('|');
    if (sep === -1) throw new Error('missing separator');
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id) throw new Error('empty part');
    return { createdAt, id };
  } catch {
    throw badRequest('malformed cursor');
  }
}

/** GET /api/v1/generations の一覧 + フィルタ。MCP tool `list_generations` もここを呼ぶ。 */
export async function queryGenerations(
  db: D1Database,
  query: Record<string, string | undefined>,
  org: string,
): Promise<{ items: GenerationListItem[]; total: number; next_cursor: string | null }> {
  const { limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (query.character) {
    if (isUuid(query.character)) {
      conditions.push('g.character_id = ?');
      binds.push(query.character);
    } else {
      conditions.push('g.character_id IN (SELECT id FROM characters WHERE name = ?)');
      binds.push(query.character);
    }
  }
  if (query.tag) {
    conditions.push(
      'EXISTS (SELECT 1 FROM generation_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.generation_id = g.id AND t.name = ?)',
    );
    binds.push(query.tag);
  }
  if (query.published === 'true') {
    conditions.push('EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id)');
  } else if (query.published === 'false') {
    conditions.push('NOT EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id)');
  }
  if (query.reference === 'true') {
    conditions.push('EXISTS (SELECT 1 FROM preset_references pr WHERE pr.generation_id = g.id AND pr.superseded_at IS NULL)');
  } else if (query.reference === 'false') {
    conditions.push('NOT EXISTS (SELECT 1 FROM preset_references pr WHERE pr.generation_id = g.id AND pr.superseded_at IS NULL)');
  }
  if (query.rating) {
    conditions.push('g.rating = ?');
    binds.push(query.rating);
  }
  if (query.exclude_rating) {
    if (!['bad', 'neutral', 'good'].includes(query.exclude_rating)) {
      throw badRequest('exclude_rating must be one of bad, neutral, good');
    }
    conditions.push('(g.rating IS NULL OR g.rating != ?)');
    binds.push(query.exclude_rating);
  }
  if (query.bookmark !== undefined) {
    conditions.push('g.bookmark = ?');
    binds.push(query.bookmark === 'true' ? 1 : 0);
  }
  if (query.comfy_prompt_id) {
    conditions.push('g.comfy_job_id IN (SELECT id FROM comfy_jobs WHERE comfy_prompt_id = ?)');
    binds.push(query.comfy_prompt_id);
  }
  if (query.original_filename) {
    conditions.push('g.original_filename = ?');
    binds.push(query.original_filename);
  }
  const { from, to } = normalizeDateRange(query.from, query.to);
  if (from) {
    conditions.push('g.created_at >= ?');
    binds.push(from);
  }
  if (to) {
    conditions.push('g.created_at <= ?');
    binds.push(to);
  }
  if (query.origin) {
    if (query.origin === 'raw') {
      conditions.push('b.refines_generation_id IS NULL');
    } else if (query.origin === 'refined') {
      conditions.push('b.refines_generation_id IS NOT NULL');
    } else {
      throw badRequest('origin must be "raw" or "refined"');
    }
  }
  if (query.ids) {
    const idTokens = parseIdsParam(query.ids);
    if (idTokens.length === 0) {
      // 全トークンが空白のみ: 「該当なし」を明示的に表す条件にする。
      conditions.push('1 = 0');
    } else {
      // D1 は1クエリの bind 数が100までなので、ids は JSON 配列1個として渡す。
      conditions.push('(g.id IN (SELECT value FROM json_each(?)) OR g.short_id IN (SELECT value FROM json_each(?)))');
      const idsJson = JSON.stringify(idTokens);
      binds.push(idsJson, idsJson);
    }
  }

  const countWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM generations g LEFT JOIN batches b ON b.id = g.batch_id ${countWhere}`)
    .bind(...binds)
    .first<{ total: number }>();

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    conditions.push('(g.created_at < ? OR (g.created_at = ? AND g.id < ?))');
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // 次ページの有無を判定するため limit+1 件取得する。cursor 指定時は offset を無視する
  // (offset ベースのページングと keyset ページングを混在させない)。
  const { results } = await db
    .prepare(
      `SELECT g.*, ch.name AS character_name, json_group_array(t.name) AS tag_names_json,
         rg.short_id AS refines_generation_short_id,
         EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id) AS is_published,
         (SELECT pr.recipe FROM preset_references pr WHERE pr.generation_id = g.id AND pr.superseded_at IS NULL ORDER BY pr.created_at DESC LIMIT 1) AS reference_recipe,
         (SELECT pr.name FROM preset_references pr WHERE pr.generation_id = g.id AND pr.superseded_at IS NULL ORDER BY pr.created_at DESC LIMIT 1) AS reference_pose
       FROM generations g
       LEFT JOIN characters ch ON ch.id = g.character_id
       LEFT JOIN generation_tags gt ON gt.generation_id = g.id
       LEFT JOIN tags t ON t.id = gt.tag_id
       LEFT JOIN batches b ON b.id = g.batch_id
       LEFT JOIN generations rg ON rg.id = b.refines_generation_id
       ${where}
       GROUP BY g.id
       ORDER BY g.created_at DESC, g.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit + 1, query.cursor ? 0 : offset)
    .all<
      GenerationRow & {
        character_name: string | null;
        tag_names_json: string;
        refines_generation_short_id: string | null;
        is_published: number;
        reference_recipe: string | null;
        reference_pose: string | null;
      }
    >();

  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id }) : null;

  const finalizeRequests = await getLatestFinalizeRequestsForGenerations(
    db,
    pageRows.map((r) => ({ id: r.id, short_id: r.short_id })),
  );

  const items = pageRows.map((r) => {
    const tagArray = r.tag_names_json ? JSON.parse(r.tag_names_json) : [];
    const tags = Array.isArray(tagArray) ? tagArray.filter((t) => t !== null) : [];
    return {
      id: r.id,
      short_id: r.short_id,
      canonical_url: canonicalGenerationUrl(org, r.short_id),
      image_url: generationImageUrl(org, r.short_id),
      thumbnail_url: generationImageUrl(org, r.short_id),
      rating: r.rating,
      bookmark: toBool(r.bookmark),
      summary: r.summary,
      character: r.character_id ? { id: r.character_id, name: r.character_name } : null,
      tags,
      created_at: r.created_at,
      batch_id: r.batch_id,
      image_width: r.image_width,
      image_height: r.image_height,
      image_size: r.image_size,
      refines_generation_short_id: r.refines_generation_short_id,
      published: toBool(r.is_published),
      finalize_request: finalizeRequests.get(r.id) ?? null,
      reference: r.reference_recipe && r.reference_pose ? { recipe: r.reference_recipe, pose: r.reference_pose } : null,
    };
  });

  return { items, total: countRow?.total ?? 0, next_cursor: nextCursor };
}
