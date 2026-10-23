import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { referenceImageKey } from '../src/lib/reference-images';
import { clearRequests, postJson, req, TINY_PNG } from './helpers';

beforeEach(async () => {
  await clearRequests();
  const listed = await env.IMAGES.list({ prefix: 'references/' });
  if (listed.objects.length > 0) await env.IMAGES.delete(listed.objects.map((o) => o.key));
});

interface RequestBody {
  id: string;
  short_id: string;
  kind: string;
  status: string;
  created_by: string;
  payload: Record<string, unknown>;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

async function upload(fields: { image?: Uint8Array | null; seed?: string; idempotency_key?: string | null }) {
  const form = new FormData();
  if (fields.image !== null) form.append('image', new File([fields.image ?? TINY_PNG], 'ref.png'));
  if (fields.seed !== undefined) form.append('seed', fields.seed);
  if (fields.idempotency_key !== null) form.append('idempotency_key', fields.idempotency_key ?? crypto.randomUUID());
  const res = await req('/api/v1/references', { method: 'POST', body: form });
  return { status: res.status, body: (await res.json()) as RequestBody };
}

async function claim(workerId = 'w') {
  return postJson<RequestBody>('/api/v1/requests/claim', { worker_id: workerId, kinds: ['reference'] });
}

function patch(id: string, body: unknown) {
  return postJson<RequestBody>(`/api/v1/requests/${id}`, body, 'PATCH');
}

async function stored(id: string) {
  return env.IMAGES.head(referenceImageKey(id));
}

describe('POST /api/v1/references', () => {
  it('queues a reference request from the GUI and stores the image without a Generation', async () => {
    const res = await upload({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'reference', status: 'queued', created_by: 'gui', payload: { recipe: 'yukari' } });
    const object = await env.IMAGES.get(referenceImageKey(res.body.id));
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(TINY_PNG);
    expect(object!.httpMetadata?.contentType).toBe('image/png');
    const generations = await env.DB.prepare('SELECT COUNT(*) AS n FROM generations WHERE request_id = ?').bind(res.body.id).first<{ n: number }>();
    expect(generations?.n).toBe(0);
  });

  it.each([
    ['jpeg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ])('accepts %s', async (_label, image, contentType) => {
    const res = await upload({ image });
    expect(res.status).toBe(201);
    expect((await stored(res.body.id))?.httpMetadata?.contentType).toBe(contentType);
  });

  it('puts the seed in the payload', async () => {
    const res = await upload({ seed: '424242' });
    expect(res.body.payload).toEqual({ recipe: 'yukari', seed: 424242 });
    const blank = await upload({ seed: '' });
    expect(blank.body.payload).toEqual({ recipe: 'yukari' });
  });

  it.each([
    ['no image', { image: null }],
    ['a non-image file', { image: new TextEncoder().encode('hello') }],
    ['no idempotency_key', { idempotency_key: null }],
    ['a negative seed', { seed: '-1' }],
    ['a non-numeric seed', { seed: 'abc' }],
  ])('rejects %s', async (_label, fields) => {
    expect((await upload(fields)).status).toBe(400);
  });

  it('replays the same key, puts back a missing image, and rejects a different seed', async () => {
    const key = crypto.randomUUID();
    const first = await upload({ idempotency_key: key, seed: '1' });
    await env.IMAGES.delete(referenceImageKey(first.body.id));
    const replay = await upload({ idempotency_key: key, seed: '1' });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(await stored(first.body.id)).not.toBeNull();
    expect((await upload({ idempotency_key: key, seed: '2' })).status).toBe(409);
  });

  it('does not put back the image of a settled request', async () => {
    const key = crypto.randomUUID();
    const first = await upload({ idempotency_key: key });
    await patch(first.body.id, { status: 'cancelled' });
    expect(await stored(first.body.id)).toBeNull();
    expect((await upload({ idempotency_key: key })).status).toBe(200);
    expect(await stored(first.body.id)).toBeNull();
  });
});

describe('GET / DELETE /api/v1/requests/{id}/reference-image', () => {
  it('serves the image, then deletes it idempotently', async () => {
    const { body } = await upload({});
    const got = await req(`/api/v1/requests/${body.id}/reference-image`);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(TINY_PNG);

    expect((await req(`/api/v1/requests/${body.id}/reference-image`, { method: 'DELETE' })).status).toBe(204);
    expect((await req(`/api/v1/requests/${body.id}/reference-image`, { method: 'DELETE' })).status).toBe(204);
    expect((await req(`/api/v1/requests/${body.id}/reference-image`)).status).toBe(404);
  });

  it('is 404 for an unknown request and for a request of another kind', async () => {
    expect((await req(`/api/v1/requests/${crypto.randomUUID()}/reference-image`)).status).toBe(404);
    const other = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'reference',
      payload: { recipe: 'yukari' },
      idempotency_key: crypto.randomUUID(),
      created_by: 'mcp',
    });
    expect((await req(`/api/v1/requests/${other.body.id}/reference-image`)).status).toBe(404);
    const generate = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'generate',
      payload: { schema_version: 1, request: {}, generation: { recipe: 'yukari' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect((await req(`/api/v1/requests/${generate.body.id}/reference-image`)).status).toBe(404);
    expect((await req(`/api/v1/requests/${generate.body.id}/reference-image`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('deleting the image when a reference request settles', () => {
  it('deletes on done', async () => {
    const { body } = await upload({});
    await claim();
    const done = await patch(body.id, { status: 'done', worker_id: 'w', result: { generation_ids: [], generate_request_id: 'x' } });
    expect(done.status).toBe(200);
    expect(await stored(body.id)).toBeNull();
  });

  it('deletes on failed', async () => {
    const { body } = await upload({});
    await claim();
    await patch(body.id, { status: 'failed', worker_id: 'w', error: 'tagger crashed' });
    expect(await stored(body.id)).toBeNull();
  });

  it('deletes on cancelled', async () => {
    const { body } = await upload({});
    await patch(body.id, { status: 'cancelled' });
    expect(await stored(body.id)).toBeNull();
  });

  it('keeps it on a release back to queued, and deletes it once the release exhausts the attempts', async () => {
    const { body } = await upload({});
    await claim();
    await patch(body.id, { status: 'queued', worker_id: 'w' });
    expect(await stored(body.id)).not.toBeNull();

    await env.DB.prepare('UPDATE requests SET max_attempts = 2 WHERE id = ?').bind(body.id).run();
    await claim();
    const released = await patch(body.id, { status: 'queued', worker_id: 'w' });
    expect(released.body.status).toBe('failed');
    expect(await stored(body.id)).toBeNull();
  });

  it('deletes when a stale running row fails on claim, and keeps it when the row goes back to queued', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const exhausted = await upload({});
    const retried = await upload({});
    await env.DB.prepare(`UPDATE requests SET status = 'running', worker_id = 'old', heartbeat_at = ?, attempt = 3 WHERE id = ?`).bind(stale, exhausted.body.id).run();
    await env.DB.prepare(`UPDATE requests SET status = 'running', worker_id = 'old', heartbeat_at = ?, attempt = 1 WHERE id = ?`).bind(stale, retried.body.id).run();
    const claimed = await req('/api/v1/requests/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'w', kinds: ['generate'] }),
    });
    expect(claimed.status).toBe(204);
    expect(await stored(exhausted.body.id)).toBeNull();
    expect(await stored(retried.body.id)).not.toBeNull();
  });
});

describe('scheduled sweep', () => {
  function run(scheduledTime: number) {
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const controller = { scheduledTime, cron: '0 * * * *', noRetry() {} } as ScheduledController;
    return worker.scheduled!(controller, env, ctx).then(() => Promise.all(waits));
  }

  it('deletes reference images uploaded 24 hours ago or more and leaves everything else', async () => {
    const { body } = await upload({});
    const original = `generations/${crypto.randomUUID()}/original.png`;
    await env.IMAGES.put(original, TINY_PNG);

    await run(Date.now() + 23 * 60 * 60 * 1000);
    expect(await stored(body.id)).not.toBeNull();

    await run(Date.now() + 24 * 60 * 60 * 1000 + 1000);
    expect(await stored(body.id)).toBeNull();
    expect(await env.IMAGES.head(original)).not.toBeNull();
    await env.IMAGES.delete(original);
  });
});
