import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration } from './helpers';

async function insertPreset(recipe: string, kind: string, name: string, generationId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, created_by, created_at)
     VALUES (?, ?, ?, ?, 1, '{"options":{}}', 'active', 'promote', ?, 'test', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(crypto.randomUUID(), recipe, kind, name, generationId)
    .run();
}

async function insertReference(recipe: string, kind: string, name: string, generationId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO preset_references (id, recipe, kind, name, generation_id, source_generation_id, seed, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'test', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(crypto.randomUUID(), recipe, kind, name, generationId, generationId)
    .run();
}

describe('migrations/0036 presets_drop_finalize', () => {
  it('deletes finalize presets and their pins, keeps every other kind, and is safe to run again', async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0036_'));
    expect(migration?.name).toBe('0036_presets_drop_finalize.sql');

    const { generation } = await createGeneration();
    await insertPreset('r', 'finalize', 'daily', generation.id);
    await insertPreset('r', 'pose', 'lounge', generation.id);
    await insertPreset('r', 'deliver', 'daily', generation.id);
    await insertReference('r', 'finalize', 'daily', generation.id);
    await insertReference('r', 'pose', 'lounge', generation.id);

    for (let run = 0; run < 2; run++) {
      for (const query of migration!.queries) await env.DB.prepare(query).run();
    }

    const presets = await env.DB.prepare('SELECT kind, name FROM presets ORDER BY kind').all<{ kind: string; name: string }>();
    expect(presets.results).toEqual([
      { kind: 'deliver', name: 'daily' },
      { kind: 'pose', name: 'lounge' },
    ]);
    const refs = await env.DB.prepare('SELECT kind FROM preset_references').all<{ kind: string }>();
    expect(refs.results).toEqual([{ kind: 'pose' }]);
    const generations = await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first<{ n: number }>();
    expect(generations?.n).toBe(1);
  });
});
