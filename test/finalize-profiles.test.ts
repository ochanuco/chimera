import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall, postJson, req, clearRequests } from './helpers';
import { listFinalizeProfiles } from '../src/lib/presets';
import { getCatalog, findFinalizeDials, findFinalizeDefaults, findFinalizeDof, findFinalizeLight } from '../src/lib/catalogs';
import { findProducingRequest } from '../src/lib/requests';
import { finalizeOptionsSchema } from '../src/schemas/requests';

function uniqueRecipe(): string {
  return `yukari-${crypto.randomUUID()}`;
}

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

function catalogWithDials(recipe: string) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag' }],
        dials: {
          finalize: {
            denoise: { tidy: 0.65, heavy: 0.8 },
            keep_legwear: { on: 0.62 },
          },
        },
      },
    ],
    patches: {},
  };
}

function catalogWithFinalizeDefaults(recipe: string, defaults: unknown) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag' }],
        ...(defaults === undefined ? {} : { finalize: { defaults } }),
      },
    ],
    patches: {},
  };
}

interface RequestBody {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  worker_id: string | null;
  result: { generation_ids: string[] } | null;
}

async function claim(workerId: string): Promise<{ status: number; body: RequestBody | null }> {
  const res = await req('/api/v1/requests/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: workerId }),
  });
  if (res.status === 204) return { status: res.status, body: null };
  return { status: res.status, body: (await res.json()) as RequestBody };
}

async function setRatingGood(generationId: string): Promise<void> {
  const res = await postJson(`/api/v1/generations/${generationId}/rating`, { rating: 'good' }, 'PUT');
  expect(res.status).toBe(200);
}

/**
 * A raw (source) Generation plus a finalize request claimed and marked done against a second
 * (delivered) Generation — the shape promote_to_profile / applyFinalizeProfile expect.
 */
async function createFinalizeResult(recipe: string, options: Record<string, unknown> = {}) {
  const { generation: source } = await createGeneration({ requestOverrides: { recipe } });

  const finalizeReq = await postJson<RequestBody>('/api/v1/requests', {
    kind: 'finalize',
    payload: { generation_id: source.id, options },
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
  });
  expect(finalizeReq.status).toBe(201);

  const claimed = await claim(`worker-${crypto.randomUUID()}`);
  expect(claimed.status).toBe(200);
  expect(claimed.body!.id).toBe(finalizeReq.body.id);

  const { generation: delivered } = await createGeneration({
    requestId: finalizeReq.body.id,
    requestOverrides: { recipe },
    jobOverrides: { source_generation_id: source.id },
  });

  const done = await postJson(
    `/api/v1/requests/${finalizeReq.body.id}`,
    { status: 'done', worker_id: claimed.body!.worker_id, result: { generation_ids: [delivered.id] } },
    'PATCH',
  );
  expect(done.status).toBe(200);

  return { source, delivered };
}

beforeEach(async () => {
  await clearRequests();
});

describe('catalog dials passthrough', () => {
  it('PUT/GET /api/v1/catalogs, GET /api/v1/catalogs (list), and MCP list_catalog all pass recipes[].dials through', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    const expectedDials = { finalize: { denoise: { tidy: 0.65, heavy: 0.8 }, keep_legwear: { on: 0.62 } } };

    const put = await postJson<{ recipes: { dials?: unknown }[] }>(`/api/v1/catalogs/${recipeRef}`, catalogWithDials(recipe), 'PUT');
    expect(put.status).toBe(200);
    expect(put.body.recipes[0]!.dials).toEqual(expectedDials);

    const get = await getJson<{ recipes: { dials?: unknown }[] }>(`/api/v1/catalogs/${recipeRef}`);
    expect(get.body.recipes[0]!.dials).toEqual(expectedDials);

    const list = await getJson<{ items: { recipe_ref: string; recipes: { dials?: unknown }[] }[] }>('/api/v1/catalogs');
    const row = list.body.items.find((i) => i.recipe_ref === recipeRef);
    expect(row?.recipes[0]?.dials).toEqual(expectedDials);

    const tool = await mcpToolCall<{ recipes: { dials?: unknown }[] }>('list_catalog', { recipe_ref: recipeRef });
    expect(tool.isError).toBe(false);
    expect(tool.data?.recipes[0]?.dials).toEqual(expectedDials);
  });
});

