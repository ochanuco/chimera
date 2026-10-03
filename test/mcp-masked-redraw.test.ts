import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall, postJson } from './helpers';

interface RequestResult {
  created: boolean;
  request: {
    id: string;
    kind: string;
    created_by: string;
    payload: Record<string, unknown>;
  };
}

describe('MCP masked_redraw_generation', () => {
  it('queues explicit arbitrary regions and propagates prompt/denoise/padding/feather options', async () => {
    const { generation } = await createGeneration({
      requestOverrides: {
        recipe: 'yukari-sketch',
        parameters: { delivery: 'finalized-size' },
      },
    });
    const before = await getJson<Record<string, unknown>>(`/api/v1/generations/${generation.id}`);
    const options = {
      regions: [
        [0.18, 0.42, 0.5, 0.96],
        [0.56, 0.42, 0.86, 0.96],
      ],
      prompt_patch: 'replace only the waist-to-hem garment with a long loose A-line mid-calf dress',
      denoise: 0.48,
      mask_padding: 24,
      mask_feather: 8,
      size: 768,
      seeds: [101, 202],
    };

    const call = await mcpToolCall<RequestResult>('masked_redraw_generation', {
      generation_id: generation.short_id,
      options,
      idempotency_key: crypto.randomUUID(),
    });

    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.request.kind).toBe('masked_redraw');
    expect(call.data?.request.created_by).toBe('mcp');
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id, options });

    const queued = await getJson<{ kind: string; payload: Record<string, unknown> }>(
      `/api/v1/requests/${call.data?.request.id}`,
    );
    expect(queued.body.kind).toBe('masked_redraw');
    expect(queued.body.payload).toEqual({ generation_id: generation.short_id, options });

    // Queueing never mutates the source Generation or its owning Request.
    const after = await getJson<Record<string, unknown>>(`/api/v1/generations/${generation.id}`);
    expect(after.body).toEqual(before.body);
  });

  it('canonicalizes short pad/feather aliases without changing repair_generation', async () => {
    const { generation } = await createGeneration();
    const options = {
      regions: [[0.1, 0.5, 0.4, 0.9]],
      prompt_patch: 'change the skirt fabric only',
      denoise: 0.35,
      pad: 32,
      feather: 6,
    };
    const masked = await mcpToolCall<RequestResult>('masked_redraw_generation', {
      generation_id: generation.id,
      options,
      idempotency_key: crypto.randomUUID(),
    });
    expect(masked.isError).toBe(false);
    expect(masked.data?.request.kind).toBe('masked_redraw');
    expect(masked.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: {
        regions: options.regions,
        prompt_patch: options.prompt_patch,
        denoise: options.denoise,
        mask_padding: options.pad,
        mask_feather: options.feather,
      },
    });

    const repair = await mcpToolCall<RequestResult>('repair_generation', {
      generation_id: generation.id,
      options: { parts: ['hands', 'feet'], denoise: 0.6, pad: 1.2 },
      idempotency_key: crypto.randomUUID(),
    });
    expect(repair.isError).toBe(false);
    expect(repair.data?.request.kind).toBe('repair');
    expect(repair.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: { parts: ['hands', 'feet'], denoise: 0.6, pad: 1.2 },
    });
  });

  it('rejects empty, out-of-bounds, zero-area, and overlapping regions with clear tool errors', async () => {
    const { generation } = await createGeneration();
    const base = { generation_id: generation.id, idempotency_key: crypto.randomUUID() };
    const cases = [
      { options: { regions: [], prompt_patch: 'dress' }, path: 'regions' },
      { options: { regions: [[-0.1, 0.2, 0.5, 0.8]], prompt_patch: 'dress' }, path: 'regions' },
      { options: { regions: [[0.2, 0.2, 0.2, 0.8]], prompt_patch: 'dress' }, path: 'regions' },
      {
        options: {
          regions: [
            [0.1, 0.2, 0.6, 0.8],
            [0.5, 0.4, 0.9, 0.9],
          ],
          prompt_patch: 'dress',
        },
        path: 'overlaps',
      },
      { options: { regions: [[0.1, 0.2, 0.6, 0.8]], prompt_patch: '   ' }, path: 'prompt_patch' },
      { options: { regions: [[0.1, 0.2, 0.6, 0.8]], prompt_patch: 'dress', denoise: 0.76 }, path: 'denoise' },
    ];

    for (const [index, candidate] of cases.entries()) {
      const call = await mcpToolCall('masked_redraw_generation', {
        ...base,
        idempotency_key: `${base.idempotency_key}:${index}`,
        options: candidate.options,
      });
      expect(call.isError, candidate.path).toBe(true);
      expect(call.text, candidate.path).toContain(candidate.path === 'overlaps' ? 'region' : candidate.path);
    }
  });

  it('records the required refinement lineage shape for a worker result', async () => {
    const { request: sourceRequest, generation: sourceGeneration } = await createGeneration({
      requestOverrides: { recipe: 'yukari-sketch' },
    });
    const promptPatch = 'long loose A-line mid-calf dress';
    const queued = await mcpToolCall<RequestResult>('masked_redraw_generation', {
      generation_id: sourceGeneration.id,
      options: {
        regions: [[0.18, 0.42, 0.86, 0.96]],
        prompt_patch: promptPatch,
        denoise: 0.5,
        mask_padding: 24,
        mask_feather: 8,
      },
      idempotency_key: crypto.randomUUID(),
    });
    expect(queued.isError).toBe(false);

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
          options: (queued.data?.request.payload.options ?? null) as Record<string, unknown>,
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
