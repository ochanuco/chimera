import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createBatch, createJob, ingestGeneration } from './helpers';

describe('Generation ingest', () => {
  it('stores the image in R2 and registers the Generation in D1', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);

    const result = await ingestGeneration(job.body.id, {
      seed: 999,
      original_filename: 'yk-lineT3_00001_.png',
      comfy_output_index: 0,
    });

    expect(result.status).toBe(201);
    expect(result.body.id).toBeTruthy();
    expect(result.body.short_id).toMatch(/^[a-z0-9]{6}$/);
    expect(result.body.canonical_url).toBe(`https://chimera.test/g/${result.body.short_id}`);
    expect(result.body.r2_object_key).toBe(`generations/${result.body.id}/original.png`);

    const object = await env.IMAGES.get(result.body.r2_object_key);
    expect(object).not.toBeNull();
  });

  it('does not duplicate on repeated ingest for the same (job, output_index)', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const metadata = { seed: 1, original_filename: 'dup.png', comfy_output_index: 0 };

    const first = await ingestGeneration(job.body.id, metadata);
    expect(first.status).toBe(201);

    const second = await ingestGeneration(job.body.id, metadata);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM generations WHERE comfy_job_id = ?')
      .bind(job.body.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('re-uploads a missing R2 object when the same ingest is replayed', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const metadata = { seed: 7, original_filename: 'replay.png', comfy_output_index: 0 };

    const first = await ingestGeneration(job.body.id, metadata);
    expect(first.status).toBe(201);

    // Simulate a partial failure where the row was committed but the R2 PUT was lost.
    await env.IMAGES.delete(first.body.r2_object_key);

    const replay = await ingestGeneration(job.body.id, metadata);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.r2_object_key).toBe(first.body.r2_object_key);

    const object = await env.IMAGES.get(first.body.r2_object_key);
    expect(object).not.toBeNull();
  });

  it('allows multiple outputs from the same job at different output indices', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);

    const first = await ingestGeneration(job.body.id, {
      seed: 1,
      original_filename: 'a.png',
      comfy_output_index: 0,
    });
    const second = await ingestGeneration(job.body.id, {
      seed: 1,
      original_filename: 'b.png',
      comfy_output_index: 1,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it('404s when the job does not exist', async () => {
    const result = await ingestGeneration(crypto.randomUUID(), {
      seed: 1,
      original_filename: 'x.png',
      comfy_output_index: 0,
    });
    expect(result.status).toBe(404);
  });

  it('persists image_width/image_height/image_size on the Generation row', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x02, 0x80, // width = 640
      0x00, 0x00, 0x01, 0xe0, // height = 480
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
      0x00, 0x00, 0x00, 0x00, // CRC (unchecked)
    ]);
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const result = await ingestGeneration(
      job.body.id,
      { seed: 1, original_filename: 'meta.png', comfy_output_index: 0 },
      png,
    );
    expect(result.status).toBe(201);

    const row = await env.DB.prepare('SELECT image_width, image_height, image_size FROM generations WHERE id = ?')
      .bind(result.body.id)
      .first<{ image_width: number; image_height: number; image_size: number }>();
    expect(row?.image_width).toBe(640);
    expect(row?.image_height).toBe(480);
    expect(row?.image_size).toBe(png.byteLength);
  });

  it('persists a NULL width/height but a non-NULL image_size for a non-PNG image', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const result = await ingestGeneration(
      job.body.id,
      { seed: 1, original_filename: 'not-a-png.bin', comfy_output_index: 0 },
      bytes,
    );
    expect(result.status).toBe(201);

    const row = await env.DB.prepare('SELECT image_width, image_height, image_size FROM generations WHERE id = ?')
      .bind(result.body.id)
      .first<{ image_width: number | null; image_height: number | null; image_size: number }>();
    expect(row?.image_width).toBeNull();
    expect(row?.image_height).toBeNull();
    expect(row?.image_size).toBe(bytes.byteLength);
  });
});
