import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRequests, postJson, req } from './helpers';

beforeEach(async () => {
  await clearRequests();
});

interface RequestBody {
  id: string;
  kind: string;
  status: string;
  created_by: string;
  payload: Record<string, unknown>;
}

function create(payload: unknown, createdBy = 'gui') {
  return postJson<RequestBody>('/api/v1/requests', { kind: 'reference', payload, idempotency_key: crypto.randomUUID(), created_by: createdBy });
}

function claim(kinds?: string[]) {
  return req('/api/v1/requests/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: 'w', ...(kinds ? { kinds } : {}) }),
  });
}

describe('migrations/0052 requests_reference', () => {
  it('accepts kind reference, keeps the indexes, and still rejects an unknown kind', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0052_requests_reference.sql')).toBe(true);
    const insert = (kind: string) =>
      env.DB.prepare(
        `INSERT INTO requests (id, kind, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, ?, '{}', 'h', ?, 'gui', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), kind, crypto.randomUUID());
    await insert('reference').run();
    await expect(insert('bogus').run()).rejects.toThrow();
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all<{ name: string }>();
    const names = indexes.results.map((r) => r.name);
    expect(names).toContain('idx_requests_reroll_of');
    expect(names).toContain('idx_requests_payload_generation_id');
  });
});

describe('reference request', () => {
  it.each([
    ['no seed', { recipe: 'yukari' }],
    ['a seed', { recipe: 'yukari', seed: 123456 }],
  ])('accepts %s', async (_label, payload) => {
    const res = await create(payload);
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('reference');
    expect(res.body.status).toBe('queued');
    expect(res.body.payload).toEqual(payload);
  });

  it.each([
    ['no recipe', { seed: 1 }],
    ['a negative seed', { recipe: 'yukari', seed: -1 }],
    ['a fractional seed', { recipe: 'yukari', seed: 1.5 }],
    ['an unknown key', { recipe: 'yukari', image: 'x' }],
  ])('rejects %s', async (_label, payload) => {
    expect((await create(payload)).status).toBe(400);
  });

  it('is claimed by the kinds filter and by an omitted filter', async () => {
    const first = await create({ recipe: 'yukari' });
    const byFilter = await claim(['reference']);
    expect(((await byFilter.json()) as RequestBody).id).toBe(first.body.id);
    const second = await create({ recipe: 'yukari' });
    const byDefault = await claim();
    expect(((await byDefault.json()) as RequestBody).id).toBe(second.body.id);
  });

  it('is not claimed by a worker that does not ask for it', async () => {
    await create({ recipe: 'yukari' });
    expect((await claim(['generate'])).status).toBe(204);
  });

  it('lists by kind', async () => {
    const created = await create({ recipe: 'yukari' });
    const res = await req('/api/v1/requests?kind=reference');
    const body = (await res.json()) as { items: RequestBody[] };
    expect(body.items.map((r) => r.id)).toEqual([created.body.id]);
  });
});

describe('generate from the worker', () => {
  it('accepts created_by system', async () => {
    const res = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'generate',
      payload: { schema_version: 1, request: { instruction: '参考画像から: bust' }, generation: { recipe: 'yukari' } },
      idempotency_key: `reference:${crypto.randomUUID()}`,
      created_by: 'system',
    });
    expect(res.status).toBe(201);
    expect(res.body.created_by).toBe('system');
  });
});
