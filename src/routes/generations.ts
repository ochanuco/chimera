import { Hono } from 'hono';
import { semanticUpdateSchema, ratingUpdateSchema, updateGenerationSchema } from '../schemas/generations';
import { assignTagSchema } from '../schemas/tags';
import {
  nowIso,
  parsePagination,
  normalizeDateRange,
  toBool,
  getGenerationByIdOrShortId,
} from '../lib/db';
import { isUuid } from '../lib/uuidv7';
import { assignTag, listTagsForTarget, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { notFound } from '../lib/errors';
import {
  canonicalGenerationUrl,
  generationImageUrl,
} from '../lib/serialize';
import type { AppEnv, BatchReferenceRow, BatchRow, CharacterRow, ComfyJobRow, GenerationRow } from '../types';

export const generations = new Hono<AppEnv>();

function origin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

async function getGenerationOr404(db: D1Database, idOrShortId: string): Promise<GenerationRow> {
  const row = await getGenerationByIdOrShortId(db, idOrShortId);
  if (!row) throw notFound('generation');
  return row;
}

function parseSemantic(row: GenerationRow) {
  if (!row.semantic_json) return null;
  return JSON.parse(row.semantic_json) as unknown;
}

generations.get('/', async (c) => {
  const db = c.env.DB;
  const query = c.req.query();
  const { limit, offset } = parsePagination(query);
  const org = origin(c);

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
    };
  });

  return c.json({ items, total: countRow?.total ?? 0 });
});

async function buildContext(db: D1Database, org: string, generation: GenerationRow) {
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

generations.get('/:id/context', async (c) => {
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));
  const context = await buildContext(db, origin(c), generation);
  return c.json(context);
});

generations.get('/:id', async (c) => {
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));
  const context = await buildContext(db, origin(c), generation);

  const [batch, job] = await Promise.all([
    db.prepare('SELECT * FROM batches WHERE id = ?').bind(generation.batch_id).first<BatchRow>(),
    db.prepare('SELECT * FROM comfy_jobs WHERE id = ?').bind(generation.comfy_job_id).first<ComfyJobRow>(),
  ]);

  return c.json({
    ...context,
    batch: batch
      ? {
          id: batch.id,
          short_id: batch.short_id,
          prompt: batch.prompt,
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
        }
      : null,
    original_filename: generation.original_filename,
  });
});

generations.patch('/:id', async (c) => {
  const body = updateGenerationSchema.parse(await c.req.json());
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));

  if (body.character_id) {
    const character = await db.prepare('SELECT 1 FROM characters WHERE id = ?').bind(body.character_id).first();
    if (!character) throw notFound('character');
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.note !== undefined) {
    sets.push('note = ?');
    binds.push(body.note);
  }
  if (body.character_id !== undefined) {
    sets.push('character_id = ?');
    binds.push(body.character_id);
  }
  binds.push(generation.id);
  await db.prepare(`UPDATE generations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await getGenerationOr404(db, generation.id);
  return c.json(await buildContext(db, origin(c), updated));
});

generations.put('/:id/semantic', async (c) => {
  const body = semanticUpdateSchema.parse(await c.req.json());
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));

  const semanticPayload = {
    schema_version: body.schema_version,
    core: body.core ?? {},
    strengths: body.strengths ?? [],
    defects: body.defects ?? [],
    attributes: body.attributes ?? {},
  };
  const now = nowIso();

  await db
    .prepare(
      `UPDATE generations SET semantic_schema_version = ?, summary = ?, semantic_json = ?,
        summary_status = 'completed', summary_model = ?, summary_updated_at = ? WHERE id = ?`,
    )
    .bind(
      body.schema_version,
      body.summary ?? null,
      JSON.stringify(semanticPayload),
      body.generated_by?.model ?? null,
      now,
      generation.id,
    )
    .run();

  const updated = await getGenerationOr404(db, generation.id);
  return c.json(await buildContext(db, origin(c), updated));
});

generations.put('/:id/rating', async (c) => {
  const body = ratingUpdateSchema.parse(await c.req.json());
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));

  await db.prepare('UPDATE generations SET rating = ? WHERE id = ?').bind(body.rating, generation.id).run();
  return c.json({ rating: body.rating });
});

generations.put('/:id/bookmark', async (c) => {
  const generation = await getGenerationOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'generations', generation.id, true);
  return c.json({ bookmark: true });
});

generations.delete('/:id/bookmark', async (c) => {
  const generation = await getGenerationOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'generations', generation.id, false);
  return c.json({ bookmark: false });
});

generations.post('/:id/tags', async (c) => {
  const body = assignTagSchema.parse(await c.req.json());
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));
  const { tag, created } = await assignTag(db, 'generation_tags', generation.id, body.name, body.created_by);
  return c.json({ id: tag.id, name: tag.name }, created ? 201 : 200);
});

generations.delete('/:id/tags/:tagId', async (c) => {
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));
  await removeTag(db, 'generation_tags', generation.id, c.req.param('tagId'));
  return c.body(null, 204);
});
