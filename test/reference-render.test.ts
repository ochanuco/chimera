import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRequests, postJson, req, TINY_PNG } from './helpers';

beforeEach(async () => {
  await clearRequests();
});

interface RequestBody {
  id: string;
  short_id: string;
  kind: string;
  status: string;
  created_by: string;
  payload: Record<string, unknown>;
  error?: { code: string; message: string };
}

const ANALYSIS = {
  generation_ids: [],
  pose: 'coffee',
  candidates: [
    { tag: 'from above', part: 'framing_tags', score: 0.25, kept: true, d1: null, applied: true },
    { tag: 'looking up', part: 'gesture', score: 0.11, kept: false, d1: 0.53, applied: true },
    { tag: 'leaning forward', part: 'gesture', score: 0.02, kept: false, d1: null, applied: false },
    { tag: 'pantyhose', part: 'legwear', score: 0.03, kept: true, d1: null, applied: true },
  ],
  applied: { framing_tags: ['from above'], gesture: ['looking up'] },
  dropped: [],
};

async function uploadReference(): Promise<RequestBody> {
  const form = new FormData();
  form.append('image', new File([TINY_PNG], 'ref.png'));
  form.append('idempotency_key', crypto.randomUUID());
  return (await req('/api/v1/references', { method: 'POST', body: form }).then((r) => r.json())) as RequestBody;
}

async function analyzedReference(result: Record<string, unknown> = ANALYSIS): Promise<RequestBody> {
  const reference = await uploadReference();
  await postJson('/api/v1/requests/claim', { worker_id: 'w', kinds: ['reference'] });
  const done = await postJson(`/api/v1/requests/${reference.id}`, { status: 'done', worker_id: 'w', result }, 'PATCH');
  expect(done.status).toBe(200);
  return reference;
}

function render(id: string, body: Record<string, unknown>) {
  return postJson<RequestBody>(`/api/v1/references/${id}/renders`, { idempotency_key: crypto.randomUUID(), ...body });
}

describe('migrations/0053 requests_reference_render', () => {
  it('accepts kind reference_render and still rejects an unknown kind', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0053_requests_reference_render.sql')).toBe(true);
    const insert = (kind: string) =>
      env.DB.prepare(
        `INSERT INTO requests (id, kind, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, ?, '{}', 'h', ?, 'gui', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), kind, crypto.randomUUID());
    await insert('reference_render').run();
    await expect(insert('bogus').run()).rejects.toThrow();
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all<{ name: string }>();
    expect(indexes.results.map((r) => r.name)).toEqual(expect.arrayContaining(['idx_requests_reroll_of', 'idx_requests_payload_generation_id']));
  });
});

describe('POST /api/v1/references/{id}/renders', () => {
  it('queues a reference_render from the GUI with the chosen candidates', async () => {
    const reference = await analyzedReference();
    const res = await render(reference.short_id, {
      pose: 'stand',
      seed: 42,
      applied: { framing_tags: ['from above'], gesture: ['leaning forward', 'leaning forward'], mouth: [] },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'reference_render', status: 'queued', created_by: 'gui' });
    expect(res.body.payload).toEqual({
      reference_request_id: reference.id,
      pose: 'stand',
      seed: 42,
      applied: { framing_tags: ['from above'], gesture: ['leaning forward'] },
    });
  });

  it('accepts legwear on a pose that draws legs, and a candidate below score 0.05', async () => {
    const reference = await analyzedReference();
    const res = await render(reference.id, { pose: 'coffee', applied: { legwear: ['pantyhose'] } });
    expect(res.status).toBe(201);
    expect((await render(reference.id, { pose: 'bust', applied: { legwear: [] } })).status).toBe(201);
  });

  it('accepts no seed and no tags', async () => {
    const reference = await analyzedReference();
    const res = await render(reference.id, { pose: 'bust', applied: {} });
    expect(res.status).toBe(201);
    expect(res.body.payload).toEqual({ reference_request_id: reference.id, pose: 'bust', applied: {} });
  });

  it('replays the same key and rejects the same key with other tags', async () => {
    const reference = await analyzedReference();
    const key = crypto.randomUUID();
    const first = await render(reference.id, { idempotency_key: key, pose: 'bust', applied: { gesture: ['looking up'] } });
    const replay = await render(reference.id, { idempotency_key: key, pose: 'bust', applied: { gesture: ['looking up'] } });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect((await render(reference.id, { idempotency_key: key, pose: 'bust', applied: {} })).status).toBe(409);
  });

  it.each([
    ['a tag that is not a candidate', { pose: 'bust', applied: { gesture: ['peace sign'] } }],
    ['a candidate under another part', { pose: 'bust', applied: { mouth: ['looking up'] } }],
    ['legwear on pose bust', { pose: 'bust', applied: { legwear: ['pantyhose'] } }],
    ['a pose outside the list', { pose: 'lounge', applied: {} }],
    ['a negative seed', { pose: 'bust', seed: -1, applied: {} }],
    ['free text in place of tags', { pose: 'bust', applied: 'from above, smile' }],
    ['an unknown key', { pose: 'bust', applied: {}, prompt: 'smile' }],
  ])('rejects %s', async (_label, body) => {
    const reference = await analyzedReference();
    expect((await render(reference.id, body)).status).toBe(400);
  });

  it('rejects a reference that is not analyzed yet', async () => {
    const reference = await uploadReference();
    const res = await render(reference.id, { pose: 'bust', applied: {} });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('reference_not_analyzed');
  });

  it('is 404 for a request that is not a reference', async () => {
    const reference = await analyzedReference();
    const renderRow = await render(reference.id, { pose: 'bust', applied: {} });
    expect((await render(renderRow.body.id, { pose: 'bust', applied: {} })).status).toBe(404);
    expect((await render(crypto.randomUUID(), { pose: 'bust', applied: {} })).status).toBe(404);
  });

  it('is the only way to create one', async () => {
    const res = await postJson('/api/v1/requests', {
      kind: 'reference_render',
      payload: { reference_request_id: 'x', pose: 'bust', applied: {} },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(400);
  });

  it('is claimed by the kinds filter', async () => {
    const reference = await analyzedReference();
    const created = await render(reference.id, { pose: 'coffee', applied: {} });
    const claimed = await postJson<RequestBody>('/api/v1/requests/claim', { worker_id: 'w', kinds: ['reference_render'] });
    expect(claimed.body.id).toBe(created.body.id);
  });
});
