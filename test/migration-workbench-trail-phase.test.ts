import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration } from './helpers';

const migration = env.TEST_MIGRATIONS.find((m) => m.name === '0060_workbench_trail_phase.sql');

async function convert(picks: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { generation } = await createGeneration();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO workbenches (id, root_generation_id, picks_json, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
  )
    .bind(id, generation.id, JSON.stringify(picks))
    .run();
  for (const query of migration!.queries) await env.DB.prepare(query).run();
  const row = await env.DB.prepare('SELECT picks_json FROM workbenches WHERE id = ?').bind(id).first<{ picks_json: string }>();
  await env.DB.prepare('DELETE FROM workbenches').run();
  return JSON.parse(row!.picks_json) as Record<string, unknown>;
}

describe('migrations/0060 workbench_trail_phase', () => {
  it('shifts phases 5..6 up to 6..7 and skips phase 5 when a later phase was reached', async () => {
    expect(migration).toBeDefined();
    expect(
      await convert({
        '1': { generation_id: 'r' },
        '2': { skip: true },
        '3': { generation_id: 'd' },
        '4': { generation_id: 's' },
        '5': { skip: true },
        '6': { generation_id: 'f' },
      }),
    ).toEqual({
      '1': { generation_id: 'r' },
      '2': { skip: true },
      '3': { generation_id: 'd' },
      '4': { generation_id: 's' },
      '5': { skip: true },
      '6': { skip: true },
      '7': { generation_id: 'f' },
    });
    expect(await convert({ '4': { generation_id: 's' }, '5': { generation_id: 'l' } })).toEqual({
      '4': { generation_id: 's' },
      '5': { skip: true },
      '6': { generation_id: 'l' },
    });
  });

  it('writes nothing for phases never reached', async () => {
    expect(await convert({ '1': { generation_id: 'r' }, '4': { generation_id: 's' } })).toEqual({ '1': { generation_id: 'r' }, '4': { generation_id: 's' } });
    expect(await convert({})).toEqual({});
  });
});
