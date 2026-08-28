import { Hono } from 'hono';
import { semanticUpdateSchema, ratingUpdateSchema, updateGenerationSchema } from '../schemas/generations';
import { assignTagSchema } from '../schemas/tags';
import { ingestGenerationAssetMetadataSchema } from '../schemas/generation-assets';
import {
  nowIso,
  parsePagination,
  normalizeDateRange,
  toBool,
  getGenerationByIdOrShortId,
} from '../lib/db';
import { isUuid, uuidv7 } from '../lib/uuidv7';
import { assignTag, listTagsForTarget, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { badRequest, notFound } from '../lib/errors';
import {
  canonicalGenerationUrl,
  generationImageUrl,
  serializeGenerationAsset,
} from '../lib/serialize';
import { generationAssetR2Key } from '../lib/generation-assets';
import type {
  AppEnv,
  BatchReferenceRow,
  BatchRow,
  CharacterRow,
  ComfyJobRow,
  GenerationAssetRow,
  GenerationRow,
} from '../types';

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
          graph: job.graph ? JSON.parse(job.graph) : null,
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

async function getGenerationAsset(
  db: D1Database,
  generationId: string,
  role: string,
  region: string,
): Promise<GenerationAssetRow | null> {
  return db
    .prepare('SELECT * FROM generation_assets WHERE generation_id = ? AND role = ? AND region = ?')
    .bind(generationId, role, region)
    .first<GenerationAssetRow>();
}

async function upsertGenerationAsset(
  db: D1Database,
  existing: GenerationAssetRow,
  contentType: string,
  size: number,
  r2Key: string,
  now: string,
): Promise<GenerationAssetRow> {
  await db
    .prepare('UPDATE generation_assets SET content_type = ?, size = ?, r2_object_key = ?, updated_at = ? WHERE id = ?')
    .bind(contentType, size, r2Key, now, existing.id)
    .run();
  return { ...existing, content_type: contentType, size, r2_object_key: r2Key, updated_at: now };
}

// POST /api/v1/generations/{id}/assets — upsert (replace) a layered asset
// (lineart / mask / decomposed layer / PSD / ...) for a Generation, keyed by
// (generation_id, role, region). See docs/domain-model.md.
generations.post('/:id/assets', async (c) => {
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));
  const org = origin(c);

  const form = await c.req.parseBody();
  const metadataRaw = form['metadata'];
  const file = form['file'];

  if (typeof metadataRaw !== 'string') throw badRequest('metadata field is required and must be a JSON string');
  if (!(file instanceof File)) throw badRequest('file field is required and must be binary');

  let metadataJson: unknown;
  try {
    metadataJson = JSON.parse(metadataRaw);
  } catch {
    throw badRequest('metadata is not valid JSON');
  }
  const metadata = ingestGenerationAssetMetadataSchema.parse(metadataJson);

  // '' is the "whole image, no region" sentinel: omitted key and explicit
  // null both normalize to it (see docs/domain-model.md).
  const region = metadata.region ?? '';
  // File#type is '' (not undefined) when the part carries no content type.
  const contentType = metadata.content_type ?? (file.type || 'application/octet-stream');
  const buffer = await file.arrayBuffer();
  const size = buffer.byteLength;
  const r2Key = generationAssetR2Key(generation.id, metadata.role, region, contentType);
  const now = nowIso();

  const putObject = () => c.env.IMAGES.put(r2Key, buffer, { httpMetadata: { contentType } });
  // Replace semantics: only the latest version is kept. A content_type change
  // moves the deterministic key (extension), so drop the superseded object.
  const replaceAsset = async (row: GenerationAssetRow) => {
    const updated = await upsertGenerationAsset(db, row, contentType, size, r2Key, now);
    await putObject();
    if (row.r2_object_key !== r2Key) await c.env.IMAGES.delete(row.r2_object_key);
    return updated;
  };

  const existing = await getGenerationAsset(db, generation.id, metadata.role, region);
  if (existing) {
    const updated = await replaceAsset(existing);
    return c.json(serializeGenerationAsset(updated, org, generation.short_id), 200);
  }

  const id = uuidv7();
  try {
    await db
      .prepare(
        `INSERT INTO generation_assets (id, generation_id, role, region, r2_object_key, content_type, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, generation.id, metadata.role, region, r2Key, contentType, size, now, now)
      .run();
  } catch (err) {
    // Concurrent ingest raced us on the (generation_id, role, region) unique
    // constraint; fall back to the update path for the row the winner created.
    const raced = await getGenerationAsset(db, generation.id, metadata.role, region);
    if (!raced) throw err;
    const updated = await replaceAsset(raced);
    return c.json(serializeGenerationAsset(updated, org, generation.short_id), 200);
  }

  await putObject();
  const created: GenerationAssetRow = {
    id,
    generation_id: generation.id,
    role: metadata.role,
    region,
    r2_object_key: r2Key,
    content_type: contentType,
    size,
    created_at: now,
    updated_at: now,
  };
  return c.json(serializeGenerationAsset(created, org, generation.short_id), 201);
});

// GET /api/v1/generations/{id}/assets — list every layered asset for a Generation.
generations.get('/:id/assets', async (c) => {
  const db = c.env.DB;
  const generation = await getGenerationOr404(db, c.req.param('id'));
  const org = origin(c);

  const { results } = await db
    .prepare('SELECT * FROM generation_assets WHERE generation_id = ? ORDER BY role ASC, region ASC')
    .bind(generation.id)
    .all<GenerationAssetRow>();

  return c.json({
    assets: (results ?? []).map((r) => serializeGenerationAsset(r, org, generation.short_id)),
  });
});
