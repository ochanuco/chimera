import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, postJson, req } from './helpers';

interface FinalizeRequestBadge {
  id: string;
  kind: 'finalize' | 'repair' | 'masked_redraw';
  status: string;
  result_short_id: string | null;
}

interface SearchItem {
  id: string;
  short_id: string;
  rating: string | null;
  bookmark: boolean;
  character: { id: string; name: string } | null;
  tags: string[];
  created_at: string;
  refines_generation_short_id: string | null;
  finalize_request: FinalizeRequestBadge | null;
  reference: { recipe: string; pose: string } | null;
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

describe('Generation search: finalize_request badge (docs/ui.md「Gallery」進捗ピル)', () => {
  async function createFinalizeLikeRequest(
    generationIdOrShortId: string,
    kind: 'finalize' | 'repair' | 'masked_redraw',
    createdAt?: string,
  ): Promise<string> {
    const payload =
      kind === 'masked_redraw'
        ? { generation_id: generationIdOrShortId, options: { regions: [[0.1, 0.1, 0.5, 0.5]], prompt_patch: 'x', denoise: 0.5 } }
        : kind === 'repair'
          ? { generation_id: generationIdOrShortId, options: { parts: ['hands'] } }
          : { generation_id: generationIdOrShortId, options: { repin: true } };
    const created = await postJson<{ id: string; status: string }>('/api/v1/requests', {
      kind,
      payload,
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(created.status).toBe(201);
    if (createdAt) {
      await env.DB.prepare('UPDATE requests SET created_at = ? WHERE id = ?').bind(createdAt, created.body.id).run();
    }
    return created.body.id;
  }

  it('resolves a finalize request addressed by the Generation UUID', async () => {
    const { generation } = await createGeneration();
    const requestId = await createFinalizeLikeRequest(generation.id, 'finalize');

    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(res.body.items[0]?.finalize_request).toEqual({ id: requestId, kind: 'finalize', status: 'queued', result_short_id: null });
  });

  it('resolves a repair request addressed by the Generation short_id', async () => {
    const { generation } = await createGeneration();
    const requestId = await createFinalizeLikeRequest(generation.short_id, 'repair');

    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(res.body.items[0]?.finalize_request).toEqual({ id: requestId, kind: 'repair', status: 'queued', result_short_id: null });
  });

  it('recognizes masked_redraw and ignores an unrelated generate request', async () => {
    const { generation } = await createGeneration();
    await postJson('/api/v1/requests', {
      kind: 'generate',
      payload: { schema_version: 1, request: { instruction: 'x', count: 1 }, generation: { recipe: 'yukari', parameters: {} } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    const requestId = await createFinalizeLikeRequest(generation.id, 'masked_redraw');

    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(res.body.items[0]?.finalize_request?.id).toBe(requestId);
    expect(res.body.items[0]?.finalize_request?.kind).toBe('masked_redraw');
  });

  it('the most recently created request wins when several target the same generation', async () => {
    const { generation } = await createGeneration();
    await createFinalizeLikeRequest(generation.id, 'finalize', '2026-01-01T00:00:00.000Z');
    const newer = await createFinalizeLikeRequest(generation.id, 'repair', '2026-01-02T00:00:00.000Z');

    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(res.body.items[0]?.finalize_request?.id).toBe(newer);
    expect(res.body.items[0]?.finalize_request?.kind).toBe('repair');
  });

  it('result_short_id resolves once the request is done, and stays null for every other status', async () => {
    const { generation } = await createGeneration();
    const { batch: resultBatch, generation: resultGen } = await createGeneration();
    const requestId = await createFinalizeLikeRequest(generation.id, 'finalize');

    const queuedRes = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(queuedRes.body.items[0]?.finalize_request?.status).toBe('queued');
    expect(queuedRes.body.items[0]?.finalize_request?.result_short_id).toBeNull();

    await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('running', requestId).run();
    const runningRes = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(runningRes.body.items[0]?.finalize_request?.result_short_id).toBeNull();

    await env.DB.prepare('UPDATE requests SET status = ?, result_json = ? WHERE id = ?')
      .bind('done', JSON.stringify({ batch_id: resultBatch.id, generation_ids: [resultGen.id] }), requestId)
      .run();
    const doneRes = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(doneRes.body.items[0]?.finalize_request).toEqual({
      id: requestId,
      kind: 'finalize',
      status: 'done',
      result_short_id: resultGen.short_id,
    });
  });

  it('is null when no finalize/repair/masked_redraw request targets the generation', async () => {
    const { generation } = await createGeneration();
    const res = await getJson<SearchResult>(`/api/v1/generations?ids=${generation.short_id}`);
    expect(res.body.items[0]?.finalize_request).toBeNull();
  });
});

describe('POST /api/v1/generations/{id}/pose-reference + reference filter (docs/domain-model.md「基準 render の pin」)', () => {
  function uniqueRecipe(): string {
    return `pose-ref-${crypto.randomUUID()}`;
  }

  function sampleCatalog(recipe: string) {
    return {
      schema_version: 1,
      recipes: [
        {
          name: recipe,
          poses: [{ name: 'lounge', prompt: 'reclining on a beanbag, warm light', costume: 'default' }],
          costumes: [{ name: 'default', prompt: 'plain roomwear' }],
          expressions: [{ name: 'smile', prompt: 'a gentle smile' }],
        },
      ],
      patches: {},
      git_commit: 'abc1234',
      git_branch: 'main',
      generated_at: '2026-09-08T00:00:00.000Z',
    };
  }

  async function publishAndImport(recipe: string): Promise<void> {
    const recipeRef = `test-${crypto.randomUUID()}`;
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(recipe), 'PUT');
    const res = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: recipeRef });
    expect(res.status).toBe(200);
  }

  async function setRatingGood(generationId: string): Promise<void> {
    const res = await postJson(`/api/v1/generations/${generationId}/rating`, { rating: 'good' }, 'PUT');
    expect(res.status).toBe(200);
  }

  interface PoseReferenceResult {
    created: boolean;
    recipe: string;
    kind: string;
    name: string;
    reference: { generation_id: string; short_id: string; seed: number };
  }

  it('pins from the GUI route, filters the gallery, and folds into the item/detail shape', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const { generation: pinned } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });
    const { generation: other } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });
    await setRatingGood(pinned.id);

    const pin = await postJson<PoseReferenceResult>(`/api/v1/generations/${pinned.id}/pose-reference`, {});
    expect(pin.status).toBe(201);
    expect(pin.body.name).toBe('lounge');
    expect(pin.body.recipe).toBe(recipe);

    const onlyPinned = await getJson<SearchResult>('/api/v1/generations?reference=true&limit=200');
    expect(onlyPinned.body.items.map((g) => g.id)).toEqual([pinned.id]);
    expect(onlyPinned.body.items[0]?.reference).toEqual({ recipe, pose: 'lounge' });

    const excluded = await getJson<SearchResult>('/api/v1/generations?reference=false&limit=200');
    expect(excluded.body.items.map((g) => g.id)).not.toContain(pinned.id);
    expect(excluded.body.items.map((g) => g.id)).toContain(other.id);

    const withBoth = await getJson<SearchResult>(`/api/v1/generations?ids=${pinned.id},${other.id}`);
    expect(withBoth.body.items.find((g) => g.id === other.id)?.reference).toBeNull();

    const detail = await getJson<{ pose_reference: { recipe: string; pose: string } | null }>(`/api/v1/generations/${pinned.id}`);
    expect(detail.body.pose_reference).toEqual({ recipe, pose: 'lounge' });
  });

  it('409s when rating is not good', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });

    const res = await postJson<{ error: { message: string } }>(`/api/v1/generations/${generation.id}/pose-reference`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('requires rating good');
  });

  it('409s with "cannot infer" for a graph-mode batch (no recipe)', async () => {
    const { generation } = await createGeneration();
    await setRatingGood(generation.id);

    const res = await postJson<{ error: { message: string } }>(`/api/v1/generations/${generation.id}/pose-reference`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('cannot infer');
  });
});
