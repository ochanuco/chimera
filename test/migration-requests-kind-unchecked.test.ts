import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { postJson } from './helpers';

describe('migrations/0058 requests_kind_unchecked', () => {
  it('leaves kind to the API: the table takes any kind and keeps its columns and indexes', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0058_requests_kind_unchecked.sql')).toBe(true);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO requests (id, kind, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at, worker_version)
       VALUES (?, 'a_kind_added_later', '{}', 'h', ?, 'gui', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'r1-abc')`,
    )
      .bind(id, crypto.randomUUID())
      .run();
    const row = await env.DB.prepare('SELECT kind, worker_version FROM requests WHERE id = ?').bind(id).first();
    expect(row).toEqual({ kind: 'a_kind_added_later', worker_version: 'r1-abc' });

    const table = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'").first<{ sql: string }>();
    expect(table?.sql).not.toMatch(/CHECK \(kind/);
    expect(table?.sql).toMatch(/CHECK \(status IN/);

    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all<{ name: string }>();
    expect(indexes.results.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'idx_requests_status_created_at',
        'idx_requests_run_id',
        'idx_requests_worker_id',
        'idx_requests_short_id',
        'idx_requests_reroll_of',
        'idx_requests_payload_generation_id',
      ]),
    );
  });

  it('still rejects an unknown kind at the API', async () => {
    const res = await postJson('/api/v1/requests', {
      kind: 'bogus',
      payload: { schema_version: 1, request: { instruction: 'x' }, generation: { recipe: 'yukari', parameters: {} } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(400);
  });
});
