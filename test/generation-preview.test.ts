import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, makeSolidPng, req } from './helpers';
import { generationCutoutPreviewR2Key, generationPreviewR2Key } from '../src/lib/generation-preview';

describe('GET /g/:short_id/preview', () => {
  it('creates and stores a downscaled WebP preview on first request', async () => {
    const { generation } = await createGeneration();
    const key = `generations/${generation.id}/original.png`;
    await env.IMAGES.put(key, await makeSolidPng(1600, 2400, [90, 140, 200]));

    const res = await req(`/g/${generation.short_id}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');

    const bytes = new Uint8Array(await res.arrayBuffer());
    const info = await env.IMAGE_TRANSFORM.info(new Response(bytes).body!);
    expect('height' in info && info.height).toBe(1024); // long edge of the 1600x2400 source

    const stored = await env.IMAGES.head(generationPreviewR2Key(generation.id));
    expect(stored).not.toBeNull();
  });

  it('serves the stored preview after the original is deleted', async () => {
    const { generation } = await createGeneration();
    const key = `generations/${generation.id}/original.png`;
    await env.IMAGES.put(key, await makeSolidPng(1600, 2400, [90, 140, 200]));

    const first = await req(`/g/${generation.short_id}/preview`);
    expect(first.status).toBe(200);

    await env.IMAGES.delete(key);

    const second = await req(`/g/${generation.short_id}/preview`);
    expect(second.status).toBe(200);
    expect(second.headers.get('Content-Type')).toBe('image/webp');
  });

  it('404s for an unknown short_id', async () => {
    const res = await req('/g/zzzzzz/preview');
    expect(res.status).toBe(404);
  });

  it('404s when neither the preview nor the original exists', async () => {
    const { generation } = await createGeneration();
    await env.IMAGES.delete(`generations/${generation.id}/original.png`);

    const res = await req(`/g/${generation.short_id}/preview`);
    expect(res.status).toBe(404);
  });
});

async function attachCutout(generationId: string, r2Key: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO generation_assets (id, generation_id, role, region, r2_object_key, content_type, size, created_at, updated_at)
     VALUES (?, ?, 'cutout', '', ?, 'image/png', 1, ?, ?)`,
  )
    .bind(crypto.randomUUID(), generationId, r2Key, now, now)
    .run();
}

describe('preview of a Generation with a cutout asset', () => {
  it('is built from the cutout into its own key, leaving the earlier original-based preview alone', async () => {
    const { generation } = await createGeneration();
    await env.IMAGES.put(`generations/${generation.id}/original.png`, await makeSolidPng(1600, 2400, [0, 255, 0]));

    const before = await req(`/g/${generation.short_id}/preview`);
    expect(before.status).toBe(200);
    expect(await env.IMAGES.head(generationPreviewR2Key(generation.id))).not.toBeNull();

    const cutKey = `generations/${generation.id}/assets/cutout.png`;
    await env.IMAGES.put(cutKey, await makeSolidPng(800, 2000, [200, 50, 50]));
    await attachCutout(generation.id, cutKey);

    const res = await req(`/g/${generation.short_id}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const info = await env.IMAGES.head(generationCutoutPreviewR2Key(generation.id));
    expect(info).not.toBeNull();
    const meta = await env.IMAGE_TRANSFORM.info(new Response(bytes).body!);
    expect('width' in meta && meta.width).toBe(410); // 800x2000 cutout scaled to 1024 tall, not the 1600x2400 original
    expect(await env.IMAGES.head(`generations/${generation.id}/original.png`)).not.toBeNull();
  });

  it('does not store the original as the cutout preview when the cutout object is missing', async () => {
    const { generation } = await createGeneration();
    await env.IMAGES.put(`generations/${generation.id}/original.png`, await makeSolidPng(1600, 2400, [0, 255, 0]));
    await attachCutout(generation.id, `generations/${generation.id}/assets/missing.png`);

    const res = await req(`/g/${generation.short_id}/preview`);
    expect(res.status).toBe(200);
    expect(await env.IMAGES.head(generationCutoutPreviewR2Key(generation.id))).toBeNull();
  });
});

describe('Generation detail with a cutout asset', () => {
  it('shows the cutout as the main image and links the original', async () => {
    const { generation } = await createGeneration();
    await attachCutout(generation.id, 'k');
    const html = await (await req(`/g/${generation.short_id}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain(`src="/g/${generation.short_id}/assets/cutout"`);
    expect(html).toContain(`/g/${generation.short_id}/image">元画像`);
  });

  it('keeps the original as the main image without a cutout', async () => {
    const { generation } = await createGeneration();
    const html = await (await req(`/g/${generation.short_id}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('/assets/cutout');
  });
});

describe('Generation API serialization: thumbnail_url vs image_url', () => {
  it('thumbnail_url points at /preview, image_url at /image', async () => {
    const { generation } = await createGeneration();
    const res = await getJson<{ items: { thumbnail_url: string; image_url: string }[] }>(
      `/api/v1/generations?ids=${generation.id}`,
    );
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item?.thumbnail_url).toMatch(/\/preview$/);
    expect(item?.image_url).toMatch(/\/image$/);
  });
});