describe('finalizeOptionsSchema', () => {
  it('accepts keep_regions rectangles and a keep_strength between 0 and 1', () => {
    expect(finalizeOptionsSchema.safeParse({ keep_regions: [[0.3, 0.1, 0.7, 0.4]], keep_strength: 0.25 }).success).toBe(true);
  });

  it.each([
    ['a null keep_regions', { keep_regions: null }],
    ['a rectangle outside 0..1', { keep_regions: [[0, 0, 1.2, 1]] }],
    ['a rectangle with x0 >= x1', { keep_regions: [[0.7, 0.1, 0.3, 0.4]] }],
    ['keep_strength 0', { keep_strength: 0 }],
    ['keep_strength 1', { keep_strength: 1 }],
    ['a null keep_strength', { keep_strength: null }],
  ])('rejects %s', (_label, options) => {
    expect(finalizeOptionsSchema.safeParse(options).success).toBe(false);
  });

  it('accepts hires / hires_denoise, null included', () => {
    expect(finalizeOptionsSchema.safeParse({ hires: 2048, hires_denoise: 0.45 }).success).toBe(true);
    expect(finalizeOptionsSchema.safeParse({ hires: null, hires_denoise: null }).success).toBe(true);
    expect(finalizeOptionsSchema.safeParse({ hires_denoise: 1 }).success).toBe(true);
  });

  it.each([
    ['a non-integer hires', { hires: 2048.5 }],
    ['a string hires', { hires: '2048' }],
    ['a hires below 64', { hires: 32 }],
    ['hires_denoise 0', { hires_denoise: 0 }],
    ['hires_denoise above 1', { hires_denoise: 1.1 }],
  ])('rejects %s', (_label, options) => {
    expect(finalizeOptionsSchema.safeParse(options).success).toBe(false);
  });

  it('accepts dof with focus and f_number, null included', () => {
    expect(finalizeOptionsSchema.safeParse({ dof: { focus: [0.82, 0.55], f_number: 2.8 } }).success).toBe(true);
    expect(finalizeOptionsSchema.safeParse({ dof: { focus: [0, 1], f_number: 2.8 } }).success).toBe(true);
    expect(finalizeOptionsSchema.safeParse({ dof: null }).success).toBe(true);
  });

  it.each(['figure', 'all'])('accepts dof scope %s', (scope) => {
    expect(finalizeOptionsSchema.safeParse({ dof: { focus: [0.5, 0.5], f_number: 2.8, scope } }).success).toBe(true);
  });

  it.each(['off', 'on', 'both'])('accepts dof viewfinder %s', (viewfinder) => {
    expect(finalizeOptionsSchema.safeParse({ dof: { focus: [0.5, 0.5], f_number: 2.8, viewfinder } }).success).toBe(true);
  });

  it.each([
    ['dof without f_number', { dof: { focus: [0.5, 0.5] } }],
    ['dof without focus', { dof: { f_number: 2.8 } }],
    ['f_number below 1.4', { dof: { focus: [0.5, 0.5], f_number: 1.3 } }],
    ['f_number above 22', { dof: { focus: [0.5, 0.5], f_number: 23 } }],
    ['focus outside 0..1', { dof: { focus: [1.2, 0.5], f_number: 2.8 } }],
    ['negative focus', { dof: { focus: [0.5, -0.1], f_number: 2.8 } }],
    ['focus with 3 elements', { dof: { focus: [0.5, 0.5, 0.5], f_number: 2.8 } }],
    ['an unknown dof scope', { dof: { focus: [0.5, 0.5], f_number: 2.8, scope: 'background' } }],
    ['a null dof scope', { dof: { focus: [0.5, 0.5], f_number: 2.8, scope: null } }],
    ['an unknown dof viewfinder', { dof: { focus: [0.5, 0.5], f_number: 2.8, viewfinder: 'grid' } }],
    ['a boolean dof viewfinder', { dof: { focus: [0.5, 0.5], f_number: 2.8, viewfinder: true } }],
    ['an unknown dof key', { dof: { focus: [0.5, 0.5], f_number: 2.8, strength: 1 } }],
  ])('rejects %s', (_label, options) => {
    expect(finalizeOptionsSchema.safeParse(options).success).toBe(false);
  });

  it.each([{ scene: 'sunset' }, { scene: 'moon', from: 'ne' }, null])('accepts light %j', (light) => {
    expect(finalizeOptionsSchema.safeParse({ light }).success).toBe(true);
  });

  it.each([
    ['an unknown light scene', { light: { scene: 'noon' } }],
    ['a light without scene', { light: { from: 'nw' } }],
    ['an unknown light from', { light: { scene: 'sunset', from: 'up' } }],
    ['an unknown light key', { light: { scene: 'sunset', strength: 1 } }],
  ])('rejects %s', (_label, options) => {
    expect(finalizeOptionsSchema.safeParse(options).success).toBe(false);
  });

  it('rejects handdrawn / toe_guard / lora_strength (dropped alongside the yukari-anima -> yukari rename)', () => {
    for (const key of ['handdrawn', 'toe_guard', 'lora_strength']) {
      const result = finalizeOptionsSchema.safeParse({ [key]: true });
      expect(result.success).toBe(false);
    }
  });
});

