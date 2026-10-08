import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration } from './helpers';

describe('migrations/0037 requests_dof and 0038 workbenches', () => {
  it('accepts kind dof and still rejects an unknown kind', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0037_requests_dof.sql')).toBe(true);
    const insert = (kind: string) =>
      env.DB.prepare(
        `INSERT INTO requests (id, kind, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, ?, '{}', 'h', ?, 'gui', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), kind, crypto.randomUUID());
    await insert('dof').run();
    await expect(insert('bogus').run()).rejects.toThrow();
  });

  it('creates workbenches with one row per root Generation', async () => {
    const { generation } = await createGeneration();
    const insert = () =>
      env.DB.prepare(
        `INSERT INTO workbenches (id, root_generation_id, created_at, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), generation.id);
    await insert().run();
    const row = await env.DB.prepare('SELECT picks_json FROM workbenches WHERE root_generation_id = ?').bind(generation.id).first<{ picks_json: string }>();
    expect(row?.picks_json).toBe('{}');
    await expect(insert().run()).rejects.toThrow();
  });
});
