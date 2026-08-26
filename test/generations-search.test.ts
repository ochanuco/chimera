import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, postJson, req } from './helpers';

interface SearchItem {
  id: string;
  short_id: string;
  rating: string | null;
  bookmark: boolean;
  character: { id: string; name: string } | null;
  tags: string[];
  created_at: string;
}

interface SearchResult {
  items: SearchItem[];
  total: number;
}

describe('Generation search', () => {
  it('filters by character name', async () => {
    const character = await postJson<{ id: string; name: string }>('/api/v1/characters', {
      name: `hamakaze-${crypto.randomUUID().slice(0, 8)}`,
    });
    const { generation } = await createGeneration({ metadata: { character_id: character.body.id } });

    const res = await getJson<SearchResult>(`/api/v1/generations?character=${character.body.name}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((g) => g.id)).toContain(generation.id);
    expect(res.body.items[0]?.character?.name).toBe(character.body.name);
  });

  it('filters by tag', async () => {
    const { generation } = await createGeneration();
    const tagName = `outfit-good-${crypto.randomUUID().slice(0, 8)}`;
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: tagName });

    const res = await getJson<SearchResult>(`/api/v1/generations?tag=${tagName}`);
    expect(res.body.items.map((g) => g.id)).toEqual([generation.id]);
    expect(res.body.items[0]?.tags).toContain(tagName);
  });

  it('filters by rating and bookmark', async () => {
    const { generation } = await createGeneration();
    await req(`/api/v1/generations/${generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'good' }),
    });
    await req(`/api/v1/generations/${generation.id}/bookmark`, { method: 'PUT' });

    const byRating = await getJson<SearchResult>('/api/v1/generations?rating=good&limit=200');
    expect(byRating.body.items.map((g) => g.id)).toContain(generation.id);

    const byBookmark = await getJson<SearchResult>('/api/v1/generations?bookmark=true&limit=200');
    expect(byBookmark.body.items.map((g) => g.id)).toContain(generation.id);
    expect(byBookmark.body.items.find((g) => g.id === generation.id)?.bookmark).toBe(true);
  });

  it('filters by created_at date range', async () => {
    const { generation } = await createGeneration();

    // Use yesterday to tomorrow to avoid timezone issues
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const from = yesterday.toISOString().slice(0, 10);
    const to = tomorrow.toISOString().slice(0, 10);

    const inRange = await getJson<SearchResult>(`/api/v1/generations?from=${from}&to=${to}&limit=200`);
    expect(inRange.body.items.map((g) => g.id)).toContain(generation.id);

    const outOfRange = await getJson<SearchResult>('/api/v1/generations?from=2000-01-01&to=2000-01-02');
    expect(outOfRange.body.items.map((g) => g.id)).not.toContain(generation.id);
  });

  it('serves the stored image bytes', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('404s the image route for an unknown short_id', async () => {
    const res = await req('/g/zzzzzz/image');
    expect(res.status).toBe(404);
  });
});
