import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, createJob, getJson, postJson } from './helpers';

const SAMPLE_GRAPH = {
  '3': { class_type: 'KSampler', inputs: { seed: 123, steps: 20 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
};

describe('Job graph', () => {
  it('stores and returns the posted ComfyUI graph on PATCH', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);

    const patched = await postJson<{ status: string; comfy_prompt_id: string; graph: unknown }>(
      `/api/v1/jobs/${job.body.id}`,
      { status: 'completed', comfy_prompt_id: 'prompt-1', graph: SAMPLE_GRAPH },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.graph).toEqual(SAMPLE_GRAPH);
    expect(patched.body.comfy_prompt_id).toBe('prompt-1');
  });

  it('leaves graph untouched when omitted from a later PATCH', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);

    await postJson(`/api/v1/jobs/${job.body.id}`, { graph: SAMPLE_GRAPH }, 'PATCH');
    const second = await postJson<{ status: string; graph: unknown }>(
      `/api/v1/jobs/${job.body.id}`,
      { status: 'ingested' },
      'PATCH',
    );
    expect(second.body.status).toBe('ingested');
    expect(second.body.graph).toEqual(SAMPLE_GRAPH);
  });

  it('surfaces the graph via the Generation detail endpoint', async () => {
    const { generation, job } = await createGeneration();
    await postJson(`/api/v1/jobs/${job.id}`, { graph: SAMPLE_GRAPH }, 'PATCH');

    const detail = await getJson<{ comfy_job: { graph: unknown } }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.comfy_job.graph).toEqual(SAMPLE_GRAPH);
  });

  it('surfaces the graph via the Batch detail jobs list', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    await postJson(`/api/v1/jobs/${job.body.id}`, { graph: SAMPLE_GRAPH }, 'PATCH');

    const detail = await getJson<{ jobs: { id: string; graph: unknown }[] }>(`/api/v1/batches/${batch.body.id}`);
    const found = detail.body.jobs.find((j) => j.id === job.body.id);
    expect(found?.graph).toEqual(SAMPLE_GRAPH);
  });
});
