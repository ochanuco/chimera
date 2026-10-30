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

describe('migrations/0055 presets_drop_retired_recipes', () => {
  it('deletes yukari-il and yukari-sketch presets and their pins, keeps yukari, and is safe to run again', async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0055_'));
    expect(migration?.name).toBe('0055_presets_drop_retired_recipes.sql');

    const { generation } = await createGeneration();
    await insertPreset('yukari', 'pose', 'bust', generation.id);
    await insertPreset('yukari-il', 'pose', 'lap', generation.id);
    await insertPreset('yukari-sketch', 'pose', 'bust', generation.id);
    await insertReference('yukari', 'pose', 'bust', generation.id);
    await insertReference('yukari-sketch', 'pose', 'bust', generation.id);

    for (let run = 0; run < 2; run++) {
      for (const query of migration!.queries) await env.DB.prepare(query).run();
    }

    const presets = await env.DB.prepare('SELECT recipe FROM presets').all<{ recipe: string }>();
    expect(presets.results).toEqual([{ recipe: 'yukari' }]);
    const refs = await env.DB.prepare('SELECT recipe FROM preset_references').all<{ recipe: string }>();
    expect(refs.results).toEqual([{ recipe: 'yukari' }]);
    const generations = await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first<{ n: number }>();
    expect(generations?.n).toBe(1);
  });
});
