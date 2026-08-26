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
});
