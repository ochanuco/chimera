import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, createJob, getJson, ingestGeneration, mcpToolCall, postJson } from './helpers';

interface GenerationDetail {
  id: string;
  short_id: string;
  batch: { id: string; recipe: string | null } | null;
  comfy_job: { seed: number | null } | null;
}

interface BatchDigest {
  batch: { id: string; short_id: string };
  jobs: { id: string; seed: number | null; index: number | null; status: string }[];
  generations: {
    id: string;
    short_id: string;
    rating: string | null;
    bookmark: boolean;
    tags: string[];
    semantic_summary: string | null;
    semantic_attributes: Record<string, unknown> | null;
    seed: number | null;
  }[];
  references: unknown[];
  relations: { outgoing: unknown[]; incoming: unknown[] };
}

interface LineageNode {
  depth: number;
  via: 'reference' | 'relation';
  purpose_or_kind: string | null;
  batch: { id: string; short_id: string };
  generations: { short_id: string }[];
}

interface Lineage {
  generation: { id: string; short_id: string; batch_id: string };
  ancestors: LineageNode[];
  descendants: LineageNode[];
}

describe('MCP get_generation', () => {
  it('matches the REST detail (GET /api/v1/generations/{id})', async () => {
    const { generation } = await createGeneration();

    const rest = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(rest.status).toBe(200);

    const tool = await mcpToolCall<GenerationDetail>('get_generation', { generation_id: generation.short_id });
    expect(tool.isError).toBe(false);
    expect(tool.data).toEqual(rest.body);
  });

  it('404s as a tool error for an unknown id', async () => {
    const tool = await mcpToolCall('get_generation', { generation_id: 'does-not-exist' });
    expect(tool.isError).toBe(true);
  });
});

describe('MCP list_batch', () => {
  it('carries rating/bookmark/tags/semantic_summary/semantic_attributes/seed per generation', async () => {
    const { batch, generation } = await createGeneration({ jobOverrides: { seed: 987654 } });

    await postJson(`/api/v1/generations/${generation.id}/rating`, { rating: 'good' }, 'PUT');
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: 'outfit-good' });
    await postJson(
      `/api/v1/generations/${generation.id}/semantic`,
      {
        schema_version: 1,
        summary: 'a lounge pose, warm palette',
        attributes: { patches: [{ target: 'pose', op: 'set', value: 'lounge', reason: 'seed' }] },
      },
      'PUT',
    );

    const tool = await mcpToolCall<BatchDigest>('list_batch', { batch_id: batch.short_id });
    expect(tool.isError).toBe(false);
    expect(tool.data?.batch.id).toBe(batch.id);

    const g = tool.data?.generations.find((x) => x.id === generation.id);
    expect(g).toBeTruthy();
    expect(g?.rating).toBe('good');
    expect(g?.bookmark).toBe(false);
    expect(g?.tags).toEqual(['outfit-good']);
    expect(g?.semantic_summary).toBe('a lounge pose, warm palette');
    expect(g?.semantic_attributes).toEqual({ patches: [{ target: 'pose', op: 'set', value: 'lounge', reason: 'seed' }] });
    expect(g?.seed).toBe(987654);

    expect(tool.data?.jobs.length).toBeGreaterThan(0);
  });

  it('404s as a tool error for an unknown batch', async () => {
    const tool = await mcpToolCall('list_batch', { batch_id: 'does-not-exist' });
    expect(tool.isError).toBe(true);
  });
});

