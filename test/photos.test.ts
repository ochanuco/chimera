import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, req } from './helpers';
import { listPhotos } from '../src/lib/photos';

async function uploadPhoto(name: string) {
  const key = `photo:${crypto.randomUUID()}`;
  return createGeneration({
    requestOverrides: { kind: 'import', status: 'done', parameters: { kind: 'photo' }, idempotency_key: key },
    metadata: { original_filename: name },
  });
}

describe('photos', () => {
  it('lists only import Generations whose parameters.kind is photo, newest first', async () => {
    const first = await uploadPhoto('street.png');
    const second = await uploadPhoto('shop.png');
    await createGeneration();
    const items = await listPhotos(env.DB);
    const ids = items.map((item) => item.short_id);
    expect(ids.indexOf(second.generation.short_id)).toBeLessThan(ids.indexOf(first.generation.short_id));
    expect(items.every((item) => item.original_filename === 'street.png' || item.original_filename === 'shop.png')).toBe(true);
  });

  it('renders the upload form and the uploaded photos with their ids', async () => {
    const photo = await uploadPhoto('station.png');
    const res = await req('/photos');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-photo-upload');
    expect(html).toContain('data-max-side="3072"');
    expect(html).toContain(`/g/${photo.generation.short_id}/preview`);
    expect(html).toContain('station.png');
  });
});
