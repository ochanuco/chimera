import { Hono } from 'hono';
import { updateJobSchema, ingestMetadataSchema } from '../schemas/jobs';
import { uuidv7 } from '../lib/uuidv7';
import { createUniqueShortId } from '../lib/shortid';
import { nowIso } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { canonicalGenerationUrl, serializeJob } from '../lib/serialize';
import { parsePngDimensions } from '../lib/image-meta';
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
  if (body.graph !== undefined) {
    sets.push('graph = ?');
    binds.push(JSON.stringify(body.graph));
  }
  sets.push('updated_at = ?');
  const now = nowIso();
  binds.push(now, job.id);

  await db.prepare(`UPDATE comfy_jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await getJobOr404(db, job.id);
  return c.json(serializeJob(updated));
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

  const imageBuffer = await image.arrayBuffer();
  const contentType = image.type || 'image/png';
  const origin = new URL(c.req.url).origin;
  const dimensions = parsePngDimensions(new Uint8Array(imageBuffer));
  const imageWidth = dimensions?.width ?? null;
  const imageHeight = dimensions?.height ?? null;
  const imageSize = imageBuffer.byteLength;

  const respond = (g: Pick<GenerationRow, 'id' | 'short_id' | 'r2_object_key'>, status: 200 | 201) =>
    c.json(
      {
        id: g.id,
        short_id: g.short_id,
        canonical_url: canonicalGenerationUrl(origin, g.short_id),
        r2_object_key: g.r2_object_key,
      },
      status,
    );

  // Replay path for a prior ingest that inserted the row but failed before the
  // R2 PUT completed: the row already fixes the object key, so re-upload there.
  const ensureObject = async (g: Pick<GenerationRow, 'r2_object_key'>) => {
    const head = await c.env.IMAGES.head(g.r2_object_key);
    if (!head) {
      await c.env.IMAGES.put(g.r2_object_key, imageBuffer, { httpMetadata: { contentType } });
    }
  };

  const existing = await db
    .prepare('SELECT * FROM generations WHERE comfy_job_id = ? AND comfy_output_index = ?')
    .bind(job.id, metadata.comfy_output_index)
    .first<GenerationRow>();
  if (existing) {
    await ensureObject(existing);
    if (job.status !== 'ingested') {
      await db.prepare('UPDATE comfy_jobs SET status = ?, updated_at = ? WHERE id = ?').bind('ingested', nowIso(), job.id).run();
    }
    return respond(existing, 200);
  }

  const id = uuidv7();
  const shortId = await createUniqueShortId(db, 'generations');
  const r2ObjectKey = `generations/${id}/original.png`;
  const now = nowIso();

  // D1 first: committing the row fixes the Generation ID / R2 key before any R2
  // write, so a failure at either store leaves no orphan object and every retry
  // converges on the same row and key.
  try {
    await db
      .prepare(
        `INSERT INTO generations (id, short_id, batch_id, comfy_job_id, character_id, seed, original_filename,
          comfy_output_index, r2_object_key, image_width, image_height, image_size, note, rating, bookmark,
          semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
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
        imageWidth,
        imageHeight,
        imageSize,
        now,
      )
      .run();
  } catch (err) {
    // Concurrent duplicate ingest raced us on the (comfy_job_id, comfy_output_index)
    // unique constraint. Return the row the other request created, making sure the
    // object exists in case the winner has not finished its R2 PUT yet.
    const raced = await db
      .prepare('SELECT * FROM generations WHERE comfy_job_id = ? AND comfy_output_index = ?')
      .bind(job.id, metadata.comfy_output_index)
      .first<GenerationRow>();
    if (!raced) throw err;
    await ensureObject(raced);
    if (job.status !== 'ingested') {
      await db.prepare('UPDATE comfy_jobs SET status = ?, updated_at = ? WHERE id = ?').bind('ingested', nowIso(), job.id).run();
    }
    return respond(raced, 200);
  }

  await c.env.IMAGES.put(r2ObjectKey, imageBuffer, { httpMetadata: { contentType } });

  if (job.status !== 'ingested') {
    await db.prepare('UPDATE comfy_jobs SET status = ?, updated_at = ? WHERE id = ?').bind('ingested', now, job.id).run();
  }

  return respond({ id, short_id: shortId, r2_object_key: r2ObjectKey }, 201);
});