describe('MCP get_generation_lineage', () => {
  it('walks one reference hop and one relation hop in each direction', async () => {
    const { batch: batchA, generation: genA } = await createGeneration();

    const batchB = await postJson<{ id: string; short_id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      prompt: 'batch B',
      references: [{ source_generation_id: genA.id, purpose: 'composition', aspect: 'pose' }],
    });
    expect(batchB.status).toBe(201);
    const jobB = await createJob(batchB.body.id);
    const genB = await ingestGeneration(jobB.body.id, { seed: 1, original_filename: 'b.png', comfy_output_index: 0 });

    const batchC = await postJson<{ id: string; short_id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      prompt: 'batch C',
      refinement: { source_batch_id: batchB.body.id, actor: 'human', reason: 'hands were broken' },
    });
    expect(batchC.status).toBe(201);
    const jobC = await createJob(batchC.body.id);
    const genC = await ingestGeneration(jobC.body.id, { seed: 2, original_filename: 'c.png', comfy_output_index: 0 });

    const fromC = await mcpToolCall<Lineage>('get_generation_lineage', { generation_id: genC.body.id });
    expect(fromC.isError).toBe(false);
    expect(fromC.data?.ancestors.map((n) => ({ depth: n.depth, via: n.via, batch_id: n.batch.id }))).toEqual([
      { depth: 1, via: 'relation', batch_id: batchB.body.id },
      { depth: 2, via: 'reference', batch_id: batchA.id },
    ]);
    expect(fromC.data?.ancestors[0]?.purpose_or_kind).toBe('refinement');
    expect(fromC.data?.ancestors[1]?.purpose_or_kind).toBe('composition');

    const fromA = await mcpToolCall<Lineage>('get_generation_lineage', { generation_id: genA.id });
    expect(fromA.isError).toBe(false);
    expect(fromA.data?.descendants.map((n) => ({ depth: n.depth, via: n.via, batch_id: n.batch.id }))).toEqual([
      { depth: 1, via: 'reference', batch_id: batchB.body.id },
      { depth: 2, via: 'relation', batch_id: batchC.body.id },
    ]);

    // depth=1 stops after the first hop.
    const shallow = await mcpToolCall<Lineage>('get_generation_lineage', { generation_id: genC.body.id, depth: 1 });
    expect(shallow.data?.ancestors.map((n) => n.batch.id)).toEqual([batchB.body.id]);
  });
});