describe('finalize/repair/masked_redraw options accept dial words', () => {
  it('finalize: denoise / keep_legwear / repair_denoise accept a word; reject a malformed string', async () => {
    const { generation } = await createGeneration();

    const ok = await postJson('/api/v1/requests', {
      kind: 'finalize',
      payload: {
        generation_id: generation.id,
        options: {
          denoise: 'tidy',
          keep_legwear: 'on',
          repair: ['hands'],
          repair_denoise: 'soft',
        },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(ok.status).toBe(201);

    const bad = await postJson('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.id, options: { denoise: 'Tidy!' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(bad.status).toBe(400);
  });

  it('masked_redraw: denoise accepts a word', async () => {
    const { generation } = await createGeneration();
    const ok = await postJson('/api/v1/requests', {
      kind: 'masked_redraw',
      payload: {
        generation_id: generation.id,
        options: { regions: [[0.1, 0.1, 0.5, 0.5]], prompt_patch: 'replace the dress', denoise: 'soft' },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(ok.status).toBe(201);
  });
});

describe('finalize profile resolution (createRequest)', () => {
  it('resolves the latest active version and merges options, explicit keys (including null) winning', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });

    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.7, repin: true });
    await setRatingGood(delivered.id);
    const promoted = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body.version).toBe(1);

    const created = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.id, profile: { name: 'daily' }, options: { denoise: null } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(created.status).toBe(201);
    expect(created.body.payload).toEqual({
      generation_id: generation.id,
      profile: { name: 'daily', version: 1 },
      options: { repin: true, denoise: null },
    });
  });

  it('pins an explicit version, ignoring a later one', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });

    const { delivered: d1 } = await createFinalizeResult(recipe, { denoise: 0.6 });
    await setRatingGood(d1.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d1.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const { delivered: d2 } = await createFinalizeResult(recipe, { denoise: 0.8 });
    await setRatingGood(d2.id);
    const v2 = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: d2.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(v2.body.version).toBe(2);

    const created = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.id, profile: { name: 'daily', version: 1 } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(created.status).toBe(201);
    expect(created.body.payload).toEqual({
      generation_id: generation.id,
      profile: { name: 'daily', version: 1 },
      options: { denoise: 0.6 },
    });
  });

  it('404s an unknown profile name without creating a queued row', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });

    const res = await postJson('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: generation.id, profile: { name: 'nonexistent' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(404);

    const list = await getJson<{ items: unknown[] }>(`/api/v1/requests?kind=finalize&generation_id=${generation.id}`);
    expect(list.body.items).toEqual([]);
  });

  it('404s when the generation_id does not resolve', async () => {
    const res = await postJson('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: 'does-not-exist', profile: { name: 'daily' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(404);
  });
});

