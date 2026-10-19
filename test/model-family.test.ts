import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { modelFamilyOf } from '../src/lib/model-family';
import { createJob, createRequest, ingestGeneration } from './helpers';

describe('modelFamilyOf', () => {
  it('classifies by checkpoint name with moss > anima > il priority', () => {
    expect(modelFamilyOf(['hassakuAnima_v13'])).toBe('anima');
    expect(modelFamilyOf(['anima-turbo-v1.1'])).toBe('anima');
    expect(modelFamilyOf(['Illustrious-XL-v0.1'])).toBe('il');
    expect(modelFamilyOf(['animagine-xl-3.1'])).toBe('il');
    expect(modelFamilyOf(['animagine-xl-4.0-opt'])).toBe('il');
    expect(modelFamilyOf(['hassaku-il-v22', 'anima_baseV10'])).toBe('anima');
    expect(modelFamilyOf(['MOSS-v1', 'anima_baseV10'])).toBe('moss');
    expect(modelFamilyOf(['SILVERMOONMIXANIMAEVOLVED'])).toBe('anima');
    expect(modelFamilyOf([])).toBeNull();
  });
});

async function ingestWithFacts(checkpoints: string[] | null, sourceGenerationId?: string) {
  const request = await createRequest();
  const job = await createJob(request.body.id, sourceGenerationId ? { source_generation_id: sourceGenerationId } : {});
  if (checkpoints) {
    await env.DB.prepare('UPDATE comfy_jobs SET render_facts_json = ? WHERE id = ?')
      .bind(JSON.stringify({ version: 2, checkpoints }), job.body.id)
      .run();
  }
  const result = await ingestGeneration(job.body.id, { seed: 1, original_filename: 'a.png', comfy_output_index: 0 });
  const row = await env.DB.prepare('SELECT model_family FROM generations WHERE id = ?').bind(result.body.id).first<{ model_family: string | null }>();
  return { id: result.body.id, family: row?.model_family ?? null };
}

describe('model_family at ingest', () => {
  it('derives from render facts, falls back to the graph, and is NULL with neither', async () => {
    expect((await ingestWithFacts(['hassakuAnima_v13'])).family).toBe('anima');
    expect((await ingestWithFacts(['NoobAI-XL-v1.1'])).family).toBe('il');
    expect((await ingestWithFacts(null)).family).toBeNull();

    const request = await createRequest();
    const job = await createJob(request.body.id);
    await env.DB.prepare('UPDATE comfy_jobs SET graph = ? WHERE id = ?')
      .bind(JSON.stringify({ '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'anima_baseV10.safetensors' } } }), job.body.id)
      .run();
    const result = await ingestGeneration(job.body.id, { seed: 1, original_filename: 'a.png', comfy_output_index: 0 });
    const row = await env.DB.prepare('SELECT model_family FROM generations WHERE id = ?').bind(result.body.id).first<{ model_family: string | null }>();
    expect(row?.model_family).toBe('anima');
  });

  it('inherits the parent family for a refined Generation regardless of its own facts', async () => {
    const parent = await ingestWithFacts(['hassakuAnima_v13']);
    const child = await ingestWithFacts(['NoobAI-XL-v1.1'], parent.id);
    expect(child.family).toBe('anima');
  });
});

describe('migrations/0050 backfill', () => {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name === '0050_generations_model_family.sql');

  it('re-running the backfill reproduces the ingest-time families, including refined chains', async () => {
    expect(migration).toBeDefined();
    const raw = await ingestWithFacts(['hassaku-il-v22', 'anima_baseV10']);
    const il = await ingestWithFacts(['animagine-xl-3.1']);
    const none = await ingestWithFacts(null);
    const c1 = await ingestWithFacts(['x'], raw.id);
    const c2 = await ingestWithFacts(['x'], c1.id);
    const c3 = await ingestWithFacts(['x'], c2.id);
    await env.DB.prepare('UPDATE generations SET model_family = NULL').run();

    // 先頭の ALTER TABLE は列が既にあるので飛ばし、backfill の UPDATE だけを流す。
    for (const query of migration!.queries.filter((q) => !/ALTER TABLE/i.test(q))) await env.DB.prepare(query).run();

    const family = async (id: string) =>
      (await env.DB.prepare('SELECT model_family FROM generations WHERE id = ?').bind(id).first<{ model_family: string | null }>())?.model_family;
    expect(await family(raw.id)).toBe('anima');
    expect(await family(il.id)).toBe('il');
    expect(await family(none.id)).toBeNull();
    expect(await family(c1.id)).toBe('anima');
    expect(await family(c2.id)).toBe('anima');
    expect(await family(c3.id)).toBe('anima');
  });
});

