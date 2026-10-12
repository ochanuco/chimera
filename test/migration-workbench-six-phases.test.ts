import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration } from './helpers';

const migration = env.TEST_MIGRATIONS.find((m) => m.name === '0045_workbench_six_phases.sql');

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

describe('migrations/0045 workbench_six_phases', () => {
  it('moves a light pick into phase 1 and shifts the parts, delivery and dof picks', async () => {
    expect(migration).toBeDefined();
    expect(
      await convert({
        '1': { generation_id: 'h' },
        '2': { generation_id: 'l' },
        '3': { skip: true },
        '4': { generation_id: 'd' },
        '5': { generation_id: 'f' },
      }),
    ).toEqual({ '1': { generation_id: 'l' }, '2': { skip: true }, '3': { generation_id: 'd' }, '4': { skip: true }, '5': { skip: true }, '6': { generation_id: 'f' } });
  });

  it('keeps the hires pick when light was skipped and writes nothing for phases never reached', async () => {
    expect(await convert({ '1': { generation_id: 'h' }, '2': { skip: true } })).toEqual({ '1': { generation_id: 'h' } });
    expect(await convert({})).toEqual({});
  });
});
