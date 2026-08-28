import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, req, TINY_PNG } from './helpers';

interface AssetResult {
  id: string;
  generation_id: string;
  role: string;
  region: string | null;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
  updated_at: string;
}

async function ingestAsset(
  generationId: string,
  metadata: Record<string, unknown>,
  bytes: Uint8Array = TINY_PNG,
  filename = 'asset.png',
  type = 'image/png',
): Promise<{ status: number; body: AssetResult }> {
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set('file', new File([bytes], filename, { type }));

  const res = await req(`/api/v1/generations/${generationId}/assets`, {
    method: 'POST',
    body: form,
  });
  const body = (await res.json()) as AssetResult;
  return { status: res.status, body };
}

const OTHER_PNG = new Uint8Array([...TINY_PNG, 0x00]);

describe('Generation assets', () => {
  it('ingests a new asset and returns 201', async () => {
    const { generation } = await createGeneration();

    const result = await ingestAsset(generation.id, { role: 'lineart-inked' });

    expect(result.status).toBe(201);
    expect(result.body.generation_id).toBe(generation.id);
    expect(result.body.role).toBe('lineart-inked');
    expect(result.body.region).toBeNull();
    expect(result.body.content_type).toBe('image/png');
    expect(result.body.url).toBe(`https://chimera.test/g/${generation.short_id}/assets/lineart-inked`);

    const object = await env.IMAGES.get(`generations/${generation.id}/assets/lineart-inked.png`);
    expect(object).not.toBeNull();
  });

  it('replaces the same (role, region) on resend: same id, updated_at bumped, R2 bytes replaced', async () => {
    const { generation } = await createGeneration();

    const first = await ingestAsset(generation.id, { role: 'mask', region: 'socks' }, TINY_PNG);
    expect(first.status).toBe(201);

    // Ensure updated_at can differ even under a fast clock.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await ingestAsset(generation.id, { role: 'mask', region: 'socks' }, OTHER_PNG);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.size).toBe(OTHER_PNG.byteLength);
    expect(second.body.updated_at >= first.body.updated_at).toBe(true);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_assets WHERE generation_id = ?')
      .bind(generation.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const object = await env.IMAGES.get(`generations/${generation.id}/assets/mask.socks.png`);
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(bytes).toEqual(OTHER_PNG);
  });

  it('normalizes omitted region and explicit null region to the same row', async () => {
    const { generation } = await createGeneration();

    const omitted = await ingestAsset(generation.id, { role: 'base' });
    expect(omitted.status).toBe(201);

    const explicitNull = await ingestAsset(generation.id, { role: 'base', region: null });
    expect(explicitNull.status).toBe(200);
    expect(explicitNull.body.id).toBe(omitted.body.id);
    expect(explicitNull.body.region).toBeNull();

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_assets WHERE generation_id = ?')
      .bind(generation.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('keeps a region-qualified role and the bare role as separate rows', async () => {
    const { generation } = await createGeneration();

    const bare = await ingestAsset(generation.id, { role: 'mask' });
    const regioned = await ingestAsset(generation.id, { role: 'mask', region: 'socks' });

    expect(bare.status).toBe(201);
    expect(regioned.status).toBe(201);
    expect(bare.body.id).not.toBe(regioned.body.id);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_assets WHERE generation_id = ?')
      .bind(generation.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('lists assets ordered by role/region with region null restored', async () => {
    const { generation } = await createGeneration();
    await ingestAsset(generation.id, { role: 'mask', region: 'socks' });
    await ingestAsset(generation.id, { role: 'base' });

    const res = await req(`/api/v1/generations/${generation.id}/assets`);
    const body = (await res.json()) as { assets: AssetResult[] };

    expect(res.status).toBe(200);
    expect(body.assets).toHaveLength(2);
    expect(body.assets.map((a) => a.role)).toEqual(['base', 'mask']);
    expect(body.assets.find((a) => a.role === 'base')?.region).toBeNull();
    expect(body.assets.find((a) => a.role === 'mask')?.region).toBe('socks');
  });

  it('serves an ingested asset with the stored content type and matching bytes', async () => {
    const { generation } = await createGeneration();
    await ingestAsset(generation.id, { role: 'lineart-draft' }, TINY_PNG);

    const res = await req(`/g/${generation.short_id}/assets/lineart-draft`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(TINY_PNG);
  });

  it('serves a region-qualified asset via the region query param', async () => {
    const { generation } = await createGeneration();
    await ingestAsset(generation.id, { role: 'mask', region: 'socks' }, OTHER_PNG);

    const res = await req(`/g/${generation.short_id}/assets/mask?region=socks`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(OTHER_PNG);

    const missing = await req(`/g/${generation.short_id}/assets/mask`);
    expect(missing.status).toBe(404);
  });

  it('404s serving an unknown role', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}/assets/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('400s on a role pattern violation (uppercase)', async () => {
    const { generation } = await createGeneration();
    const result = await ingestAsset(generation.id, { role: 'Mask' });
    expect(result.status).toBe(400);
  });

  it('400s on a role pattern violation (slash)', async () => {
    const { generation } = await createGeneration();
    const result = await ingestAsset(generation.id, { role: 'mask/socks' });
    expect(result.status).toBe(400);
  });

  it('404s when the generation does not exist', async () => {
    const result = await ingestAsset(crypto.randomUUID(), { role: 'mask' });
    expect(result.status).toBe(404);
  });

  it('404s listing assets for a nonexistent generation', async () => {
    const res = await req(`/api/v1/generations/${crypto.randomUUID()}/assets`);
    expect(res.status).toBe(404);
  });
});
