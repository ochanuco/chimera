import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall } from './helpers';

interface GenerationDetail {
  comfy_job: { prompt_not_reusable: { reason: string; message: string } | null } | null;
}

describe('render_facts prompt reuse warning (comfy_job.prompt_not_reusable)', () => {
  it('flags a repair batch', async () => {
    const { generation } = await createGeneration({ batchOverrides: { parameters: { kind: 'repair' } } });

    const res = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.comfy_job?.prompt_not_reusable?.reason).toBe('repair');
    expect(res.body.comfy_job?.prompt_not_reusable?.message).toContain('masked hands/feet repair');
  });

  it('flags a masked_redraw batch', async () => {
    const { generation } = await createGeneration({ batchOverrides: { parameters: { kind: 'masked_redraw' } } });

    const res = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.comfy_job?.prompt_not_reusable?.reason).toBe('masked_redraw');
    expect(res.body.comfy_job?.prompt_not_reusable?.message).toContain('masked region redraw');
  });

  it('flags a hires-chain batch that also ran a repair pass as finalize_repair', async () => {
    const { generation } = await createGeneration({
      batchOverrides: {
        parameters: {
          kind: 'hires-chain',
          repair: { parts: ['hand'], regions: ['left_hand'], denoise: 0.4, pad: 32, size: 512, mask_bbox: [0, 0, 10, 10] },
        },
      },
    });

    const res = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.comfy_job?.prompt_not_reusable?.reason).toBe('finalize_repair');
    expect(res.body.comfy_job?.prompt_not_reusable?.message).toContain('masked hands/feet repair pass');
  });

  it('does not flag a hires-chain batch without a repair pass', async () => {
    const { generation } = await createGeneration({
      batchOverrides: { parameters: { kind: 'hires-chain', size: 2560 } },
    });

    const res = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.comfy_job?.prompt_not_reusable).toBeNull();
  });

  it('does not flag a plain generate batch', async () => {
    const { generation } = await createGeneration();

    const res = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.comfy_job?.prompt_not_reusable).toBeNull();
  });

  it('MCP get_generation reports the same field', async () => {
    const { generation } = await createGeneration({ batchOverrides: { parameters: { kind: 'repair' } } });

    const tool = await mcpToolCall<GenerationDetail>('get_generation', { generation_id: generation.id });
    expect(tool.isError).toBe(false);
    expect(tool.data?.comfy_job?.prompt_not_reusable?.reason).toBe('repair');
  });
});
