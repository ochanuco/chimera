import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, postJson, req } from './helpers';

describe('Batch API is gone', () => {
  it('serves no /api/v1/batches route, and no /stories or /graph', async () => {
    const id = crypto.randomUUID();
    expect((await postJson('/api/v1/batches', { idempotency_key: crypto.randomUUID() })).status).toBe(404);
    expect((await getJson(`/api/v1/batches/${id}`)).status).toBe(404);
    expect((await postJson(`/api/v1/batches/${id}`, { note: 'x' }, 'PATCH')).status).toBe(404);
    expect((await postJson(`/api/v1/batches/${id}/jobs`, { idempotency_key: 'k', seed: 1, index: 0 })).status).toBe(404);
    expect((await postJson(`/api/v1/batches/${id}/references`, { source_generation_id: id })).status).toBe(404);
    expect((await postJson(`/api/v1/batches/${id}/relations`, { source_batch_id: id, actor: 'human' })).status).toBe(404);
    expect((await getJson('/api/v1/stories')).status).toBe(404);
    expect((await getJson('/api/v1/graph')).status).toBe(404);
  });

  it('keeps Batch out of the Generation detail, context and Job responses', async () => {
    const { generation, job } = await createGeneration();
    const detail = await getJson<Record<string, unknown>>(`/api/v1/generations/${generation.id}`);
    const context = await getJson<Record<string, unknown>>(`/api/v1/generations/${generation.id}/context`);
    expect(detail.body).not.toHaveProperty('batch');
    expect(context.body).not.toHaveProperty('batch');

    const patched = await postJson<Record<string, unknown>>(`/api/v1/jobs/${job.id}`, { graph: { '1': { class_type: 'X', inputs: {} } } }, 'PATCH');
    expect(patched.status).toBe(200);
    expect(patched.body).not.toHaveProperty('batch_id');
    expect(patched.body).toHaveProperty('id', job.id);
  });

  it('accepts and ignores refinement / story keys in request.json', async () => {
    for (const extra of [
      { refinement: null, story: null },
      { refinement: { source_batch_id: 'gone', actor: 'claude' }, story: { story_id: 'gone', previous_batch_ids: ['gone'] } },
    ]) {
      const res = await postJson('/api/v1/requests', {
        kind: 'generate',
        payload: {
          schema_version: 1,
          request: { instruction: 'compat', count: 1 },
          generation: { recipe: 'yukari', parameters: {} },
          ...extra,
        },
        idempotency_key: crypto.randomUUID(),
        created_by: 'brain',
      });
      expect(res.status).toBe(201);
    }
  });

  it('deleting a tag drops its generation and experiment assignments', async () => {
    const { generation } = await createGeneration();
    const tagged = await postJson<{ id: string; name: string }>(`/api/v1/generations/${generation.id}/tags`, { name: `t-${crypto.randomUUID().slice(0, 8)}` });
    expect(tagged.status).toBe(201);

    const res = await req(`/api/v1/tags/${tagged.body.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    const detail = await getJson<{ tags: string[] }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.tags).not.toContain(tagged.body.name);
  });
});
