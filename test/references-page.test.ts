import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { listReferences } from '../src/lib/references';
import { clearRequests, createGeneration, postJson, req, TINY_PNG } from './helpers';

beforeEach(async () => {
  await clearRequests();
});

async function uploadReference(seed?: string): Promise<{ id: string; short_id: string }> {
  const form = new FormData();
  form.append('image', new File([TINY_PNG], 'ref.png'));
  form.append('idempotency_key', crypto.randomUUID());
  if (seed !== undefined) form.append('seed', seed);
  const res = await req('/api/v1/references', { method: 'POST', body: form });
  return (await res.json()) as { id: string; short_id: string };
}

async function finish(id: string, result: Record<string, unknown>) {
  await postJson('/api/v1/requests/claim', { worker_id: 'w', kinds: ['reference'] });
  const res = await postJson(`/api/v1/requests/${id}`, { status: 'done', worker_id: 'w', result: { generation_ids: [], ...result } }, 'PATCH');
  expect(res.status).toBe(200);
}

describe('/references', () => {
  it('renders the upload form with the file and seed only', async () => {
    const res = await req('/references');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-reference-upload');
    expect(html).toContain('data-reference-file');
    expect(html).toContain('data-reference-seed');
    expect(html).toContain('data-max-side="3072"');
    expect(html).toContain('href="/references"');
  });

  it('shows the applied tags per part, the dropped tags and the generate it queued', async () => {
    const reference = await uploadReference('77');
    const { request: generate, generation } = await createGeneration();
    await finish(reference.id, {
      generate_request_id: generate.id,
      pose: 'bust',
      applied: { framing_tags: ['(from above:1.3)'], mouth: ['smile'] },
      dropped: ['on floor'],
    });

    const html = await (await req('/references')).text();
    expect(html).toContain(reference.short_id);
    expect(html).toContain('seed 77');
    expect(html).toContain('framing_tags');
    expect(html).toContain('(from above:1.3)');
    expect(html).toContain('smile');
    expect(html).toContain('on floor');
    expect(html).toContain(`href="/g/${generation.short_id}"`);
  });

  it('lists newest first and tolerates a result without tags or a generate it cannot find', async () => {
    const newer = await uploadReference();
    const missing = crypto.randomUUID();
    await finish(newer.id, { generate_request_id: missing });
    const older = await uploadReference();
    await env.DB.prepare(`UPDATE requests SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).bind(older.id).run();

    const items = await listReferences(env.DB);
    expect(items.map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(items[0]).toMatchObject({ status: 'done', applied: null, dropped: null, pose: null, generate: { id: missing, short_id: null, status: null } });
    expect(items[1]).toMatchObject({ status: 'queued', generate: null, seed: null });
  });
});
