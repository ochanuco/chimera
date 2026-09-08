// Generation detail のドメインロジック。REST (src/routes/generations.ts) と
// MCP tool `get_generation` (src/mcp.ts) の両方がここを呼ぶ — どちらも
// GET /api/v1/generations/{id} と同じ形を返す。

import { toBool } from './db';
import { canonicalGenerationUrl, generationImageUrl } from './serialize';
import { listTagsForTarget } from './tags';
import { renderFactsForJob } from './render-facts';
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
