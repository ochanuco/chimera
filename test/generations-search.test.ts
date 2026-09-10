import { env } from 'cloudflare:test';
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
  refines_generation_short_id: string | null;
}

interface SearchResult {
  items: SearchItem[];
  total: number;
  next_cursor: string | null;
}

/** Builds a "refined" Generation: a Batch whose refines_generation_id resolves to a raw Generation's source. */
async function createRefinedGeneration() {
  const { batch: sourceBatch, generation: sourceGen } = await createGeneration();
  const refined = await createGeneration({
    batchOverrides: {
      refinement: { source_batch_id: sourceBatch.id, actor: 'claude', reason: 'finalize' },
      references: [{ source_generation_id: sourceGen.id, purpose: 'rebuild' }],
    },
  });
  return { sourceGen, refined };
}

describe('Generation search', () => {
  it('filters by character name', async () => {
    const character = await postJson<{ id: string; name: string }>('/api/v1/characters', {
      name: `yukari-${crypto.randomUUID().slice(0, 8)}`,
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

  it('filters by exact original_filename', async () => {
    const { generation } = await createGeneration({ metadata: { original_filename: 'yk-lineT3_00001_.png' } });

    const found = await getJson<SearchResult>('/api/v1/generations?original_filename=yk-lineT3_00001_.png');
    expect(found.body.items.map((g) => g.id)).toContain(generation.id);

    const notFound = await getJson<SearchResult>('/api/v1/generations?original_filename=does-not-exist.png');
    expect(notFound.body.items.map((g) => g.id)).not.toContain(generation.id);
  });

  it('filters by exact comfy_prompt_id', async () => {
    const { job, generation } = await createGeneration();
    await postJson(`/api/v1/jobs/${job.id}`, { comfy_prompt_id: 'a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df' }, 'PATCH');

    const res = await getJson<SearchResult>('/api/v1/generations?comfy_prompt_id=a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df');
    expect(res.body.items.map((g) => g.id)).toEqual([generation.id]);
  });

  it('filters by origin', async () => {
    const { generation: rawGen } = await createGeneration();
    const { sourceGen, refined } = await createRefinedGeneration();

    const rawRes = await getJson<SearchResult>('/api/v1/generations?origin=raw&limit=200');
    expect(rawRes.body.items.map((g) => g.id)).toContain(rawGen.id);
    expect(rawRes.body.items.map((g) => g.id)).not.toContain(refined.generation.id);

    const refinedRes = await getJson<SearchResult>('/api/v1/generations?origin=refined&limit=200');
    expect(refinedRes.body.items.map((g) => g.id)).toContain(refined.generation.id);
    expect(refinedRes.body.items.map((g) => g.id)).not.toContain(rawGen.id);
    expect(refinedRes.body.items.find((g) => g.id === refined.generation.id)?.refines_generation_short_id).toBe(
      sourceGen.short_id,
    );
  });

  it('400s on an invalid origin value', async () => {
    const res = await getJson('/api/v1/generations?origin=bogus');
    expect(res.status).toBe(400);
  });

  it('includes refines_generation_short_id (null for a raw Generation)', async () => {
    const { generation: rawGen } = await createGeneration();

    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${rawGen.short_id}`);
    expect(res.body.items[0]?.refines_generation_short_id).toBeNull();
  });

  it('excludes a rating via exclude_rating while keeping unrated rows', async () => {
    const { generation: badGen } = await createGeneration();
    await req(`/api/v1/generations/${badGen.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'bad' }),
    });
    const { generation: unratedGen } = await createGeneration();

    const res = await getJson<SearchResult>(
      `/api/v1/generations?ids=${badGen.short_id},${unratedGen.short_id}&exclude_rating=bad`,
    );
    expect(res.body.items.map((g) => g.id)).not.toContain(badGen.id);
    expect(res.body.items.map((g) => g.id)).toContain(unratedGen.id);
  });

  it('400s on an invalid exclude_rating value', async () => {
    const res = await getJson('/api/v1/generations?exclude_rating=bogus');
    expect(res.status).toBe(400);
  });

  it('filters by ids, accepting a mix of short_id and UUID', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const { generation: g3 } = await createGeneration();

    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${g1.short_id},${g2.id}`);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
    expect(res.body.items.map((g) => g.id)).not.toContain(g3.id);
  });

  it('400s when ids has more than 100 values', async () => {
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID()).join(',');
    const res = await getJson(`/api/v1/generations?ids=${ids}`);
    expect(res.status).toBe(400);
  });

  it('paginates by cursor across generations sharing the same created_at without duplicates or skips', async () => {
    const sameCreatedAt = '2026-01-01T00:00:00.000Z';
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { generation } = await createGeneration();
      await env.DB.prepare('UPDATE generations SET created_at = ? WHERE id = ?').bind(sameCreatedAt, generation.id).run();
      ids.push(generation.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `/api/v1/generations?ids=${ids.join(',')}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await getJson<SearchResult>(url);
      seen.push(...res.body.items.map((g) => g.id));
      if (!res.body.next_cursor) break;
      cursor = res.body.next_cursor;
    }

    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(ids.length);
  });

  it('400s on a malformed cursor', async () => {
    const res = await getJson('/api/v1/generations?cursor=not-valid-base64%21%21%21');
    expect(res.status).toBe(400);
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
