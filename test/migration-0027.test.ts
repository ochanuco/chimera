import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration } from './helpers';

interface ColumnInfo {
  name: string;
  notnull: number;
}

async function columns(table: string): Promise<ColumnInfo[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<ColumnInfo>();
  return results ?? [];
}

async function foreignKeys(table: string): Promise<{ table: string; from: string; on_delete: string }[]> {
  const { results } = await env.DB.prepare(`PRAGMA foreign_key_list(${table})`).all<{ table: string; from: string; on_delete: string }>();
  return results ?? [];
}

async function schemaNames(type: 'table' | 'index'): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT name FROM sqlite_master WHERE type = ?').bind(type).all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

describe('migration 0027 (drop batches)', () => {
  it('leaves no Batch or Story table, column or index behind', async () => {
    const tables = await schemaNames('table');
    for (const gone of ['batches', 'batch_relations', 'batch_references', 'batch_tags', 'story_relations', 'stories', 'story_tags']) {
      expect(tables, gone).not.toContain(gone);
    }
    expect(tables).not.toContain('_m27_generations');

    for (const table of ['comfy_jobs', 'generations', 'experiment_runs']) {
      expect((await columns(table)).map((c) => c.name), table).not.toContain('batch_id');
    }
    const indexes = await schemaNames('index');
    expect(indexes.filter((n) => n.includes('batch') || n.includes('story'))).toEqual([]);
  });

  it('keeps every index and the NOT NULL request_id of the rebuilt tables', async () => {
    const indexes = await schemaNames('index');
    for (const expected of [
      'idx_generations_character_id',
      'idx_generations_rating',
      'idx_generations_bookmark',
      'idx_generations_created_at',
      'idx_generations_original_filename',
      'idx_generations_request_id',
      'idx_generations_refines_generation_id',
      'idx_comfy_jobs_comfy_prompt_id',
      'idx_comfy_jobs_request_id',
      'idx_comfy_jobs_source_generation_id',
      'idx_experiment_runs_experiment_id',
      'idx_experiment_runs_parent_run_id',
      'idx_experiment_runs_generation_id',
      'idx_experiment_runs_idempotency_key',
    ]) {
      expect(indexes, expected).toContain(expected);
    }

    const generationColumns = await columns('generations');
    expect(generationColumns.find((c) => c.name === 'request_id')?.notnull).toBe(1);
    const jobColumns = await columns('comfy_jobs');
    expect(jobColumns.find((c) => c.name === 'request_id')?.notnull).toBe(1);
  });

  it('keeps the foreign keys that point at the rebuilt tables', async () => {
    const referencing: [string, string, string][] = [
      ['generation_tags', 'generation_id', 'generations'],
      ['request_references', 'source_generation_id', 'generations'],
      ['generation_assets', 'generation_id', 'generations'],
      ['generation_publications', 'generation_id', 'generations'],
      ['preset_references', 'generation_id', 'generations'],
      ['pairwise_judgments', 'left_generation_id', 'generations'],
      ['experiments', 'base_generation_id', 'generations'],
      ['experiment_runs', 'generation_id', 'generations'],
      ['comfy_jobs', 'source_generation_id', 'generations'],
      ['generations', 'refines_generation_id', 'generations'],
      ['generations', 'comfy_job_id', 'comfy_jobs'],
      ['generations', 'request_id', 'requests'],
      ['comfy_jobs', 'request_id', 'requests'],
      ['pairwise_judgments', 'baseline_run_id', 'experiment_runs'],
      ['experiment_promotions', 'source_run_id', 'experiment_runs'],
      ['experiment_runs', 'parent_run_id', 'experiment_runs'],
      ['requests', 'run_id', 'experiment_runs'],
    ];
    for (const [table, from, target] of referencing) {
      const found = (await foreignKeys(table)).some((fk) => fk.from === from && fk.table === target);
      expect(found, `${table}.${from} -> ${target}`).toBe(true);
    }
    const tagCascade = (await foreignKeys('generation_tags')).find((fk) => fk.from === 'generation_id');
    expect(tagCascade?.on_delete).toBe('CASCADE');
  });

  it('has no dangling foreign key after the rebuild', async () => {
    await createGeneration();
    const { results } = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(results).toEqual([]);
  });
});
