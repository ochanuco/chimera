import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, makeSolidPng, req } from './helpers';
import { generationPreviewR2Key } from '../src/lib/generation-preview';

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