describe('resolvePreset for kind=finalize', () => {
  it('GET /api/v1/presets/{recipe}/finalize/{name}/{version} resolves to {options} with no patches', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.6, keep_legwear: 'on' });
    await setRatingGood(delivered.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const got = await getJson<{ record: { options: Record<string, unknown> }; patches: unknown[] }>(
      `/api/v1/presets/${recipe}/finalize/daily/1`,
    );
    expect(got.status).toBe(200);
    expect(got.body.record).toEqual({ options: { denoise: 0.6, keep_legwear: 'on' } });
    expect(got.body.patches).toEqual([]);
  });
});

describe('promote_to_profile', () => {
  it('promotes a rating=good finalize-kind Generation; repeated names append the next version', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.6, keep_legwear: 'on' });
    await setRatingGood(delivered.id);

    const v1 = await postJson<{ recipe: string; kind: string; name: string; version: number; source: string; record: unknown }>(
      '/api/v1/presets/promote-profile',
      { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() },
    );
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({ recipe, kind: 'finalize', name: 'daily', version: 1, source: 'promote' });
    expect(v1.body.record).toEqual({ options: { denoise: 0.6, keep_legwear: 'on' } });

    const { delivered: delivered2 } = await createFinalizeResult(recipe, { denoise: 0.8 });
    await setRatingGood(delivered2.id);
    const v2 = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered2.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(v2.status).toBe(200);
    expect(v2.body.version).toBe(2);

    const versions = await getJson<{ items: { version: number }[] }>(`/api/v1/presets/${recipe}/finalize/daily`);
    expect(versions.body.items.map((p) => p.version)).toEqual([2, 1]);
  });

  it('idempotency replay returns the same version; the same key with different input is a conflict', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe);
    await setRatingGood(delivered.id);
    const key = crypto.randomUUID();

    const first = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: key,
    });
    expect(first.status).toBe(200);

    const replay = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: key,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.version).toBe(first.body.version);

    const conflict = await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'other', idempotency_key: key });
    expect(conflict.status).toBe(409);
  });

  it('409s when rating is not good', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe);
    const res = await postJson('/api/v1/presets/promote-profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
  });

  it('409s when the generation was not produced by a finalize request', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });
    await setRatingGood(generation.id);
    const res = await postJson('/api/v1/presets/promote-profile', {
      generation_id: generation.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
  });

  it('MCP promote_to_profile matches the REST result', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.55 });
    await setRatingGood(delivered.id);
    const tool = await mcpToolCall<{ version: number; record: { options: Record<string, unknown> } }>('promote_to_profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.version).toBe(1);
    expect(tool.data?.record).toEqual({ options: { denoise: 0.55 } });
  });
});

describe('finalize_generation MCP tool profile field', () => {
  it('passes profile through and resolves it server-side, same as REST', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });
    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.6 });
    await setRatingGood(delivered.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const tool = await mcpToolCall<{ request: { payload: Record<string, unknown> } }>('finalize_generation', {
      generation_id: generation.id,
      profile: { name: 'daily' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      profile: { name: 'daily', version: 1 },
      options: { denoise: 0.6 },
    });
  });
});

