import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('migrations/0042 requests_lens', () => {
  it('accepts kind lens, keeps the reroll column and index, and still rejects an unknown kind', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0042_requests_lens.sql')).toBe(true);
    const insert = (kind: string) =>
      env.DB.prepare(
        `INSERT INTO requests (id, kind, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, ?, '{}', 'h', ?, 'gui', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), kind, crypto.randomUUID());
    await insert('lens').run();
    await expect(insert('bogus').run()).rejects.toThrow();
    const columns = await env.DB.prepare('PRAGMA table_info(requests)').all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toContain('reroll_of_generation_id');
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all<{ name: string }>();
    expect(indexes.results.map((r) => r.name)).toContain('idx_requests_reroll_of');
  });
});
