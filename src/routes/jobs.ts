import { Hono } from 'hono';
import { updateJobSchema, ingestMetadataSchema } from '../schemas/jobs';
import { uuidv7 } from '../lib/uuidv7';
import { createUniqueShortId } from '../lib/shortid';
import { nowIso } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { canonicalGenerationUrl } from '../lib/serialize';
import type { AppEnv, ComfyJobRow, GenerationRow } from '../types';

export const jobs = new Hono<AppEnv>();

async function getJobOr404(db: D1Database, id: string): Promise<ComfyJobRow> {
  const row = await db.prepare('SELECT * FROM comfy_jobs WHERE id = ?').bind(id).first<ComfyJobRow>();
  if (!row) throw notFound('job');
  return row;
}

jobs.patch('/:jobId', async (c) => {
  const body = updateJobSchema.parse(await c.req.json());
  const db = c.env.DB;
  const job = await getJobOr404(db, c.req.param('jobId'));

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.status !== undefined) {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.comfy_prompt_id !== undefined) {
    sets.push('comfy_prompt_id = ?');
    binds.push(body.comfy_prompt_id);
  }
  sets.push('updated_at = ?');
  const now = nowIso();
  binds.push(now, job.id);

  await db.prepare(`UPDATE comfy_jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await getJobOr404(db, job.id);
  return c.json({
    id: updated.id,
    batch_id: updated.batch_id,
    comfy_prompt_id: updated.comfy_prompt_id,
    seed: updated.seed,
    index: updated.job_index,
    status: updated.status,
    updated_at: updated.updated_at,
  });
});

jobs.post('/:jobId/generations', async (c) => {
  const db = c.env.DB;
  const job = await getJobOr404(db, c.req.param('jobId'));

  const form = await c.req.parseBody();
  const metadataRaw = form['metadata'];
  const image = form['image'];

  if (typeof metadataRaw !== 'string') throw badRequest('metadata field is required and must be a JSON string');
  if (!(image instanceof File)) throw badRequest('image field is required and must be binary');

  let metadataJson: unknown;
  try {
    metadataJson = JSON.parse(metadataRaw);
  } catch {
    throw badRequest('metadata is not valid JSON');
  }
  const metadata = ingestMetadataSchema.parse(metadataJson);

  if (metadata.character_id) {
    const character = await db
      .prepare('SELECT 1 FROM characters WHERE id = ?')
      .bind(metadata.character_id)
      .first();
    if (!character) throw notFound('character');
  }

  const existing = await db
    .prepare('SELECT * FROM generations WHERE comfy_job_id = ? AND comfy_output_index = ?')
    .bind(job.id, metadata.comfy_output_index)
    .first<GenerationRow>();
  if (existing) {
    return c.json(
      {
        id: existing.id,
        short_id: existing.short_id,
        canonical_url: canonicalGenerationUrl(new URL(c.req.url).origin, existing.short_id),
        r2_object_key: existing.r2_object_key,
      },
      200,
    );
  }

  const id = uuidv7();
  const shortId = await createUniqueShortId(db, 'generations');
  const r2ObjectKey = `generations/${id}/original.png`;
  const now = nowIso();

  await c.env.IMAGES.put(r2ObjectKey, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/png' },
  });

  try {
    await db
      .prepare(
        `INSERT INTO generations (id, short_id, batch_id, comfy_job_id, character_id, seed, original_filename,
          comfy_output_index, r2_object_key, note, rating, bookmark, semantic_schema_version, summary,
          semantic_json, summary_status, summary_model, summary_updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      )
      .bind(
        id,
        shortId,
        job.batch_id,
        job.id,
        metadata.character_id ?? null,
        metadata.seed,
        metadata.original_filename,
        metadata.comfy_output_index,
        r2ObjectKey,
        now,
      )
      .run();
  } catch (err) {
    // Concurrent duplicate ingest raced us on the (comfy_job_id, comfy_output_index)
    // unique constraint. Return the row the other request created.
    const raced = await db
      .prepare('SELECT * FROM generations WHERE comfy_job_id = ? AND comfy_output_index = ?')
      .bind(job.id, metadata.comfy_output_index)
      .first<GenerationRow>();
    if (!raced) throw err;
    return c.json(
      {
        id: raced.id,
        short_id: raced.short_id,
        canonical_url: canonicalGenerationUrl(new URL(c.req.url).origin, raced.short_id),
        r2_object_key: raced.r2_object_key,
      },
      200,
    );
  }

  if (job.status !== 'ingested') {
    await db.prepare('UPDATE comfy_jobs SET status = ?, updated_at = ? WHERE id = ?').bind('ingested', now, job.id).run();
  }

  return c.json(
    {
      id,
      short_id: shortId,
      canonical_url: canonicalGenerationUrl(new URL(c.req.url).origin, shortId),
      r2_object_key: r2ObjectKey,
    },
    201,
  );
});