describe('lib helpers for the UI (listFinalizeProfiles / findFinalizeDials)', () => {
  it('listFinalizeProfiles returns each name once, at its latest active version, with options inlined', async () => {
    const recipe = uniqueRecipe();
    const { delivered: d1 } = await createFinalizeResult(recipe, { denoise: 0.6 });
    await setRatingGood(d1.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d1.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const { delivered: d2 } = await createFinalizeResult(recipe, { denoise: 0.9 });
    await setRatingGood(d2.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d2.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const { delivered: d3 } = await createFinalizeResult(recipe, { keep_legwear: 'on' });
    await setRatingGood(d3.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d3.id, name: 'heavy', idempotency_key: crypto.randomUUID() });

    const profiles = await listFinalizeProfiles(env.DB, recipe);
    expect(profiles.map((p) => p.name).sort()).toEqual(['daily', 'heavy']);
    const daily = profiles.find((p) => p.name === 'daily');
    expect(daily?.version).toBe(2);
    expect(daily?.options).toEqual({ denoise: 0.9 });
    const heavy = profiles.find((p) => p.name === 'heavy');
    expect(heavy?.options).toEqual({ keep_legwear: 'on' });
  });

  it('listFinalizeProfiles returns [] for a recipe with no finalize Presets', async () => {
    const profiles = await listFinalizeProfiles(env.DB, uniqueRecipe());
    expect(profiles).toEqual([]);
  });

  it('findFinalizeDials extracts recipes[].dials.finalize; null when recipe/dials are absent', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${recipeRef}`, catalogWithDials(recipe), 'PUT');

    const found = await getCatalog(env.DB, recipeRef);
    expect(found).not.toBeNull();
    expect(findFinalizeDials(found!.doc, recipe)).toEqual({ denoise: { tidy: 0.65, heavy: 0.8 }, keep_legwear: { on: 0.62 } });
    expect(findFinalizeDials(found!.doc, 'nonexistent-recipe')).toBeNull();
  });

  it('findFinalizeDefaults extracts recipes[].finalize.defaults; null when finalize is absent or defaults is not an object', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${recipeRef}`, catalogWithFinalizeDefaults(recipe, { deliver_only: true, repin: false }), 'PUT');

    const found = await getCatalog(env.DB, recipeRef);
    expect(found).not.toBeNull();
    expect(findFinalizeDefaults(found!.doc, recipe)).toEqual({ deliver_only: true, repin: false });
    expect(findFinalizeDefaults(found!.doc, 'nonexistent-recipe')).toBeNull();

    // Older catalogs never publish a `finalize` key at all — must resolve to null, not throw.
    const noFinalizeRef = uniqueRecipeRef();
    const noFinalizeRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${noFinalizeRef}`, catalogWithFinalizeDefaults(noFinalizeRecipe, undefined), 'PUT');
    const foundNoFinalize = await getCatalog(env.DB, noFinalizeRef);
    expect(findFinalizeDefaults(foundNoFinalize!.doc, noFinalizeRecipe)).toBeNull();

    // A malformed `finalize.defaults` (not a plain object) is treated as absent, not thrown.
    const malformedRef = uniqueRecipeRef();
    const malformedRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${malformedRef}`, catalogWithFinalizeDefaults(malformedRecipe, 'not-an-object'), 'PUT');
    const foundMalformed = await getCatalog(env.DB, malformedRef);
    expect(findFinalizeDefaults(foundMalformed!.doc, malformedRecipe)).toBeNull();
  });
});

