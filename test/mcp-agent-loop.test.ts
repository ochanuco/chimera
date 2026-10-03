import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildDerivedRequestPayload, type BuildDerivedRequestPayloadInput } from '../src/lib/requests';
import { createRequest, createGeneration, createJob, getJson, ingestGeneration, mcpToolCall, postJson } from './helpers';

function uniqueRecipe(): string {
  return `yukari-${crypto.randomUUID()}`;
}

interface GenerationDetail {
  id: string;
  short_id: string;
  request: { id: string; recipe: string | null } | null;
  comfy_job: { seed: number | null } | null;
}

interface LineageNode {
  depth: number;
  via: 'reference' | 'refinement';
  purpose_or_kind: string | null;
  request: { id: string; short_id: string | null };
  generations: { short_id: string }[];
}

interface Lineage {
  generation: { id: string; short_id: string; request_id: string | null };
  ancestors: LineageNode[];
  descendants: LineageNode[];
}

describe('MCP get_generation', () => {
  it('matches the REST detail (GET /api/v1/generations/{id})', async () => {
    const { generation } = await createGeneration();

    const rest = await getJson<GenerationDetail>(`/api/v1/generations/${generation.id}`);
    expect(rest.status).toBe(200);

    // include_prompts: true opts out of the default prompt folding (src/lib/prompt-fold.ts) so this
    // still matches REST byte-for-byte.
    const tool = await mcpToolCall<GenerationDetail>('get_generation', {
      generation_id: generation.short_id,
      include_prompts: true,
    });
    expect(tool.isError).toBe(false);
    expect(tool.data).toEqual(rest.body);
  });

  it('exposes the pre-finalize source as refines_generation, and null for a raw Generation', async () => {
    const { generation: source } = await createGeneration();
    const refined = await createGeneration({
      jobOverrides: { source_generation_id: source.id },
    });

    const rest = await getJson<{ refines_generation: unknown }>(`/api/v1/generations/${refined.generation.id}`);
    expect(rest.body.refines_generation).toEqual({ id: source.id, short_id: source.short_id, rating: null });

    const tool = await mcpToolCall<{ refines_generation: unknown }>('get_generation', {
      generation_id: refined.generation.short_id,
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.refines_generation).toEqual({ id: source.id, short_id: source.short_id, rating: null });

    const raw = await getJson<{ refines_generation: unknown }>(`/api/v1/generations/${source.id}`);
    expect(raw.body.refines_generation).toBeNull();
  });

  it('404s as a tool error for an unknown id', async () => {
    const tool = await mcpToolCall('get_generation', { generation_id: 'does-not-exist' });
    expect(tool.isError).toBe(true);
  });
});

describe('MCP get_generation_lineage', () => {
  it('walks one reference hop and one refinement hop in each direction', async () => {
    const { generation: genA, request: requestA } = await createGeneration();
    const { generation: genB, request: requestB } = await createGeneration({
      requestOverrides: { references: [{ source_generation_id: genA.id, purpose: 'composition', aspect: 'pose' }] },
    });
    const { generation: genC, request: requestC } = await createGeneration({
      requestOverrides: { kind: 'finalize' },
      jobOverrides: { source_generation_id: genB.id },
    });

    const fromC = await mcpToolCall<Lineage>('get_generation_lineage', { generation_id: genC.id });
    expect(fromC.isError).toBe(false);
    expect(fromC.data?.generation.request_id).toBe(requestC.id);
    expect(fromC.data?.ancestors.map((n) => ({ depth: n.depth, via: n.via, request_id: n.request.id }))).toEqual([
      { depth: 1, via: 'refinement', request_id: requestB.id },
      { depth: 2, via: 'reference', request_id: requestA.id },
    ]);
    expect(fromC.data?.ancestors[0]?.purpose_or_kind).toBe('finalize');
    expect(fromC.data?.ancestors[1]?.purpose_or_kind).toBe('composition');

    const fromA = await mcpToolCall<Lineage>('get_generation_lineage', { generation_id: genA.id });
    expect(fromA.isError).toBe(false);
    expect(fromA.data?.descendants.map((n) => ({ depth: n.depth, via: n.via, request_id: n.request.id }))).toEqual([
      { depth: 1, via: 'reference', request_id: requestB.id },
      { depth: 2, via: 'refinement', request_id: requestC.id },
    ]);

    // depth=1 stops after the first hop.
    const shallow = await mcpToolCall<Lineage>('get_generation_lineage', { generation_id: genC.id, depth: 1 });
    expect(shallow.data?.ancestors.map((n) => n.request.id)).toEqual([requestB.id]);
  });
});

describe('MCP derive_request', () => {
  async function createParent(
    overrides: { recipe?: string | null; parameters?: Record<string, unknown>; patches?: unknown[] } = {},
  ) {
    const requestOverrides: Record<string, unknown> = { parameters: overrides.parameters ?? { pose: 'lounge' } };
    // `recipe` is an optional string field (not nullable) — omit the key entirely to get a
    // graph-mode request (recipe stays NULL) instead of sending an explicit null.
    if (overrides.recipe !== null) requestOverrides.recipe = overrides.recipe ?? 'yukari';
    if (overrides.patches) {
      requestOverrides.patches = overrides.patches;
      // patches のある Request は pose_fingerprint も要る (docs/domain-model.md「Preset」)。
      requestOverrides.pose_fingerprint = 'sha256:fixture';
    }
    return createGeneration({ requestOverrides });
  }

  /**
   * Builds a refinement Request (the shape finalize/repair leave behind): `parameters` is a finalize-style
   * payload and the Job's source_generation_id points back at `source`, which ingest copies into
   * generations.refines_generation_id — the column lib/lineage.ts walks.
   */
  async function createRefinement(source: { generation: { id: string } }) {
    return createGeneration({
      requestOverrides: {
        kind: 'finalize',
        parameters: { kind: 'hires-chain', base_generation: source.generation.id, size: 2560 },
      },
      jobOverrides: { source_generation_id: source.generation.id },
    });
  }

  it('merges the parent request recipe/parameters and carries parent patches (from Request patches_json, not semantic) forward', async () => {
    const patches = [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }];
    const { generation } = await createParent({ patches });
    // semantic.attributes.patches is a different value — proves derive_request reads the Request,
    // not this (docs/domain-model.md「preset の不変条件」: semantic は正本ではない).
    await postJson(
      `/api/v1/generations/${generation.id}/semantic`,
      { schema_version: 1, attributes: { patches: [{ target: 'pose', op: 'set', value: 'from semantic (ignored)', reason: 'x' }] } },
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

  it('writes identity_override into generation.identity_override without carrying one from the parent', async () => {
    const { generation } = await createParent();

    const withOverride = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'hood up',
      count: 1,
      patches: [{ target: 'prompt.positive.costume', op: 'append', value: ', hood up', reason: 'hood up variant' }],
      identity_override: 'hood up hides the hair ornament on purpose',
      semantic: { summary: 'hood up variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(withOverride.isError).toBe(false);
    expect(withOverride.data?.payload.generation.identity_override).toBe('hood up hides the hair ornament on purpose');

    const without = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'plain variant',
      count: 1,
      semantic: { summary: 'plain variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(without.isError).toBe(false);
    expect(without.data?.payload.generation).not.toHaveProperty('identity_override');
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

  it('409s when the parent request has no recipe (graph-mode)', async () => {
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
    const raw = await createParent({
      parameters: { pose: 'date' },
      patches: [{ target: 'pose', op: 'set', value: 'date', reason: 'base' }],
    });
    const finalized = await createRefinement(raw);

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
    const finalized = await createRefinement(raw);
    const refinalized = await createRefinement(finalized);

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

  it('409s when a refinement request in the chain has no source generation', async () => {
    const raw = await createParent({ parameters: { pose: 'date' } });
    const finalizeRequest = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: raw.generation.id, options: {} },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(finalizeRequest.status).toBe(201);
    const orphan = await createGeneration({
      requestId: finalizeRequest.body.id,
      requestOverrides: { parameters: { kind: 'hires-chain' } },
    });
    const orphanGeneration = { body: orphan.generation };
    // refines_generation_id が NULL の finalize request: 仕上げ元まで遡れない。

    const call = await mcpToolCall('derive_request', {
      from_generation_id: orphanGeneration.body.short_id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('no source generation');
  });

  describe('replaying patches against an unpinned preset body', () => {
    function deriveInput(overrides: Partial<BuildDerivedRequestPayloadInput> = {}): BuildDerivedRequestPayloadInput {
      return {
        parentGenerationId: 'parent-generation',
        parentRecipe: 'yukari',
        parentParameters: { pose: 'lounge' },
        parentPatches: [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }],
        parentPresets: [],
        parentRecipeHasPresets: true,
        instruction: 'try a variant',
        count: 1,
        replacePatches: false,
        semantic: { summary: 'x' },
        ...overrides,
      };
    }

    it('throws when the parent carries patches but no pin, on a recipe that has presets', () => {
      expect(() => buildDerivedRequestPayload(deriveInput())).toThrow(/pin/i);
    });

    it('succeeds when replace_patches is true, even without a pin', () => {
      const payload = buildDerivedRequestPayload(deriveInput({ replacePatches: true }));
      expect((payload.generation as Record<string, unknown>).patches).toBeUndefined();
    });

    it('succeeds when the recipe has no presets at all', () => {
      const payload = buildDerivedRequestPayload(deriveInput({ parentRecipeHasPresets: false }));
      expect((payload.generation as Record<string, unknown>).patches).toEqual([
        { target: 'pose', op: 'set', value: 'lounge', reason: 'base' },
      ]);
    });

    it('succeeds when the parent already carries a pin, carrying both patches and presets forward', () => {
      const payload = buildDerivedRequestPayload(
        deriveInput({ parentPresets: [{ kind: 'pose', name: 'lounge', version: 1 }] }),
      );
      expect((payload.generation as Record<string, unknown>).patches).toEqual([
        { target: 'pose', op: 'set', value: 'lounge', reason: 'base' },
      ]);
      expect((payload.generation as Record<string, unknown>).presets).toEqual([{ kind: 'pose', name: 'lounge', version: 1 }]);
    });

    it('409s over MCP when the source request carries patches but no pin on a recipe with presets', async () => {
      const recipe = uniqueRecipe();
      const patches = [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }];
      const { generation } = await createParent({ recipe, patches });

      await env.DB.prepare(
        `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, created_by, created_at)
         VALUES (?, ?, 'pose', 'lounge', 1, '{}', 'active', 'import', 'test', ?)`,
      )
        .bind(crypto.randomUUID(), recipe, new Date().toISOString())
        .run();

      const blocked = await mcpToolCall('derive_request', {
        from_generation_id: generation.id,
        instruction: 'try a variant',
        count: 1,
        semantic: { summary: 'x' },
        idempotency_key: crypto.randomUUID(),
      });
      expect(blocked.isError).toBe(true);
      expect(blocked.text).toContain('pin');

      const allowed = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
        from_generation_id: generation.id,
        instruction: 'try a variant',
        count: 1,
        patches: [{ target: 'costume', op: 'set', value: 'v2', reason: 'new' }],
        replace_patches: true,
        semantic: { summary: 'x' },
        idempotency_key: crypto.randomUUID(),
      });
      expect(allowed.isError).toBe(false);
      expect(allowed.data?.payload.generation.patches).toEqual([{ target: 'costume', op: 'set', value: 'v2', reason: 'new' }]);
    });
  });
});
