// REST (src/routes/generations.ts) と MCP tool `get_generation`/`list_generations` (src/mcp.ts) の両方がここを呼び、同じ形を返す。

import { normalizeDateRange, parsePagination, resolveGenerationShortIds, toBool } from './db';
import { canonicalGenerationUrl, generationImageUrl, generationPreviewUrl } from './serialize';
import { listTagsForTarget } from './tags';
import { listPublicationsForGeneration, serializePublication } from './publications';
import { getSafetyForGeneration, serializeSafety, type SafetySummary } from './safety';
import { renderFactsForJob, resolveRequestRenderFacts } from './render-facts';
import { drawnPoseView, getPoseReferenceOfGeneration, type GenerationPoseReference } from './preset-references';
import { isUuid } from './uuidv7';
import { badRequest } from './errors';
import type { RequestReferenceRow, CharacterRow, ComfyJobRow, GenerationRow, RequestRow, RequestStatus } from '../types';

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

/** repair/masked_redraw/hires-chain+repair の Request は render_facts prompt から face/hair/hood タグを落としている — そのまま generate に転用すると identity を失う。 */
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

function parseJsonColumn(raw: string | null): unknown {
  return raw ? (JSON.parse(raw) as unknown) : null;
}

/**
 * Generation が属する Request の要約。prompt / negative_prompt は Request に持たず、Request の先頭 Job
 * (job_index 最小で graph を持つもの) の render_facts の先頭 sampler から取る。
 */
async function buildRequestBlock(db: D1Database, request: RequestRow) {
  const [drawnPose, factsByRequest] = await Promise.all([drawnPoseView(db, request), resolveRequestRenderFacts(db, [request.id])]);
  const prompt = factsByRequest.get(request.id)?.samplers[0]?.prompt;
  return {
    id: request.id,
    short_id: request.short_id,
    kind: request.kind,
    recipe: request.recipe,
    raw_instruction: request.raw_instruction,
    prompt: prompt?.positive ?? null,
    negative_prompt: prompt?.negative ?? null,
    parameters: parseJsonColumn(request.parameters_json),
    patches: parseJsonColumn(request.patches_json),
    preset_versions: parseJsonColumn(request.preset_versions_json),
    git_commit: request.git_commit,
    git_dirty: toBool(request.git_dirty),
    drawn_pose: drawnPose,
  };
}

interface RequestGenerationRow {
  id: string;
  short_id: string;
  image_width: number | null;
  image_height: number | null;
  comfy_output_index: number | null;
}

async function loadBuiltContext(db: D1Database, org: string, generation: GenerationRow) {
  const request = generation.request_id
    ? await db.prepare('SELECT * FROM requests WHERE id = ?').bind(generation.request_id).first<RequestRow>()
    : null;
  const [character, tags, references, requestBlock, requestGenerations] = await Promise.all([
    generation.character_id
      ? db.prepare('SELECT * FROM characters WHERE id = ?').bind(generation.character_id).first<CharacterRow>()
      : Promise.resolve(null),
    listTagsForTarget(db, 'generation_tags', generation.id),
    db
      .prepare('SELECT * FROM request_references WHERE source_generation_id = ? ORDER BY created_at ASC')
      .bind(generation.id)
      .all<RequestReferenceRow>(),
    request ? buildRequestBlock(db, request) : Promise.resolve(null),
    generation.request_id
      ? db
          .prepare(
            `SELECT id, short_id, image_width, image_height, comfy_output_index FROM generations
             WHERE request_id = ? ORDER BY created_at ASC, id ASC`,
          )
          .bind(generation.request_id)
          .all<RequestGenerationRow>()
      : Promise.resolve(null),
  ]);

  const context = {
    id: generation.id,
    short_id: generation.short_id,
    canonical_url: canonicalGenerationUrl(org, generation.short_id),
    image: { url: generationImageUrl(org, generation.short_id) },
    original_purged_at: generation.original_purged_at,
    character: character ? { id: character.id, name: character.name } : null,
    created_at: generation.created_at,
    rating: generation.rating,
    bookmark: toBool(generation.bookmark),
    tags: tags.map((t) => t.name),
    note: generation.note,
    summary: generation.summary,
    semantic: parseSemantic(generation),
    request: requestBlock,
    generations: (requestGenerations?.results ?? []) as RequestGenerationRow[],
    references: (references.results ?? []).map((r) => ({
      id: r.id,
      target_request_id: r.target_request_id,
      purpose: r.purpose,
      aspect: r.aspect,
      instruction: r.instruction,
      created_at: r.created_at,
    })),
    // Requests that used this Generation as reference material. Same rows as `references`
    // above, kept as a separate field so "who used me as material" doesn't need inference.
    used_by: (references.results ?? []).map((r) => ({
      id: r.id,
      request_id: r.target_request_id,
      purpose: r.purpose,
      aspect: r.aspect,
      instruction: r.instruction,
      created_at: r.created_at,
    })),
  };
  return { context, request };
}

export async function buildContext(db: D1Database, org: string, generation: GenerationRow) {
  return (await loadBuiltContext(db, org, generation)).context;
}