describe('findFinalizeDof', () => {
  function catalogWithDof(recipe: string, dof: unknown) {
    return {
      schema_version: 1,
      recipes: [{ name: recipe, poses: [], finalize: { dof } }],
      patches: {},
    };
  }

  it('extracts recipes[].finalize.dof.f_number; null when absent or malformed', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    const fNumber = { min: 2.8, max: 22, default: 2.8, stops: [2.8, 4.0, 5.6, 8.0, 11.0, 16.0, 22.0] };
    await postJson(`/api/v1/catalogs/${recipeRef}`, catalogWithDof(recipe, { f_number: fNumber, focus: 'fractions [x, y] of the source image' }), 'PUT');
    const found = await getCatalog(env.DB, recipeRef);
    expect(findFinalizeDof(found!.doc, recipe)).toEqual({ ...fNumber, scope: null, viewfinder: null });
    expect(findFinalizeDof(found!.doc, 'nonexistent-recipe')).toBeNull();

    const scope = { values: ['figure', 'all'], default: 'figure' };
    const scopedRef = uniqueRecipeRef();
    const scopedRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${scopedRef}`, catalogWithDof(scopedRecipe, { f_number: fNumber, scope }), 'PUT');
    expect(findFinalizeDof((await getCatalog(env.DB, scopedRef))!.doc, scopedRecipe)).toEqual({ ...fNumber, scope, viewfinder: null });

    const viewfinder = { values: ['off', 'on', 'both'], default: 'off' };
    const viewfinderRef = uniqueRecipeRef();
    const viewfinderRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${viewfinderRef}`, catalogWithDof(viewfinderRecipe, { f_number: fNumber, scope, viewfinder }), 'PUT');
    expect(findFinalizeDof((await getCatalog(env.DB, viewfinderRef))!.doc, viewfinderRecipe)).toEqual({ ...fNumber, scope, viewfinder });

    for (const badViewfinder of [{ values: ['on', 'both'], default: 'on' }, { values: ['off', 'on'], default: 'both' }, { values: ['off'] }, 'on']) {
      const ref = uniqueRecipeRef();
      const name = uniqueRecipe();
      await postJson(`/api/v1/catalogs/${ref}`, catalogWithDof(name, { f_number: fNumber, viewfinder: badViewfinder }), 'PUT');
      expect(findFinalizeDof((await getCatalog(env.DB, ref))!.doc, name)).toEqual({ ...fNumber, scope: null, viewfinder: null });
    }

    for (const badScope of [{ values: ['figure'], default: 'figure' }, { values: 'all', default: 'all' }, { values: ['all'] }, 'all']) {
      const ref = uniqueRecipeRef();
      const name = uniqueRecipe();
      await postJson(`/api/v1/catalogs/${ref}`, catalogWithDof(name, { f_number: fNumber, scope: badScope }), 'PUT');
      expect(findFinalizeDof((await getCatalog(env.DB, ref))!.doc, name)).toEqual({ ...fNumber, scope: null, viewfinder: null });
    }

    const noDofRef = uniqueRecipeRef();
    const noDofRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${noDofRef}`, catalogWithFinalizeDefaults(noDofRecipe, { repin: false }), 'PUT');
    expect(findFinalizeDof((await getCatalog(env.DB, noDofRef))!.doc, noDofRecipe)).toBeNull();

    for (const bad of [
      { f_number: 'x' },
      { f_number: { ...fNumber, stops: [] } },
      { f_number: { ...fNumber, stops: ['a'] } },
      { f_number: { ...fNumber, default: '2.8' } },
    ]) {
      const badRef = uniqueRecipeRef();
      const badRecipe = uniqueRecipe();
      await postJson(`/api/v1/catalogs/${badRef}`, catalogWithDof(badRecipe, bad), 'PUT');
      expect(findFinalizeDof((await getCatalog(env.DB, badRef))!.doc, badRecipe)).toBeNull();
    }
  });
});

describe('findFinalizeLight', () => {
  const light = { scenes: ['sunset', 'moon'], from: ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'], default_from: 'nw' };

  async function lookup(value: unknown) {
    const ref = uniqueRecipeRef();
    const name = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${ref}`, { schema_version: 1, recipes: [{ name, poses: [], finalize: { light: value } }], patches: {} }, 'PUT');
    return findFinalizeLight((await getCatalog(env.DB, ref))!.doc, name);
  }

  it('parses the published shape; null when absent or malformed', async () => {
    expect(await lookup(light)).toEqual({ scenes: light.scenes, from: light.from, defaultFrom: 'nw' });
    expect(await lookup(undefined)).toBeNull();
    for (const bad of [
      { ...light, scenes: [] },
      { ...light, scenes: 'sunset' },
      { ...light, from: [] },
      { ...light, default_from: 'x' },
      { ...light, default_from: undefined },
      'sunset',
    ]) {
      expect(await lookup(bad)).toBeNull();
    }
    const ref = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${ref}`, { schema_version: 1, recipes: [{ name: 'only', poses: [], finalize: { light } }], patches: {} }, 'PUT');
    expect(findFinalizeLight((await getCatalog(env.DB, ref))!.doc, 'nonexistent-recipe')).toBeNull();
  });
});

describe('list_presets / get_preset accept kind=finalize', () => {
  it('list_presets kind=finalize and get_preset match the REST routes', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.6 });
    await setRatingGood(delivered.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const rest = await getJson<{ items: { kind: string; name: string }[] }>(`/api/v1/presets?recipe=${recipe}&kind=finalize`);
    expect(rest.body.items.map((p) => p.name)).toEqual(['daily']);

    const tool = await mcpToolCall<{ items: { kind: string; name: string }[] }>('list_presets', { recipe, kind: 'finalize' });
    expect(tool.isError).toBe(false);
    expect(tool.data?.items.map((p) => p.name)).toEqual(['daily']);

    const getTool = await mcpToolCall<{ record: { options: Record<string, unknown> } }>('get_preset', {
      recipe,
      kind: 'finalize',
      name: 'daily',
    });
    expect(getTool.isError).toBe(false);
    expect(getTool.data?.record).toEqual({ options: { denoise: 0.6 } });
  });
});

describe('result.resolved_options (worker-written, opaque)', () => {
  it('findProducingRequest finds the request whose result.generation_ids includes the generation; null otherwise', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe, { denoise: 'tidy' });

    const producing = await findProducingRequest(env.DB, delivered.id);
    expect(producing).not.toBeNull();
    expect(JSON.parse(producing!.payload_json)).toMatchObject({ options: { denoise: 'tidy' } });

    const { generation: unrelated } = await createGeneration();
    expect(await findProducingRequest(env.DB, unrelated.id)).toBeNull();
  });

  it('/g/{short_id} of the delivered row renders requested vs resolved options when the worker wrote resolved_options', async () => {
    const recipe = uniqueRecipe();
    const { generation: source } = await createGeneration({ requestOverrides: { recipe } });

    const finalizeReq = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: source.id, options: { denoise: 'tidy' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(finalizeReq.status).toBe(201);

    const claimed = await req('/api/v1/requests/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: `worker-${crypto.randomUUID()}` }),
    });
    const claimedBody = (await claimed.json()) as { worker_id: string };
    const { generation: delivered } = await createGeneration({
      requestId: finalizeReq.body.id,
      requestOverrides: { recipe },
      jobOverrides: { source_generation_id: source.id },
    });

    const done = await postJson(
      `/api/v1/requests/${finalizeReq.body.id}`,
      {
        status: 'done',
        worker_id: claimedBody.worker_id,
        result: { generation_ids: [delivered.id], resolved_options: { denoise: 0.65 } },
      },
      'PATCH',
    );
    expect(done.status).toBe(200);

    const html = await (await req(`/g/${delivered.short_id}`)).text();
    expect(html).toContain('仕上げの解決値');
    expect(html).toContain('{&quot;denoise&quot;:&quot;tidy&quot;}');
    expect(html).toContain('{&quot;denoise&quot;:0.65}');

    // The source's own page lists this request among those targeting it and shows the resolved
    // value too, but it's not the delivered row, so no 仕上げの解決値 section.
    const sourceHtml = await (await req(`/g/${source.short_id}`)).text();
    expect(sourceHtml).not.toContain('仕上げの解決値');
    expect(sourceHtml).toContain('resolved:');
    expect(sourceHtml).toContain('{&quot;denoise&quot;:0.65}');
  });

  it('a delivered row with no resolved_options written yet shows no 仕上げの解決値 section', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createFinalizeResult(recipe, { denoise: 0.6 });
    const html = await (await req(`/g/${delivered.short_id}`)).text();
    expect(html).not.toContain('仕上げの解決値');
  });
});
