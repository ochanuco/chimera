import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, postJson } from './helpers';

interface ContextShape {
  id: string;
  short_id: string;
  canonical_url: string;
  image: { url: string };
  character: unknown;
  created_at: string;
  rating: string | null;
  bookmark: boolean;
  tags: string[];
  note: string | null;
  summary: string | null;
  semantic: unknown;
  batch: { id: string };
  references: unknown[];
}

describe('Generation context API', () => {
  it('returns the documented shape', async () => {
    const { generation, batch } = await createGeneration();

    const res = await getJson<ContextShape>(`/api/v1/generations/${generation.id}/context`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: generation.id,
      canonical_url: generation.canonical_url,
      character: null,
      rating: null,
      bookmark: false,
      tags: [],
      summary: null,
      semantic: null,
      batch: { id: batch.id },
      references: [],
    });
    expect(res.body.image.url).toBe(`https://chimera.test/g/${generation.short_id}/image`);
  });

  it('accepts short_id in the path', async () => {
    const { generation } = await createGeneration();
    const res = await getJson<ContextShape>(`/api/v1/generations/${generation.short_id}/context`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(generation.id);
  });

  it('full detail includes batch prompt/recipe and comfy_job', async () => {
    const { generation, job } = await createGeneration({ batchOverrides: { prompt: 'p1', recipe: 'dq3' } });

    const res = await getJson<{
      batch: { prompt: string; recipe: string };
      comfy_job: { id: string; seed: number };
      original_filename: string;
    }>(`/api/v1/generations/${generation.id}`);

    expect(res.status).toBe(200);
    expect(res.body.batch.prompt).toBe('p1');
    expect(res.body.batch.recipe).toBe('dq3');
    expect(res.body.comfy_job.id).toBe(job.id);
    expect(res.body.original_filename).toBeTruthy();
  });
});

describe('Semantic update', () => {
  it('PUT semantic is reflected in the context response', async () => {
    const { generation } = await createGeneration();

    const put = await postJson(
      `/api/v1/generations/${generation.id}/semantic`,
      {
        schema_version: 1,
        summary: 'a good pose',
        core: { pose: 'standing', expression: 'smile', outfit: null, style: null, composition: null },
        strengths: ['nice hands'],
        defects: [],
        attributes: { lighting: 'soft' },
        generated_by: { provider: 'anthropic', model: 'claude-test' },
      },
      'PUT',
    );
    expect(put.status).toBe(200);

    const context = await getJson<ContextShape & { semantic: { schema_version: number; core: { pose: string } } }>(
      `/api/v1/generations/${generation.id}/context`,
    );
    expect(context.body.summary).toBe('a good pose');
    expect(context.body.semantic.schema_version).toBe(1);
    expect(context.body.semantic.core.pose).toBe('standing');
  });
});
