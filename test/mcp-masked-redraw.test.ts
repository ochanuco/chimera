import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, mcpToolCall } from './helpers';

interface RequestResult {
  created: boolean;
  request: {
    id: string;
    kind: string;
    created_by: string;
    payload: Record<string, unknown>;
  };
}

describe('MCP redraw_generation cut', () => {
  it('passes cut through to the queued payload', async () => {
    const { generation } = await createGeneration();
    const options = { method: 'hires', hires: 2048, cut: true };
    const call = await mcpToolCall<RequestResult>('redraw_generation', {
      generation_id: generation.short_id,
      options,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id, options });
  });
});

describe('masked_redraw rows made before the feature was removed', () => {
  it('still show their refinement lineage', async () => {
    const { request: sourceRequest, generation: sourceGeneration } = await createGeneration({
      requestOverrides: { recipe: 'yukari-sketch' },
    });
    const promptPatch = 'long loose A-line mid-calf dress';
    const options = { regions: [[0.18, 0.42, 0.86, 0.96]], prompt_patch: promptPatch, denoise: 0.5, mask_padding: 24, mask_feather: 8 };

    // This is the worker-side adapter contract: output is a new masked_redraw Request whose Job points at the
    // source Generation, and the source row is never reused.
    const target = await createGeneration({
      requestOverrides: {
        kind: 'masked_redraw',
        recipe: 'yukari-sketch',
        raw_instruction: promptPatch,
        parameters: {
          kind: 'masked_redraw',
          source_generation_id: sourceGeneration.id,
          options,
        },
      },
      jobOverrides: { source_generation_id: sourceGeneration.id },
      metadata: { seed: 42, original_filename: 'masked-redraw.png' },
    });
    expect(target.request.id).not.toBe(sourceRequest.id);
    const targetGeneration = { body: target.generation };
    expect(targetGeneration.body.id).not.toBe(sourceGeneration.id);

    const lineage = await mcpToolCall<{
      ancestors: { via: string; purpose_or_kind: string | null; request: { id: string } }[];
    }>('get_generation_lineage', { generation_id: targetGeneration.body.id });
    expect(lineage.isError).toBe(false);
    expect(lineage.data?.ancestors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ via: 'refinement', purpose_or_kind: 'masked_redraw', request: expect.objectContaining({ id: sourceRequest.id }) }),
      ]),
    );
    const refined = await env.DB.prepare('SELECT refines_generation_id FROM generations WHERE id = ?')
      .bind(targetGeneration.body.id)
      .first<{ refines_generation_id: string | null }>();
    expect(refined?.refines_generation_id).toBe(sourceGeneration.id);
  });
});
