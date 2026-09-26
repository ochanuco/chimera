import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createGeneration,
  getJson,
  ingestGeneration,
  makePngWithChunks,
  makeSolidPng,
  mcpToolCall,
  postJson,
  req,
  textChunkData,
} from './helpers';
import { purgeOldOriginals } from '../src/lib/original-purge';
import { generationPreviewR2Key } from '../src/lib/generation-preview';

const NOW = new Date('2026-09-19T00:00:00.000Z').toISOString();

function daysAgo(days: number): string {
  return new Date(new Date(NOW).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function ageGeneration(id: string, days: number): Promise<void> {
  await env.DB.prepare('UPDATE generations SET created_at = ? WHERE id = ?').bind(daysAgo(days), id).run();
}

function originalKey(generationId: string): string {
  return `generations/${generationId}/original.png`;
}

async function originalPurgedAt(generationId: string): Promise<string | null> {
  const row = await env.DB
    .prepare('SELECT original_purged_at FROM generations WHERE id = ?')
    .bind(generationId)
    .first<{ original_purged_at: string | null }>();
  return row?.original_purged_at ?? null;
}

/** Replaces the 1x1 TINY_PNG that createGeneration ingests with a real transformable source (same idiom as test/generation-preview.test.ts). */
async function putRealOriginal(generationId: string): Promise<void> {
  await env.IMAGES.put(originalKey(generationId), await makeSolidPng(64, 64, [10, 20, 30]));
}

// purgeOldOriginals scans every candidate row in the table, so leftover rows from an earlier
// test in this file would pollute "oldest first" / global-count assertions (same reasoning as
// test/requests.test.ts's claim() beforeEach).
beforeEach(async () => {
  await env.DB.batch([
    // batches.refines_generation_id / experiments.base_generation_id point back at generations,
    // while generations.batch_id points at batches — a genuine FK cycle, so back-references must
    // be cleared before either table's rows can be deleted.
    env.DB.prepare('UPDATE batches SET refines_generation_id = NULL'),
    env.DB.prepare('UPDATE experiments SET base_generation_id = NULL'),
    env.DB.prepare('DELETE FROM generation_assets'),
    env.DB.prepare('DELETE FROM pairwise_judgments'),
    env.DB.prepare('DELETE FROM experiment_promotions'),
    env.DB.prepare('DELETE FROM experiment_runs'),
    env.DB.prepare('DELETE FROM generation_publications'),
    env.DB.prepare('DELETE FROM preset_references'),
    env.DB.prepare('DELETE FROM presets'),
    env.DB.prepare('DELETE FROM batch_references'),
    env.DB.prepare('DELETE FROM requests'),
    env.DB.prepare('DELETE FROM generations'),
    env.DB.prepare('DELETE FROM comfy_jobs'),
    env.DB.prepare('DELETE FROM batches'),
    env.DB.prepare('DELETE FROM experiments'),
  ]);
});

describe('purgeOldOriginals', () => {
  it('purges an unrated Generation past the retention window', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);

    const result = await purgeOldOriginals(env, NOW, 10);
    expect(result).toEqual({ purged: 1, skipped: 0 });

    expect(await env.IMAGES.head(originalKey(generation.id))).toBeNull();
    expect(await env.IMAGES.head(generationPreviewR2Key(generation.id))).not.toBeNull();
    expect(await originalPurgedAt(generation.id)).toBe(NOW);
  });

  it('purges a bad-rated Generation, but keeps neutral/good ones', async () => {
    const bad = await createGeneration();
    const neutral = await createGeneration();
    const good = await createGeneration();
    for (const { generation } of [bad, neutral, good]) {
      await putRealOriginal(generation.id);
      await ageGeneration(generation.id, 31);
    }
    await req(`/api/v1/generations/${bad.generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'bad' }),
    });
    await req(`/api/v1/generations/${neutral.generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'neutral' }),
    });
    await req(`/api/v1/generations/${good.generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'good' }),
    });

    const result = await purgeOldOriginals(env, NOW, 10);
    expect(result).toEqual({ purged: 1, skipped: 0 });

    expect(await originalPurgedAt(bad.generation.id)).toBe(NOW);
    expect(await originalPurgedAt(neutral.generation.id)).toBeNull();
    expect(await originalPurgedAt(good.generation.id)).toBeNull();
  });

  it('keeps a Generation inside the 30-day retention window', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 29);

    const result = await purgeOldOriginals(env, NOW, 10);
    expect(result).toEqual({ purged: 0, skipped: 0 });
    expect(await originalPurgedAt(generation.id)).toBeNull();
    expect(await env.IMAGES.head(originalKey(generation.id))).not.toBeNull();
  });

  it('keeps a bookmarked Generation', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    await req(`/api/v1/generations/${generation.id}/bookmark`, { method: 'PUT' });

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation with a Publication', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    const pub = await postJson(`/api/v1/generations/${generation.id}/publications`, {});
    expect(pub.status).toBe(201);

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation pinned as a pose reference (preset_references)', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    await env.DB.prepare(
      `INSERT INTO preset_references (id, recipe, kind, name, generation_id, source_generation_id, seed, idempotency_key, created_by, created_at, superseded_at)
       VALUES (?, 'test-recipe', 'pose', 'lounge', ?, ?, 1, NULL, 'gui', ?, NULL)`,
    )
      .bind(crypto.randomUUID(), generation.id, generation.id, NOW)
      .run();

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation that is the source of a Preset (profile promotion)', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    await env.DB.prepare(
      `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at)
       VALUES (?, 'test-recipe', 'finalize', 'daily', 1, '{}', 'active', 'promote', ?, NULL, 'gui', ?)`,
    )
      .bind(crypto.randomUUID(), generation.id, NOW)
      .run();

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation used as another Batch\'s reference material (batch_references)', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    const otherBatch = await createGeneration();
    await env.DB.prepare(
      `INSERT INTO batch_references (id, source_generation_id, target_batch_id, purpose, aspect, instruction, created_at)
       VALUES (?, ?, ?, 'composition', NULL, NULL, ?)`,
    )
      .bind(crypto.randomUUID(), generation.id, otherBatch.batch.id, NOW)
      .run();

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation another Batch refines (refines_generation_id)', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    const refinedBatch = await createGeneration();
    await env.DB.prepare('UPDATE batches SET refines_generation_id = ? WHERE id = ?')
      .bind(generation.id, refinedBatch.batch.id)
      .run();

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation that is an Experiment\'s base_generation_id', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    const exp = await postJson<{ id: string }>('/api/v1/experiments', {
      name: `exp-${crypto.randomUUID().slice(0, 8)}`,
      base_generation_id: generation.id,
    });
    expect(exp.status).toBe(201);

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('keeps a Generation with a pending finalize request', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    const created = await postJson('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.short_id },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(created.status).toBe(201);

    await purgeOldOriginals(env, NOW, 10);
    expect(await originalPurgedAt(generation.id)).toBeNull();
  });

  it('honours the limit and processes the oldest candidates first', async () => {
    const oldest = await createGeneration();
    const middle = await createGeneration();
    const newest = await createGeneration();
    for (const { generation } of [oldest, middle, newest]) await putRealOriginal(generation.id);
    await ageGeneration(oldest.generation.id, 40);
    await ageGeneration(middle.generation.id, 35);
    await ageGeneration(newest.generation.id, 31);

    const result = await purgeOldOriginals(env, NOW, 2);
    expect(result).toEqual({ purged: 2, skipped: 0 });

    expect(await originalPurgedAt(oldest.generation.id)).not.toBeNull();
    expect(await originalPurgedAt(middle.generation.id)).not.toBeNull();
    expect(await originalPurgedAt(newest.generation.id)).toBeNull();
  });

  it('marks the row when the original is already gone but a preview is stored', async () => {
    const { generation } = await createGeneration();
    await putRealOriginal(generation.id);
    await ageGeneration(generation.id, 31);
    // Pre-populate the preview and drop the original, as if a previous run's R2 delete succeeded
    // but its D1 write didn't.
    await env.IMAGES.put(generationPreviewR2Key(generation.id), new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: 'image/webp' },
    });
    await env.IMAGES.delete(originalKey(generation.id));

    await expect(purgeOldOriginals(env, NOW, 10)).resolves.toEqual({ purged: 1, skipped: 0 });
    expect(await originalPurgedAt(generation.id)).toBe(NOW);
  });

  it('rescues the graph from the PNG prompt chunk before deleting the original', async () => {
    const graph = { '1': { class_type: 'KSampler', inputs: { seed: 7 } } };
    const { generation, job } = await createGeneration();
    const bytes = await makePngWithChunks(64, 64, {
      colorType: 2,
      extraChunks: [{ type: 'tEXt', data: textChunkData('prompt', JSON.stringify(graph)) }],
    });
    await env.IMAGES.put(originalKey(generation.id), bytes);
    await ageGeneration(generation.id, 31);

    const result = await purgeOldOriginals(env, NOW, 10);
    expect(result).toEqual({ purged: 1, skipped: 0 });
    expect(await env.IMAGES.head(originalKey(generation.id))).toBeNull();

    const jobRow = await env.DB
      .prepare('SELECT graph, render_facts_json FROM comfy_jobs WHERE id = ?')
      .bind(job.id)
      .first<{ graph: string | null; render_facts_json: string | null }>();
    expect(JSON.parse(jobRow!.graph!)).toEqual(graph);
    expect(jobRow!.render_facts_json).not.toBeNull();
  });
});

describe('degradation after an original is purged', () => {
  async function purgedGeneration() {
    const created = await createGeneration();
    await putRealOriginal(created.generation.id);
    await ageGeneration(created.generation.id, 31);
    const result = await purgeOldOriginals(env, NOW, 10);
    expect(result.purged).toBe(1);
    return created;
  }

  it('GET /g/:id/image returns 410 original_purged; /preview still 200', async () => {
    const { generation } = await purgedGeneration();

    const imageRes = await req(`/g/${generation.short_id}/image`);
    expect(imageRes.status).toBe(410);
    const body = (await imageRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('original_purged');

    const previewRes = await req(`/g/${generation.short_id}/preview`);
    expect(previewRes.status).toBe(200);
  });

  it('ingest replay of the same (comfy_job_id, comfy_output_index) returns 200 without recreating original.png', async () => {
    const { generation, job } = await purgedGeneration();

    const replay = await ingestGeneration(job.id, {
      seed: 123,
      original_filename: 'out_00001_.png',
      comfy_output_index: 0,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(generation.id);
    expect(await env.IMAGES.head(originalKey(generation.id))).toBeNull();
  });

  it('creating a finalize request 409s with original_purged', async () => {
    const { generation } = await purgedGeneration();

    const res = await postJson<{ error: { code: string } }>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.short_id },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('original_purged');
  });

  it('API serialization includes original_purged_at', async () => {
    const { generation } = await purgedGeneration();

    const res = await getJson<{ items: { id: string; original_purged_at: string | null }[] }>(
      `/api/v1/generations?ids=${generation.id}`,
    );
    expect(res.body.items[0]?.original_purged_at).toBe(NOW);
  });

  it('Generation Detail page shows the purged note and points its hero image at /preview', async () => {
    const { generation } = await purgedGeneration();

    const res = await req(`/g/${generation.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('原寸は破棄済み');
    expect(html).toContain(`src="/g/${generation.short_id}/preview"`);
  });

  it('MCP get_generation_image still returns an inline image, served from the preview', async () => {
    const { generation } = await purgedGeneration();

    const { isError, result } = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.type).toBe('image');
  });
});
