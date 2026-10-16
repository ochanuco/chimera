import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('migrations/0047 requests_saturation', () => {
  it('accepts kind saturation, keeps the reroll index, and still rejects an unknown kind', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0047_requests_saturation.sql')).toBe(true);
    const insert = (kind: string) =>
      env.DB.prepare(
        `INSERT INTO requests (id, kind, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, ?, '{}', 'h', ?, 'gui', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), kind, crypto.randomUUID());
    await insert('saturation').run();
    await expect(insert('bogus').run()).rejects.toThrow();
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all<{ name: string }>();
    expect(indexes.results.map((r) => r.name)).toContain('idx_requests_reroll_of');
  });
});
