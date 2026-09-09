// Generation detail / 一覧のドメインロジック。REST (src/routes/generations.ts) と
// MCP tool `get_generation` / `list_generations` (src/mcp.ts) の両方がここを呼ぶ —
// どちらも GET /api/v1/generations{,/id} と同じ形を返す。

import { normalizeDateRange, parsePagination, toBool } from './db';
import { canonicalGenerationUrl, generationImageUrl } from './serialize';
import { listTagsForTarget } from './tags';
import { renderFactsForJob } from './render-facts';
import { isUuid } from './uuidv7';
import type { BatchReferenceRow, BatchRow, CharacterRow, ComfyJobRow, GenerationRow } from '../types';

function parseSemantic(row: GenerationRow) {
  if (!row.semantic_json) return null;
  return JSON.parse(row.semantic_json) as unknown;
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
  const context = await buildContext(db, org, generation);

  const [batch, job] = await Promise.all([
    db.prepare('SELECT * FROM batches WHERE id = ?').bind(generation.batch_id).first<BatchRow>(),
    db.prepare('SELECT * FROM comfy_jobs WHERE id = ?').bind(generation.comfy_job_id).first<ComfyJobRow>(),
  ]);
  const renderFacts = job ? await renderFactsForJob(db, job) : null;

  return {
    ...context,
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
}

/** GET /api/v1/generations の一覧 + フィルタ。MCP tool `list_generations` もここを呼ぶ。 */
export async function queryGenerations(
  db: D1Database,
  query: Record<string, string | undefined>,
  org: string,
): Promise<{ items: GenerationListItem[]; total: number }> {
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
  if (query.rating) {
    conditions.push('g.rating = ?');
    binds.push(query.rating);
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM generations g ${where}`)
    .bind(...binds)
    .first<{ total: number }>();

  const { results } = await db
    .prepare(
      `SELECT g.*, ch.name AS character_name, json_group_array(t.name) AS tag_names_json
       FROM generations g
       LEFT JOIN characters ch ON ch.id = g.character_id
       LEFT JOIN generation_tags gt ON gt.generation_id = g.id
       LEFT JOIN tags t ON t.id = gt.tag_id
       ${where}
       GROUP BY g.id
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<GenerationRow & { character_name: string | null; tag_names_json: string }>();

  const items = (results ?? []).map((r) => {
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
    };
  });

  return { items, total: countRow?.total ?? 0 };
}
