import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, createRequest, postJson } from './helpers';

const migration = (name: string) => env.TEST_MIGRATIONS.find((m) => m.name === name)!;

async function columns(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

async function replay(name: string): Promise<void> {
  for (const query of migration(name).queries) await env.DB.prepare(query).run();
}

describe('migrations/0061-0064 drop unused columns and characters', () => {
  it('leaves no unused column or characters table behind', async () => {
    expect(await columns('generations')).not.toContain('note');
    expect(await columns('generations')).not.toContain('character_id');
    expect(await columns('experiments')).not.toContain('character_id');
    expect(await columns('tags')).not.toContain('description');
    expect(await columns('recipe_catalogs')).not.toContain('worker_id');
    const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'characters'").first();
    expect(table).toBeNull();
  });

  it('rebuilding generations keeps its rows, cascading children and indexes', async () => {
    const { generation } = await createGeneration();
    const tag = await postJson<{ id: string }>(`/api/v1/generations/${generation.id}/tags`, { name: `m63-${crypto.randomUUID()}` });
    expect(tag.status).toBe(201);
    const target = await createRequest({ references: [{ source_generation_id: generation.id, purpose: 'derive' }] });
    const referencesBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM request_references WHERE source_generation_id = ?')
      .bind(generation.id)
      .first<{ n: number }>();
    expect(referencesBefore?.n).toBe(1);

    await replay('0063_generations_drop_character_note.sql');

    expect(await env.DB.prepare('SELECT id FROM generations WHERE id = ?').bind(generation.id).first()).not.toBeNull();
    const tags = await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_tags WHERE generation_id = ?').bind(generation.id).first<{ n: number }>();
    expect(tags?.n).toBe(1);
    const referencesAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM request_references WHERE source_generation_id = ?')
      .bind(generation.id)
      .first<{ n: number }>();
    expect(referencesAfter?.n).toBe(referencesBefore?.n);
    expect(target.status).toBe(201);
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'generations'").all<{ name: string }>();
    expect((results ?? []).map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'idx_generations_rating',
        'idx_generations_bookmark',
        'idx_generations_created_at',
        'idx_generations_original_filename',
        'idx_generations_request_id',
        'idx_generations_refines_generation_id',
      ]),
    );
  });

  it('rebuilding experiments keeps its rows and tags', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: `m62-${crypto.randomUUID()}` });
    expect(experiment.status).toBe(201);
    const tag = await postJson(`/api/v1/experiments/${experiment.body.id}/tags`, { name: `m62-${crypto.randomUUID()}` });
    expect(tag.status).toBe(201);

    await replay('0062_experiments_drop_character.sql');

    expect(await env.DB.prepare('SELECT id FROM experiments WHERE id = ?').bind(experiment.body.id).first()).not.toBeNull();
    const tags = await env.DB.prepare('SELECT COUNT(*) AS n FROM experiment_tags WHERE experiment_id = ?').bind(experiment.body.id).first<{ n: number }>();
    expect(tags?.n).toBe(1);
  });
});
