import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, getJson, postJson, req } from './helpers';

describe('Characters', () => {
  it('creates and lists characters', async () => {
    const name = `char-${crypto.randomUUID().slice(0, 8)}`;
    const created = await postJson<{ id: string; name: string; aliases: string[] }>('/api/v1/characters', {
      name,
      aliases: ['alias-a'],
    });
    expect(created.status).toBe(201);
    expect(created.body.aliases).toEqual(['alias-a']);

    const list = await getJson<{ items: { name: string }[] }>('/api/v1/characters');
    expect(list.body.items.some((c) => c.name === name)).toBe(true);
  });

  it('rejects a duplicate character name', async () => {
    const name = `dup-${crypto.randomUUID().slice(0, 8)}`;
    await postJson('/api/v1/characters', { name });
    const second = await postJson('/api/v1/characters', { name });
    expect(second.status).toBe(409);
  });
});

describe('Experiments', () => {
  it('supports create/list/get/patch', async () => {
    const created = await postJson<{ id: string; name: string }>('/api/v1/experiments', {
      name: 'exp-1',
      note: 'initial',
    });
    expect(created.status).toBe(201);

    const got = await getJson<{ id: string; note: string; tags: string[] }>(`/api/v1/experiments/${created.body.id}`);
    expect(got.body.note).toBe('initial');
    expect(got.body.tags).toEqual([]);

    const patched = await postJson<{ note: string }>(
      `/api/v1/experiments/${created.body.id}`,
      { note: 'updated' },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.note).toBe('updated');

    const list = await getJson<{ items: { id: string }[] }>('/api/v1/experiments?limit=200');
    expect(list.body.items.some((e) => e.id === created.body.id)).toBe(true);
  });

  it('a batch can be attached to an experiment', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: 'exp-batch' });
    const batch = await createBatch({ experiment_id: experiment.body.id });
    expect(batch.status).toBe(201);
    expect(batch.body).toMatchObject({ experiment_id: experiment.body.id });
  });
});

describe('Stories list', () => {
  it('reports batch_count for a story', async () => {
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: 'count-story' });
    const b1 = await createBatch();
    const b2 = await createBatch();
    await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
    });

    const list = await getJson<{ items: { id: string; batch_count: number }[] }>('/api/v1/stories');
    const found = list.body.items.find((s) => s.id === story.body.id);
    expect(found?.batch_count).toBe(2);
  });
});

describe('Canonical /g/{short_id} page', () => {
  it('renders the HTML Generation Detail page by default', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain(generation.short_id);
  });

  it('returns JSON pointers when ?format=json is requested', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}?format=json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ canonical_url: generation.canonical_url });
  });

  it('404s for an unknown short_id', async () => {
    const res = await req('/g/zzzzzz');
    expect(res.status).toBe(404);
  });
});
