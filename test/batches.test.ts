import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, getJson, ingestGeneration, postJson, req } from './helpers';

describe('Batch create + idempotency', () => {
  it('returns 201 for a new batch and 200 with the same id on retry', async () => {
    const key = crypto.randomUUID();
    const first = await postJson<{ id: string; short_id: string; status: string }>('/api/v1/batches', {
      idempotency_key: key,
      prompt: 'seed variety',
      recipe: 'dq3',
    });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('created');
    expect(first.body.short_id).toMatch(/^[a-z0-9]{6}$/);

    const retry = await postJson<{ id: string }>('/api/v1/batches', {
      idempotency_key: key,
      prompt: 'seed variety',
      recipe: 'dq3',
    });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
  });

  it('does not duplicate references when a batch create with references is replayed', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();
    const payload = {
      idempotency_key: key,
      prompt: 'mashup',
      references: [{ source_generation_id: generation.id, purpose: 'composition', aspect: 'pose' }],
    };

    const first = await postJson<{ id: string }>('/api/v1/batches', payload);
    expect(first.status).toBe(201);

    const retry = await postJson<{ id: string }>('/api/v1/batches', payload);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    const detail = await getJson<{ references: unknown[] }>(`/api/v1/batches/${first.body.id}`);
    expect(detail.body.references).toHaveLength(1);
  });

  it('accepts explicit null for references / refinement / story per request.json contract', async () => {
    const res = await postJson<{ id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      prompt: 'null fields',
      references: null,
      refinement: null,
      story: null,
    });
    expect(res.status).toBe(201);
  });

  it('warns (without rejecting) when a batch is created with no generation metadata', async () => {
    const empty = await postJson<{ warnings?: string[] }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
    });
    expect(empty.status).toBe(201);
    expect(empty.body.warnings?.length).toBe(1);

    const withPrompt = await postJson<{ warnings?: string[] }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      prompt: 'has metadata',
    });
    expect(withPrompt.status).toBe(201);
    expect(withPrompt.body.warnings).toBeUndefined();
  });

  it('404s when experiment_id does not exist', async () => {
    const res = await postJson('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      experiment_id: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a request without idempotency_key', async () => {
    const res = await postJson('/api/v1/batches', { prompt: 'no key' });
    expect(res.status).toBe(400);
  });

  it('round-trips parameters and git metadata', async () => {
    const res = await postJson<{ parameters: Record<string, unknown>; git_dirty: boolean; git_commit: string }>(
      '/api/v1/batches',
      {
        idempotency_key: crypto.randomUUID(),
        parameters: { cfg: 7.5, steps: 20 },
        git_commit: 'abc1234',
        git_dirty: true,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.parameters).toEqual({ cfg: 7.5, steps: 20 });
    expect(res.body.git_dirty).toBe(true);
    expect(res.body.git_commit).toBe('abc1234');
  });
});

describe('Batch update / list / detail', () => {
  it('updates status via PATCH', async () => {
    const batch = await createBatch();
    const patched = await postJson<{ status: string }>(
      `/api/v1/batches/${batch.body.id}`,
      { status: 'running' },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('running');
  });

  it('accepts short_id in the path', async () => {
    const batch = await createBatch();
    const res = await getJson<{ id: string }>(`/api/v1/batches/${batch.body.short_id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(batch.body.id);
  });

  it('lists batches with generation_count and thumbnail', async () => {
    const { batch } = await createGeneration();

    const list = await getJson<{ items: { id: string; generation_count: number; thumbnail: unknown }[] }>(
      '/api/v1/batches?limit=200',
    );
    expect(list.status).toBe(200);
    const found = list.body.items.find((b) => b.id === batch.id);
    expect(found).toBeTruthy();
    expect(found?.generation_count).toBe(1);
    expect(found?.thumbnail).toBeTruthy();
  });

  it('returns batch detail with jobs, generations, and tags', async () => {
    const { batch, job, generation } = await createGeneration();

    const detail = await getJson<{
      jobs: { id: string }[];
      generations: { id: string }[];
      references: unknown[];
      relations: { outgoing: unknown[]; incoming: unknown[] };
      tags: string[];
    }>(`/api/v1/batches/${batch.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.jobs.map((j) => j.id)).toContain(job.id);
    expect(detail.body.generations.map((g) => g.id)).toContain(generation.id);
    expect(detail.body.references).toEqual([]);
    expect(detail.body.relations.outgoing).toEqual([]);
    expect(detail.body.tags).toEqual([]);
  });

  it('filters list by status and bookmark', async () => {
    const batch = await createBatch();
    await postJson(`/api/v1/batches/${batch.body.id}`, { status: 'completed' }, 'PATCH');
    await req(`/api/v1/batches/${batch.body.id}/bookmark`, { method: 'PUT' });

    const completed = await getJson<{ items: { id: string }[] }>('/api/v1/batches?status=completed&limit=200');
    expect(completed.body.items.some((b) => b.id === batch.body.id)).toBe(true);

    const bookmarked = await getJson<{ items: { id: string }[] }>('/api/v1/batches?bookmark=true&limit=200');
    expect(bookmarked.body.items.some((b) => b.id === batch.body.id)).toBe(true);
  });
});

describe('Job creation idempotency', () => {
  it('returns the same job for a repeated idempotency_key', async () => {
    const batch = await createBatch();
    const key = crypto.randomUUID();
    const first = await postJson<{ id: string }>(`/api/v1/batches/${batch.body.id}/jobs`, {
      idempotency_key: key,
      seed: 42,
      index: 0,
    });
    expect(first.status).toBe(201);

    const retry = await postJson<{ id: string }>(`/api/v1/batches/${batch.body.id}/jobs`, {
      idempotency_key: key,
      seed: 42,
      index: 0,
    });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
  });
});

describe('Batch / Job replay includes resume info (worker-protocol.md)', () => {
  it('POST /api/v1/batches replay returns jobs[] with seed/status/generations after one job is ingested', async () => {
    const batchKey = crypto.randomUUID();
    const batch = await postJson<{ id: string }>('/api/v1/batches', { idempotency_key: batchKey, prompt: 'a test prompt' });
    expect(batch.status).toBe(201);

    const jobKey = crypto.randomUUID();
    const job = await postJson<{ id: string }>(`/api/v1/batches/${batch.body.id}/jobs`, {
      idempotency_key: jobKey,
      seed: 123,
      index: 0,
    });
    expect(job.status).toBe(201);

    const ingest = await ingestGeneration(job.body.id, { seed: 123, original_filename: 'out_00001_.png', comfy_output_index: 0 });
    expect(ingest.status).toBe(201);

    const replay = await postJson<{
      id: string;
      jobs: {
        id: string;
        index: number;
        seed: number;
        status: string;
        comfy_prompt_id: string | null;
        generations: { id: string; comfy_output_index: number }[];
      }[];
    }>('/api/v1/batches', { idempotency_key: batchKey, prompt: 'a test prompt' });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(batch.body.id);
    expect(replay.body.jobs).toHaveLength(1);
    expect(replay.body.jobs[0]).toMatchObject({ id: job.body.id, index: 0, seed: 123, status: 'ingested' });
    expect(replay.body.jobs[0]!.generations).toEqual([{ id: ingest.body.id, comfy_output_index: 0 }]);
  });

  it('POST /api/v1/batches/{id}/jobs create response has comfy_prompt_id/generations for symmetry, and replay returns ingested generations[]', async () => {
    const batch = await createBatch();

    const jobKey = crypto.randomUUID();
    const job = await postJson<{ id: string; comfy_prompt_id: string | null; generations: unknown[] }>(
      `/api/v1/batches/${batch.body.id}/jobs`,
      { idempotency_key: jobKey, seed: 123, index: 0 },
    );
    expect(job.status).toBe(201);
    expect(job.body.comfy_prompt_id).toBeNull();
    expect(job.body.generations).toEqual([]);

    const ingest = await ingestGeneration(job.body.id, { seed: 123, original_filename: 'out_00001_.png', comfy_output_index: 0 });
    expect(ingest.status).toBe(201);

    const replay = await postJson<{
      id: string;
      batch_id: string;
      seed: number;
      index: number;
      status: string;
      comfy_prompt_id: string | null;
      generations: { id: string; comfy_output_index: number }[];
    }>(`/api/v1/batches/${batch.body.id}/jobs`, { idempotency_key: jobKey, seed: 123, index: 0 });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(job.body.id);
    expect(replay.body.status).toBe('ingested');
    expect(replay.body.generations).toEqual([{ id: ingest.body.id, comfy_output_index: 0 }]);
  });
});
