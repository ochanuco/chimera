import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { listReferences } from '../src/lib/references';
import { clearRequests, createGeneration, postJson, req, TINY_PNG } from './helpers';

beforeEach(async () => {
  await clearRequests();
});

interface RequestBody {
  id: string;
  short_id: string;
}

const ANALYSIS = {
  generation_ids: [],
  pose: 'coffee',
  candidates: [
    { tag: 'from above', part: 'framing_tags', score: 0.25, kept: true, d1: null, applied: true },
    { tag: 'looking up', part: 'gesture', score: 0.11, kept: false, d1: 0.53, applied: true },
    { tag: 'leaning forward', part: 'gesture', score: 0.02, kept: false, d1: null, applied: false },
    { tag: 'pantyhose', part: 'legwear', score: 0.4, kept: true, d1: null, applied: true },
  ],
  applied: { framing_tags: ['from above'], gesture: ['looking up'], legwear: ['pantyhose'] },
  dropped: [],
};

async function uploadReference(): Promise<RequestBody> {
  const form = new FormData();
  form.append('image', new File([TINY_PNG], 'ref.png'));
  form.append('idempotency_key', crypto.randomUUID());
  return (await req('/api/v1/references', { method: 'POST', body: form }).then((r) => r.json())) as RequestBody;
}

async function finish(id: string, kind: string, result: Record<string, unknown>) {
  await postJson('/api/v1/requests/claim', { worker_id: 'w', kinds: [kind] });
  const res = await postJson(`/api/v1/requests/${id}`, { status: 'done', worker_id: 'w', result }, 'PATCH');
  expect(res.status).toBe(200);
}

async function analyzed(): Promise<RequestBody> {
  const reference = await uploadReference();
  await finish(reference.id, 'reference', ANALYSIS);
  return reference;
}

describe('/references', () => {
  it('renders the upload form without a seed and links each reference to its page', async () => {
    const reference = await uploadReference();
    const html = await (await req('/references')).text();
    expect(html).toContain('data-reference-upload');
    expect(html).toContain('data-reference-file');
    expect(html).not.toContain('data-reference-seed');
    expect(html).toContain(`href="/references/${reference.short_id}"`);
    expect(html).toContain('解析待ち');
  });

  it('lists newest first with the number of renders', async () => {
    const older = await analyzed();
    await postJson(`/api/v1/references/${older.id}/renders`, { pose: 'bust', applied: {}, idempotency_key: crypto.randomUUID() });
    const newer = await uploadReference();
    await env.DB.prepare(`UPDATE requests SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).bind(older.id).run();
    const items = await listReferences(env.DB);
    expect(items.map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(items[1]).toMatchObject({ status: 'done', renders: 1 });
  });
});

describe('/references/{short_id}', () => {
  it('shows progress while the analysis waits, and polls', async () => {
    const reference = await uploadReference();
    const html = await (await req(`/references/${reference.short_id}`)).text();
    expect(html).toContain('解析待ち');
    expect(html).toContain('data-pending="true"');
    expect(html).not.toContain('data-ref-run');
  });

  it('shows the error of a failed analysis', async () => {
    const reference = await uploadReference();
    await postJson('/api/v1/requests/claim', { worker_id: 'w', kinds: ['reference'] });
    await postJson(`/api/v1/requests/${reference.id}`, { status: 'failed', worker_id: 'w', error: 'tagger crashed' }, 'PATCH');
    const html = await (await req(`/references/${reference.short_id}`)).text();
    expect(html).toContain('tagger crashed');
    expect(html).not.toContain('data-ref-run');
  });

  it('shows the candidates as chips per part, the proposed pose and the 描く button', async () => {
    const reference = await analyzed();
    const html = await (await req(`/references/${reference.short_id}`)).text();
    expect(html).toContain('data-ref-part="framing_tags"');
    expect(html).toMatch(/class="wb-pill ref-chip wb-pill-on"[^>]*data-ref-tag="from above"/);
    expect(html).toMatch(/class="wb-pill ref-chip ref-chip-dim"[^>]*data-ref-tag="leaning forward"/);
    expect(html).toContain('0.02 / –');
    expect(html).toMatch(/<option value="coffee" selected/);
    expect(html).toContain('data-ref-run');
    expect(html).toContain('data-pending="false"');
  });

  it('lists the pictures drawn from it newest first, render → generate → Generation', async () => {
    const reference = await analyzed();
    const first = await postJson<RequestBody>(`/api/v1/references/${reference.id}/renders`, {
      pose: 'coffee',
      seed: 5,
      applied: { gesture: ['leaning forward'] },
      idempotency_key: crypto.randomUUID(),
    });
    const { request: generate, generation } = await createGeneration();
    await finish(first.body.id, 'reference_render', { generation_ids: [], generate_request_id: generate.id, generate_request_short_id: generate.short_id });
    await postJson(`/api/v1/references/${reference.id}/renders`, { pose: 'bust', applied: {}, idempotency_key: crypto.randomUUID() });

    const res = await req(`/references/${reference.short_id}?partial=renders`);
    expect(res.headers.get('X-Reference-Status')).toBe('done');
    expect(res.headers.get('X-Reference-Pending')).toBe('true');
    const html = await res.text();
    expect(html).toContain(`href="/g/${generation.short_id}"`);
    expect(html).toContain('gesture: leaning forward');
    expect(html.indexOf('待機中')).toBeLessThan(html.indexOf(generation.short_id));
  });

  it('is 404 for an unknown reference', async () => {
    expect((await req('/references/nosuch')).status).toBe(404);
  });
});
