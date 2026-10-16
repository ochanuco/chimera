import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration } from './helpers';

const migration = env.TEST_MIGRATIONS.find((m) => m.name === '0048_workbench_saturation_phase.sql');

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

describe('migrations/0048 workbench_saturation_phase', () => {
  it('shifts phases 3..5 up to 4..6 and skips phase 3 when a later phase was reached', async () => {
    expect(migration).toBeDefined();
    expect(
      await convert({
        '1': { generation_id: 'r' },
        '2': { generation_id: 'd' },
        '3': { generation_id: 's' },
        '4': { skip: true },
        '5': { generation_id: 'f' },
      }),
    ).toEqual({
      '1': { generation_id: 'r' },
      '2': { generation_id: 'd' },
      '3': { skip: true },
      '4': { generation_id: 's' },
      '5': { skip: true },
      '6': { generation_id: 'f' },
    });
  });

  it('writes nothing for phases never reached', async () => {
    expect(await convert({ '1': { generation_id: 'r' }, '2': { generation_id: 'd' } })).toEqual({ '1': { generation_id: 'r' }, '2': { generation_id: 'd' } });
    expect(await convert({})).toEqual({});
  });
});