describe('MCP derive_request', () => {
  async function createParent(overrides: { recipe?: string | null; parameters?: Record<string, unknown> } = {}) {
    const batchOverrides: Record<string, unknown> = { parameters: overrides.parameters ?? { pose: 'lounge' } };
    // `recipe` is an optional string field (not nullable) — omit the key entirely to get a
    // graph-mode batch (recipe stays NULL) instead of sending an explicit null.
    if (overrides.recipe !== null) batchOverrides.recipe = overrides.recipe ?? 'yukari';
    return createGeneration({ batchOverrides });
  }

  /**
   * Builds a refinement Batch (the shape finalize/repair leave behind): a Batch whose
   * `parameters` is a finalize-style payload (not generate parameters), with a generation in
   * it, wired back to `source` via `batch_relations` (type=refinement) and `batch_references`
   * (purpose=rebuild) — the same two tables lib/lineage.ts walks.
   */
  async function createRefinementBatch(source: { batch: { id: string }; generation: { id: string } }) {
    const refinementBatch = await createBatch({
      parameters: { kind: 'hires-chain', base_generation: source.generation.id, size: 2560 },
    });
    const job = await createJob(refinementBatch.body.id);
    const ingest = await ingestGeneration(job.body.id, {
      seed: 123,
      original_filename: 'out_00001_.png',
      comfy_output_index: 0,
    });

    await postJson(`/api/v1/batches/${refinementBatch.body.id}/relations`, {
      source_batch_id: source.batch.id,
      type: 'refinement',
      actor: 'claude',
    });
    await postJson(`/api/v1/batches/${refinementBatch.body.id}/references`, {
      source_generation_id: source.generation.id,
      purpose: 'rebuild',
    });

    return { batch: refinementBatch.body, generation: ingest.body };
  }

  it('merges the parent batch recipe/parameters and carries parent patches forward', async () => {
    const { generation } = await createParent();
    await postJson(
      `/api/v1/generations/${generation.id}/semantic`,
      { schema_version: 1, attributes: { patches: [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }] } },
      'PUT',
    );

    const call = await mcpToolCall<{ created: boolean; payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'variant of lounge' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation).toEqual({
      recipe: 'yukari',
      parameters: { pose: 'lounge' },
      patches: [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }],
    });
  });

  it('overrides parameters and replaces patches when replace_patches is true', async () => {
    const { generation } = await createParent({ parameters: { pose: 'lounge', costume: 'default' } });
    await postJson(
      `/api/v1/generations/${generation.id}/semantic`,
      { schema_version: 1, attributes: { patches: [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }] } },
      'PUT',
    );

    const call = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      parameters: { pose: 'seated' },
      patches: [{ target: 'costume', op: 'set', value: 'v2', reason: 'new' }],
      replace_patches: true,
      semantic: { summary: 'seated variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation).toEqual({
      recipe: 'yukari',
      parameters: { pose: 'seated', costume: 'default' },
      patches: [{ target: 'costume', op: 'set', value: 'v2', reason: 'new' }],
    });
  });

  it('400s when seeds length does not match count', async () => {
    const { generation } = await createParent();
    const call = await mcpToolCall('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      seeds: [1, 2],
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('seeds');
  });

  it('409s when the parent batch has no recipe (graph-mode)', async () => {
    const { generation } = await createParent({ recipe: null });
    const call = await mcpToolCall('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('recipe');
  });

  it('replays the same idempotency_key as created: false', async () => {
    const { generation } = await createParent();
    const key = crypto.randomUUID();

    const first = await mcpToolCall<{ created: boolean; request: { id: string } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: key,
    });
    expect(first.isError).toBe(false);
    expect(first.data?.created).toBe(true);

    const second = await mcpToolCall<{ created: boolean; request: { id: string } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: key,
    });
    expect(second.isError).toBe(false);
    expect(second.data?.created).toBe(false);
    expect(second.data?.request.id).toBe(first.data?.request.id);
  });

  it('records a purpose=derive reference back to the parent generation', async () => {
    const { generation } = await createParent();
    const call = await mcpToolCall<{ payload: { references: { generation_id: string; purpose: string }[] } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.references).toEqual([{ generation_id: generation.id, purpose: 'derive' }]);
  });

  it('resolves a raw parent as its own derivation source (single reference, derived_from.requested === source)', async () => {
    const { generation } = await createParent();
    const call = await mcpToolCall<{
      payload: { references: { generation_id: string; purpose: string }[] };
      derived_from: { requested: { id: string; short_id: string }; source: { id: string; short_id: string } };
    }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.references).toEqual([{ generation_id: generation.id, purpose: 'derive' }]);
    expect(call.data?.derived_from).toEqual({
      requested: { id: generation.id, short_id: generation.short_id },
      source: { id: generation.id, short_id: generation.short_id },
    });
  });

  it('resolves a finalized parent back to the raw generation it was made from', async () => {
    const raw = await createParent({ parameters: { pose: 'date' } });
    await postJson(
      `/api/v1/generations/${raw.generation.id}/semantic`,
      { schema_version: 1, attributes: { patches: [{ target: 'pose', op: 'set', value: 'date', reason: 'base' }] } },
      'PUT',
    );
    const finalized = await createRefinementBatch(raw);

    const call = await mcpToolCall<{
      payload: { generation: Record<string, unknown>; references: { generation_id: string; purpose: string; aspect?: string }[] };
      derived_from: { requested: { id: string; short_id: string }; source: { id: string; short_id: string } };
    }>('derive_request', {
      from_generation_id: finalized.generation.short_id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'variant of date' },
      idempotency_key: crypto.randomUUID(),
    });

    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation).toEqual({
      recipe: 'yukari',
      parameters: { pose: 'date' },
      patches: [{ target: 'pose', op: 'set', value: 'date', reason: 'base' }],
    });
    expect(call.data?.payload.references).toEqual([
      { generation_id: raw.generation.id, purpose: 'derive' },
      { generation_id: finalized.generation.id, purpose: 'derive', aspect: 'finalized' },
    ]);
    expect(call.data?.derived_from).toEqual({
      requested: { id: finalized.generation.id, short_id: finalized.generation.short_id },
      source: { id: raw.generation.id, short_id: raw.generation.short_id },
    });
  });

  it('resolves a two-hop chain (finalize of a finalize) back to the raw generation', async () => {
    const raw = await createParent({ parameters: { pose: 'date' } });
    const finalized = await createRefinementBatch(raw);
    const refinalized = await createRefinementBatch({ batch: finalized.batch, generation: finalized.generation });

    const call = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: refinalized.generation.short_id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'variant of date' },
      idempotency_key: crypto.randomUUID(),
    });

    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation).toEqual({ recipe: 'yukari', parameters: { pose: 'date' } });
  });

  it('409s when a refinement batch in the chain has no rebuild reference', async () => {
    const raw = await createParent({ parameters: { pose: 'date' } });
    const orphanRefinement = await createBatch({ parameters: { kind: 'hires-chain' } });
    const job = await createJob(orphanRefinement.body.id);
    const orphanGeneration = await ingestGeneration(job.body.id, {
      seed: 123,
      original_filename: 'out_00001_.png',
      comfy_output_index: 0,
    });
    await postJson(`/api/v1/batches/${orphanRefinement.body.id}/relations`, {
      source_batch_id: raw.batch.id,
      type: 'refinement',
      actor: 'claude',
    });
    // No batch_references (rebuild) row — the chain cannot be resolved past this batch.

    const call = await mcpToolCall('derive_request', {
      from_generation_id: orphanGeneration.body.short_id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('rebuild reference');
  });
});
