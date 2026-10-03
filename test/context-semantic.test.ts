import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createRequest, createGeneration, createJob, getJson, ingestGeneration, postJson, setJobGraph } from './helpers';

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
  references: unknown[];
}

describe('Generation context API', () => {
  it('returns the documented shape', async () => {
    const { generation } = await createGeneration();

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
      references: [],
    });
    expect(res.body).not.toHaveProperty('batch');
    expect(res.body.image.url).toBe(`https://chimera.test/g/${generation.short_id}/image`);
  });

  it('accepts short_id in the path', async () => {
    const { generation } = await createGeneration();
    const res = await getJson<ContextShape>(`/api/v1/generations/${generation.short_id}/context`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(generation.id);
  });

  it('full detail includes the request block (prompt from the first job) and comfy_job', async () => {
    const { generation, job } = await createGeneration({ requestOverrides: { recipe: 'dq3', parameters: { pose: 'standing' } } });
    await setJobGraph(job.id, {
      '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, positive: ['6', 0], negative: ['7', 0] } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'p1' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'n1' } },
    });

    const res = await getJson<{
      request: { id: string; kind: string; prompt: string; negative_prompt: string; recipe: string; parameters: { pose: string }; patches: unknown; git_dirty: boolean };
      siblings: unknown[];
      comfy_job: { id: string; seed: number };
      original_filename: string;
    }>(`/api/v1/generations/${generation.id}`);

    expect(res.status).toBe(200);
    expect(res.body.request.prompt).toBe('p1');
    expect(res.body.request.negative_prompt).toBe('n1');
    expect(res.body.request.recipe).toBe('dq3');
    expect(res.body.request.kind).toBe('generate');
    expect(res.body.request.parameters).toEqual({ pose: 'standing' });
    expect(res.body.request.git_dirty).toBe(false);
    expect(res.body.siblings).toEqual([]);
    expect(res.body.comfy_job.id).toBe(job.id);
    expect(res.body.original_filename).toBeTruthy();
  });
});

describe('Generation request block and siblings', () => {
  it('context carries the request block and every generation of the same request; detail lists the others as siblings', async () => {
    const request = await createRequest({ recipe: 'dq3', parameters: { pose: 'standing' }, raw_instruction: 'two seeds' });
    const jobA = await createJob(request.body.id, { seed: 1 });
    const jobB = await createJob(request.body.id, { seed: 2 });
    const a = await ingestGeneration(jobA.body.id, { seed: 1, original_filename: 'a.png', comfy_output_index: 0 });
    const b = await ingestGeneration(jobB.body.id, { seed: 2, original_filename: 'b.png', comfy_output_index: 0 });

    const context = await getJson<{
      request: { id: string; short_id: string; kind: string; recipe: string; raw_instruction: string; parameters: unknown } | null;
      generations: { id: string; short_id: string; image_width: number | null; image_height: number | null; comfy_output_index: number | null }[];
    }>(`/api/v1/generations/${a.body.id}/context`);
    expect(context.status).toBe(200);
    expect(context.body.request).toMatchObject({
      short_id: request.body.short_id,
      kind: 'generate',
      recipe: 'dq3',
      raw_instruction: 'two seeds',
      parameters: { pose: 'standing' },
    });
    expect(context.body.generations.map((g) => g.id).sort()).toEqual([a.body.id, b.body.id].sort());
    expect(context.body.generations[0]).toHaveProperty('image_width');
    expect(context.body.generations[0]).toHaveProperty('comfy_output_index');

    const detail = await getJson<{ siblings: { id: string; short_id: string }[] }>(`/api/v1/generations/${a.body.id}`);
    expect(detail.body.siblings.map((g) => g.id)).toEqual([b.body.id]);
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
