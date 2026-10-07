import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, ingestGeneration, makeSolidPng, mcpToolCall, postJson, req } from './helpers';
import { ensureGenerationPreview } from '../src/lib/generation-preview';
import type { GenerationRow } from '../src/types';

const PURGED_AT = new Date('2026-09-19T00:00:00.000Z').toISOString();

function originalKey(generationId: string): string {
  return `generations/${generationId}/original.png`;
}

/** A Generation whose original was purged by the retired retention job: row and preview kept, original gone. */
async function purgedGeneration() {
  const created = await createGeneration();
  await env.IMAGES.put(originalKey(created.generation.id), await makeSolidPng(64, 64, [10, 20, 30]));
  const row = await env.DB.prepare('SELECT * FROM generations WHERE id = ?').bind(created.generation.id).first<GenerationRow>();
  expect(await ensureGenerationPreview(env, row!)).toBe(true);
  await env.IMAGES.delete(originalKey(created.generation.id));
  await env.DB.prepare('UPDATE generations SET original_purged_at = ? WHERE id = ?').bind(PURGED_AT, created.generation.id).run();
  return created;
}

describe('a Generation whose original was purged earlier stays readable', () => {
  it('GET /g/:id/image returns 410 original_purged; /preview still 200', async () => {
    const { generation } = await purgedGeneration();

    const imageRes = await req(`/g/${generation.short_id}/image`);
    expect(imageRes.status).toBe(410);
    const body = (await imageRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('original_purged');

    expect((await req(`/g/${generation.short_id}/preview`)).status).toBe(200);
  });

  it('ingest replay of the same (comfy_job_id, comfy_output_index) returns 200 without recreating original.png', async () => {
    const { generation, job } = await purgedGeneration();

    const replay = await ingestGeneration(job.id, { seed: 123, original_filename: 'out_00001_.png', comfy_output_index: 0 });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(generation.id);
    expect(await env.IMAGES.head(originalKey(generation.id))).toBeNull();
  });

  it.each([
    ['redraw', { options: { method: 'canvas' } }],
    ['deliver', {}],
    ['repair', {}],
  ])('creating a %s request 409s with original_purged', async (kind, extra) => {
    const { generation } = await purgedGeneration();

    const res = await postJson<{ error: { code: string } }>('/api/v1/requests', {
      kind,
      payload: { generation_id: generation.short_id, ...extra },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('original_purged');
  });

  it('API serialization includes original_purged_at', async () => {
    const { generation } = await purgedGeneration();

    const res = await getJson<{ items: { id: string; original_purged_at: string | null }[] }>(`/api/v1/generations?ids=${generation.id}`);
    expect(res.body.items[0]?.original_purged_at).toBe(PURGED_AT);
  });

  it('Generation Detail page shows the purged note, no forms, and points its hero image at /preview', async () => {
    const { generation } = await purgedGeneration();

    const res = await req(`/g/${generation.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('原寸は破棄済み');
    expect(html).toContain(`src="/g/${generation.short_id}/preview"`);
    expect(html).not.toContain('redraw-form');
    expect(html).not.toContain('deliver-form');
  });

  it('MCP get_generation_image still returns an inline image, served from the preview', async () => {
    const { generation } = await purgedGeneration();

    const { isError, result } = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(isError).toBe(false);
    expect(result?.content?.[0]?.type).toBe('image');
  });
});