/** GET /api/v1/generations/{id} 及び MCP `get_generation` が返す形。 */
export async function getGenerationDetail(db: D1Database, org: string, generation: GenerationRow) {
  const [{ context, request }, job, publications, poseReference, safetyRow] = await Promise.all([
    loadBuiltContext(db, org, generation),
    db.prepare('SELECT * FROM comfy_jobs WHERE id = ?').bind(generation.comfy_job_id).first<ComfyJobRow>(),
    listPublicationsForGeneration(db, generation.id),
    getPoseReferenceOfGeneration(db, generation.id),
    getSafetyForGeneration(db, generation.id),
  ]);
  const renderFacts = job ? await renderFactsForJob(db, job) : null;
  const refinesGeneration = generation.refines_generation_id
    ? await db
        .prepare('SELECT id, short_id, rating FROM generations WHERE id = ?')
        .bind(generation.refines_generation_id)
        .first<Pick<GenerationRow, 'id' | 'short_id' | 'rating'>>()
    : null;

  return {
    ...context,
    refines_generation: refinesGeneration ?? null,
    siblings: context.generations.filter((g) => g.id !== generation.id),
    publications: publications.map(serializePublication),
    pose_reference: poseReference,
    safety: safetyRow ? serializeSafety(safetyRow, { includeTags: true }) : null,
    comfy_job: job
      ? {
          id: job.id,
          seed: job.seed,
          comfy_prompt_id: job.comfy_prompt_id,
          status: job.status,
          graph: job.graph ? JSON.parse(job.graph) : null,
          render_facts: renderFacts,
          prompt_not_reusable: promptNotReusable(request?.parameters_json ?? null),
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
  request_id: string | null;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  original_purged_at: string | null;
  /** short_id of the raw Generation this item refines (redraw/deliver/repair/masked_redraw output), or null for a raw Generation. */
  refines_generation_short_id: string | null;
  /** 少なくとも1件の Publication を持つか (docs/domain-model.md#publication)。 */
  published: boolean;
  /** WD tagger の判定 (tags 抜き)。未採点は null。 */
  safety: SafetySummary | null;
  /** このGenerationを対象にした最新のredraw/deliver/repair/masked_redraw (または古いfinalize) request (GenerationCardの進捗ピル)。無ければnull。 */
  finalize_request: GenerationFinalizeRequestBadge | null;
  /** このGenerationが pose の基準 render として pin されているか (preset_references, 現行行のみ)。無ければnull。 */
  reference: GenerationPoseReference | null;
}

export interface GenerationFinalizeRequestBadge {
  id: string;
  kind: 'finalize' | 'redraw' | 'repair' | 'masked_redraw' | 'deliver';
  status: RequestStatus;
  /** result_json.generation_ids[0] を解決したshort_id。done以外、または未解決ならnull。 */
  result_short_id: string | null;
}

/**
 * 各Generationを対象にした最新のrequest (redraw/deliver/repair/masked_redraw、古いfinalizeも) を1クエリで集める。
 * request.payload.generation_id はUUIDでもshort_idでもよい (worker-protocol.md「payload」) ので両方をIN句に渡し、
 * created_at DESCで取って各Generationにつき最初に見つかった行(=最新)だけを採用する。
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

  // D1 の1クエリ bind 数上限をページサイズ x2 で越えうるので、placeholders ではなく json_each の1 bind にまとめる。
  const { results } = await db
    .prepare(
      `SELECT id, kind, status, payload_json, result_json FROM requests
       WHERE kind IN ('finalize', 'redraw', 'repair', 'masked_redraw', 'deliver')
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

export function decodeCursor(raw: string): GenerationCursor {
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

/** 一覧と timeline で共有する絞り込み条件。ページング (cursor / after / created_before) は含めない。 */
function buildGenerationFilter(query: Record<string, string | undefined>): { conditions: string[]; binds: unknown[] } {
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
      conditions.push('g.refines_generation_id IS NULL');
    } else if (query.origin === 'refined') {
      conditions.push('g.refines_generation_id IS NOT NULL');
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

  return { conditions, binds };
}

/** GET /api/v1/generations の一覧 + フィルタ。MCP tool `list_generations` もここを呼ぶ。 */
export async function queryGenerations(
  db: D1Database,
  query: Record<string, string | undefined>,
  org: string,
): Promise<{ items: GenerationListItem[]; total: number; next_cursor: string | null; newer_cursor: string | null }> {
  const { limit, offset } = parsePagination(query);
  const { conditions, binds } = buildGenerationFilter(query);

  const countWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM generations g ${countWhere}`)
    .bind(...binds)
    .first<{ total: number }>();

  // after は新しい方向のページング (結果は新しい順に並べ直す)。cursor / created_before とは併用しない。
  const afterCursor = query.after ? decodeCursor(query.after) : null;
  const filterConditions = [...conditions];
  const filterBinds = [...binds];
  if (afterCursor) {
    conditions.push('(g.created_at > ? OR (g.created_at = ? AND g.id > ?))');
    binds.push(afterCursor.createdAt, afterCursor.createdAt, afterCursor.id);
  } else if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    conditions.push('(g.created_at < ? OR (g.created_at = ? AND g.id < ?))');
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  } else if (query.created_before) {
    conditions.push('g.created_at < ?');
    binds.push(query.created_before);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // 次ページの有無を判定するため limit+1 件取得する。cursor 指定時は offset を無視する
  // (offset ベースのページングと keyset ページングを混在させない)。
  const { results } = await db
    .prepare(
      `SELECT g.*, ch.name AS character_name, json_group_array(t.name) AS tag_names_json,
         rg.short_id AS refines_generation_short_id,
         EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id) AS is_published,
         gs.model AS safety_model, gs.rating_json AS safety_rating_json, gs.tags_json AS safety_tags_json, gs.rated_at AS safety_rated_at,
         (SELECT pr.recipe FROM preset_references pr WHERE pr.generation_id = g.id AND pr.superseded_at IS NULL ORDER BY pr.created_at DESC LIMIT 1) AS reference_recipe,
         (SELECT pr.name FROM preset_references pr WHERE pr.generation_id = g.id AND pr.superseded_at IS NULL ORDER BY pr.created_at DESC LIMIT 1) AS reference_pose
       FROM generations g
       LEFT JOIN characters ch ON ch.id = g.character_id
       LEFT JOIN generation_tags gt ON gt.generation_id = g.id
       LEFT JOIN tags t ON t.id = gt.tag_id
       LEFT JOIN generations rg ON rg.id = g.refines_generation_id
       LEFT JOIN generation_safety gs ON gs.generation_id = g.id
       ${where}
       GROUP BY g.id
       ORDER BY g.created_at ${afterCursor ? 'ASC' : 'DESC'}, g.id ${afterCursor ? 'ASC' : 'DESC'}
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit + 1, query.cursor || afterCursor ? 0 : offset)
    .all<
      GenerationRow & {
        character_name: string | null;
        tag_names_json: string;
        refines_generation_short_id: string | null;
        is_published: number;
        safety_model: string | null;
        safety_rating_json: string | null;
        safety_tags_json: string | null;
        safety_rated_at: string | null;
        reference_recipe: string | null;
        reference_pose: string | null;
      }
    >();

  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  if (afterCursor) pageRows.reverse();
  const firstRow = pageRows[0];
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = !afterCursor && hasMore && lastRow ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id }) : null;

  // 新しい方向に続きがあるときだけ、ページの先頭 (最新) の Generation を指す after カーソルを返す。
  let newerCursor: string | null = null;
  if (firstRow) {
    if (afterCursor) {
      newerCursor = hasMore ? encodeCursor({ createdAt: firstRow.created_at, id: firstRow.id }) : null;
    } else if (query.created_before && !query.cursor) {
      const newer = await db
        .prepare(
          `SELECT 1 AS found FROM generations g WHERE ${[...filterConditions, 'g.created_at >= ?'].join(' AND ')} LIMIT 1`,
        )
        .bind(...filterBinds, query.created_before)
        .first<{ found: number }>();
      newerCursor = newer ? encodeCursor({ createdAt: firstRow.created_at, id: firstRow.id }) : null;
    }
  }

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
      thumbnail_url: generationPreviewUrl(org, r.short_id),
      rating: r.rating,
      bookmark: toBool(r.bookmark),
      summary: r.summary,
      character: r.character_id ? { id: r.character_id, name: r.character_name } : null,
      tags,
      created_at: r.created_at,
      request_id: r.request_id,
      image_width: r.image_width,
      image_height: r.image_height,
      image_size: r.image_size,
      original_purged_at: r.original_purged_at,
      refines_generation_short_id: r.refines_generation_short_id,
      published: toBool(r.is_published),
      safety:
        r.safety_model && r.safety_rating_json && r.safety_tags_json && r.safety_rated_at
          ? serializeSafety(
              {
                generation_id: r.id,
                model: r.safety_model,
                rating_json: r.safety_rating_json,
                tags_json: r.safety_tags_json,
                rated_at: r.safety_rated_at,
              },
              { includeTags: false },
            )
          : null,
      finalize_request: finalizeRequests.get(r.id) ?? null,
      reference: r.reference_recipe && r.reference_pose ? { recipe: r.reference_recipe, pose: r.reference_pose } : null,
    };
  });

  return { items, total: countRow?.total ?? 0, next_cursor: nextCursor, newer_cursor: newerCursor };
}

/** GET /api/v1/generations/timeline: 一覧と同じ絞り込みの枚数を、JST の 15 分枠ごとに新しい順で返す。 */
export async function queryTimeline(
  db: D1Database,
  query: Record<string, string | undefined>,
): Promise<{ slots: { slot: string; count: number }[] }> {
  const { conditions, binds } = buildGenerationFilter(query);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await db
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:', g.created_at, '+9 hours') || printf('%02d', (CAST(strftime('%M', g.created_at) AS INTEGER) / 15) * 15) AS slot,
         COUNT(*) AS count
       FROM generations g
       ${where}
       GROUP BY slot
       ORDER BY slot DESC`,
    )
    .bind(...binds)
    .all<{ slot: string; count: number }>();
  return { slots: results ?? [] };
}
