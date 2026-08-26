import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, getJson, postJson, req, del } from './helpers';

describe('Tags', () => {
  it('assigns a tag to a generation, reuses it by name, and is idempotent', async () => {
    const { generation } = await createGeneration();
    const name = `outfit-good-${crypto.randomUUID().slice(0, 8)}`;

    const first = await postJson<{ id: string; name: string }>(`/api/v1/generations/${generation.id}/tags`, {
      name,
      created_by: 'human',
    });
    expect(first.status).toBe(201);

    const second = await postJson<{ id: string; name: string }>(`/api/v1/generations/${generation.id}/tags`, {
      name,
    });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const context = await getJson<{ tags: string[] }>(`/api/v1/generations/${generation.id}/context`);
    expect(context.body.tags).toEqual([name]);
  });

  it('renames a tag', async () => {
    const { generation } = await createGeneration();
    const name = `rename-me-${crypto.randomUUID().slice(0, 8)}`;
    const created = await postJson<{ id: string }>(`/api/v1/generations/${generation.id}/tags`, { name });

    const renamed = await postJson<{ name: string }>(`/api/v1/tags/${created.body.id}`, { name: `${name}-v2` }, 'PATCH');
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe(`${name}-v2`);
  });

  it('deletes a tag and removes its assignments', async () => {
    const { generation } = await createGeneration();
    const name = `delete-me-${crypto.randomUUID().slice(0, 8)}`;
    const created = await postJson<{ id: string }>(`/api/v1/generations/${generation.id}/tags`, { name });

    const deleted = await del(`/api/v1/tags/${created.body.id}`);
    expect(deleted.status).toBe(204);

    const context = await getJson<{ tags: string[] }>(`/api/v1/generations/${generation.id}/context`);
    expect(context.body.tags).toEqual([]);
  });

  it('removes a single tag assignment via DELETE /generations/{id}/tags/{tagId}', async () => {
    const { generation } = await createGeneration();
    const name = `single-${crypto.randomUUID().slice(0, 8)}`;
    const created = await postJson<{ id: string }>(`/api/v1/generations/${generation.id}/tags`, { name });

    const removed = await del(`/api/v1/generations/${generation.id}/tags/${created.body.id}`);
    expect(removed.status).toBe(204);

    const context = await getJson<{ tags: string[] }>(`/api/v1/generations/${generation.id}/context`);
    expect(context.body.tags).toEqual([]);
  });

  it('supports prefix search via ?q=', async () => {
    const prefix = `zzzq-${crypto.randomUUID().slice(0, 6)}`;
    const { generation } = await createGeneration();
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: `${prefix}-alpha` });
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: `${prefix}-beta` });

    const res = await getJson<{ items: { name: string }[] }>(`/api/v1/tags?q=${prefix}`);
    expect(res.body.items).toHaveLength(2);
  });
});

describe('Bookmark', () => {
  it('toggles bookmark on generations, batches, stories, and experiments', async () => {
    const { generation, batch } = await createGeneration();
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: 'bookmark story' });
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: 'bookmark experiment' });

    for (const path of [
      `/api/v1/generations/${generation.id}/bookmark`,
      `/api/v1/batches/${batch.id}/bookmark`,
      `/api/v1/stories/${story.body.id}/bookmark`,
      `/api/v1/experiments/${experiment.body.id}/bookmark`,
    ]) {
      const put = await req(path, { method: 'PUT' });
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ bookmark: true });

      const delRes = await req(path, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ bookmark: false });
    }
  });
});

describe('Rating', () => {
  it('sets and clears a generation rating', async () => {
    const { generation } = await createGeneration();

    const good = await req(`/api/v1/generations/${generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'good' }),
    });
    expect(good.status).toBe(200);

    const context = await getJson<{ rating: string | null }>(`/api/v1/generations/${generation.id}/context`);
    expect(context.body.rating).toBe('good');

    const cleared = await req(`/api/v1/generations/${generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: null }),
    });
    expect(cleared.status).toBe(200);
    const context2 = await getJson<{ rating: string | null }>(`/api/v1/generations/${generation.id}/context`);
    expect(context2.body.rating).toBeNull();
  });

  it('rejects an invalid rating value', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/api/v1/generations/${generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'excellent' }),
    });
    expect(res.status).toBe(400);
  });
});
