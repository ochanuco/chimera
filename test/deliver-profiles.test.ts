import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, createRequest, getJson, mcpToolCall, postJson, req, clearRequests } from './helpers';
import { listDeliverProfiles } from '../src/lib/presets';
import {
  getCatalog,
  findDeliverDials,
  findDeliverDefaults,
  findDeliverOutlines,
  findDof,
  findDeliverBackdropColor,
  findRedrawDials,
  findRepairDials,
  findRedrawDefaults,
  findRedrawLight,
} from '../src/lib/catalogs';
import { findProducingRequest } from '../src/lib/requests';
import { deliverOptionsSchema, redrawOptionsSchema } from '../src/schemas/requests';

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
          redraw: { denoise: { tidy: 0.65, heavy: 0.8 } },
          deliver: { keep_legwear: { on: 0.62 } },
        },
      },
    ],
    patches: {},
  };
}

function catalogWithDeliverDefaults(recipe: string, defaults: unknown) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag' }],
        ...(defaults === undefined ? {} : { deliver: { defaults } }),
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
 * A raw (source) Generation plus a deliver request claimed and marked done against a second
 * (delivered) Generation — the shape promote_to_profile / applyDeliverProfile expect.
 */
async function createDeliverResult(recipe: string, options: Record<string, unknown> = {}) {
  const { generation: source } = await createGeneration({ requestOverrides: { recipe } });

  const deliverReq = await postJson<RequestBody>('/api/v1/requests', {
    kind: 'deliver',
    payload: { generation_id: source.id, options },
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
  });
  expect(deliverReq.status).toBe(201);

  const claimed = await claim(`worker-${crypto.randomUUID()}`);
  expect(claimed.status).toBe(200);
  expect(claimed.body!.id).toBe(deliverReq.body.id);

  const { generation: delivered } = await createGeneration({
    requestId: deliverReq.body.id,
    requestOverrides: { recipe },
    jobOverrides: { source_generation_id: source.id },
  });

  const done = await postJson(
    `/api/v1/requests/${deliverReq.body.id}`,
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
    const expectedDials = { redraw: { denoise: { tidy: 0.65, heavy: 0.8 } }, deliver: { keep_legwear: { on: 0.62 } } };

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

describe('redrawOptionsSchema', () => {
  it('accepts keep_regions rectangles and a keep_strength between 0 and 1 on canvas', () => {
    expect(redrawOptionsSchema.safeParse({ method: 'canvas', keep_regions: [[0.3, 0.1, 0.7, 0.4]], keep_strength: 0.25 }).success).toBe(true);
  });

  it.each([
    ['a null keep_regions', { method: 'canvas', keep_regions: null }],
    ['a rectangle outside 0..1', { method: 'canvas', keep_regions: [[0, 0, 1.2, 1]] }],
    ['a rectangle with x0 >= x1', { method: 'canvas', keep_regions: [[0.7, 0.1, 0.3, 0.4]] }],
    ['keep_strength 0', { method: 'canvas', keep_strength: 0 }],
    ['keep_strength 1', { method: 'canvas', keep_strength: 1 }],
    ['a null keep_strength', { method: 'canvas', keep_strength: null }],
    ['a non-integer hires', { method: 'hires', hires: 2048.5 }],
    ['a string hires', { method: 'hires', hires: '2048' }],
    ['a hires below 64', { method: 'hires', hires: 32 }],
    ['hires denoise 0', { method: 'hires', hires: 2048, denoise: 0 }],
    ['hires denoise above 1', { method: 'hires', hires: 2048, denoise: 1.1 }],
    ['an unknown method', { method: 'repin' }],
    ['no method', { denoise: 0.4 }],
  ])('rejects %s', (_label, options) => {
    expect(redrawOptionsSchema.safeParse(options).success).toBe(false);
  });

  it('accepts hires with or without a denoise, and each light form', () => {
    expect(redrawOptionsSchema.safeParse({ method: 'hires', hires: 2048, denoise: 0.45 }).success).toBe(true);
    expect(redrawOptionsSchema.safeParse({ method: 'hires', hires: null }).success).toBe(true);
    expect(redrawOptionsSchema.safeParse({ method: 'light', scene: 'sunset' }).success).toBe(true);
    expect(redrawOptionsSchema.safeParse({ method: 'light', scene: 'moon', from: 'ne' }).success).toBe(true);
  });
});

describe('deliverOptionsSchema', () => {
  it('accepts outlines as up to 6 {color, width} entries, empty and null included', () => {
    expect(deliverOptionsSchema.safeParse({ outlines: [{ color: '#ffffff', width: 0.4 }, { color: '#885B80', width: 5 }] }).success).toBe(true);
    expect(deliverOptionsSchema.safeParse({ outlines: [] }).success).toBe(true);
    expect(deliverOptionsSchema.safeParse({ outlines: null }).success).toBe(true);
    const six = Array.from({ length: 6 }, () => ({ color: '#000000', width: 1 }));
    expect(deliverOptionsSchema.safeParse({ outlines: six }).success).toBe(true);
  });

  it('accepts every stroke_light direction and even', () => {
    for (const v of ['even', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', null]) {
      expect(deliverOptionsSchema.safeParse({ stroke_light: v }).success).toBe(true);
    }
  });

  it.each([
    ['stroke_light none', { stroke_light: 'none' }],
    ['dof in deliver options', { dof: { focus: [0.5, 0.5], f_number: 2.8 } }],
    ['null dof in deliver options', { dof: null }],
    ['7 outlines', { outlines: Array.from({ length: 7 }, () => ({ color: '#000000', width: 1 })) }],
    ['a zero width', { outlines: [{ color: '#000000', width: 0 }] }],
    ['a width above 5', { outlines: [{ color: '#000000', width: 5.1 }] }],
    ['a short color', { outlines: [{ color: '#fff', width: 1 }] }],
    ['a color without #', { outlines: [{ color: 'ffffff', width: 1 }] }],
    ['an unknown outline key', { outlines: [{ color: '#ffffff', width: 1, blur: 1 }] }],
    ['an outline without width', { outlines: [{ color: '#ffffff' }] }],
  ])('rejects %s', (_label, options) => {
    expect(deliverOptionsSchema.safeParse(options).success).toBe(false);
  });

  it.each([{ scene: 'sunset' }, { scene: 'moon', from: 'ne' }, null])('accepts light %j', (light) => {
    expect(deliverOptionsSchema.safeParse({ light }).success).toBe(true);
  });

  it.each([
    ['an unknown light scene', { light: { scene: 'noon' } }],
    ['a light without scene', { light: { from: 'nw' } }],
    ['an unknown light from', { light: { scene: 'sunset', from: 'up' } }],
    ['an unknown light key', { light: { scene: 'sunset', strength: 1 } }],
  ])('rejects %s', (_label, options) => {
    expect(deliverOptionsSchema.safeParse(options).success).toBe(false);
  });

  it('rejects the options finalize carried that belong to redraw or are gone', () => {
    for (const key of ['deliver_only', 'denoise', 'hires', 'repair', 'repair_seeds', 'handdrawn', 'toe_guard', 'lora_strength']) {
      expect(deliverOptionsSchema.safeParse({ [key]: true }).success, key).toBe(false);
    }
  });
});

describe('redraw/deliver/masked_redraw options accept dial words', () => {
  it('redraw canvas: denoise accepts a word; reject a malformed string', async () => {
    const { generation } = await createGeneration();
    const ok = await postJson('/api/v1/requests', {
      kind: 'redraw',
      payload: { generation_id: generation.id, options: { method: 'canvas', denoise: 'tidy' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(ok.status).toBe(201);

    const bad = await postJson('/api/v1/requests', {
      kind: 'redraw',
      payload: { generation_id: generation.id, options: { method: 'canvas', denoise: 'Tidy!' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(bad.status).toBe(400);
  });

  it('deliver: keep_legwear accepts true, a number, null and a word; rejects a malformed string', async () => {
    const { generation } = await createGeneration();
    for (const keep_legwear of [true, 0.5, null, 'on']) {
      const ok = await postJson('/api/v1/requests', {
        kind: 'deliver',
        payload: { generation_id: generation.id, options: { keep_legwear } },
        idempotency_key: crypto.randomUUID(),
        created_by: 'gui',
      });
      expect(ok.status).toBe(201);
    }
    const bad = await postJson('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: generation.id, options: { keep_legwear: 'On!' } },
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

describe('deliver profile resolution (createRequest)', () => {
  it('resolves the latest active version and merges options, explicit keys (including null) winning', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });

    const { delivered } = await createDeliverResult(recipe, { keep_legwear: 0.7, repin: true });
    await setRatingGood(delivered.id);
    const promoted = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body.version).toBe(1);

    const created = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: generation.id, profile: { name: 'daily' }, options: { keep_legwear: null } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(created.status).toBe(201);
    expect(created.body.payload).toEqual({
      generation_id: generation.id,
      profile: { name: 'daily', version: 1 },
      options: { repin: true, keep_legwear: null },
    });
  });

  it('expands the profile before the payload hash: a replay of the same key is 200, and a later profile version does not turn it into a conflict', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });
    const { delivered: d1 } = await createDeliverResult(recipe, { keep_legwear: 0.6 });
    await setRatingGood(d1.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d1.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const body = {
      kind: 'deliver',
      payload: { generation_id: generation.id, profile: { name: 'daily', version: 1 } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    };
    const first = await postJson<RequestBody>('/api/v1/requests', body);
    expect(first.status).toBe(201);
    expect(first.body.payload.options).toEqual({ keep_legwear: 0.6 });

    const replay = await postJson<RequestBody>('/api/v1/requests', body);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);

    const explicit = await postJson('/api/v1/requests', {
      ...body,
      payload: { generation_id: generation.id, options: { keep_legwear: 0.6 } },
    });
    expect(explicit.status).toBe(409);
  });

  it('pins an explicit version, ignoring a later one', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });

    const { delivered: d1 } = await createDeliverResult(recipe, { keep_legwear: 0.6 });
    await setRatingGood(d1.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d1.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const { delivered: d2 } = await createDeliverResult(recipe, { keep_legwear: 0.8 });
    await setRatingGood(d2.id);
    const v2 = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: d2.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(v2.body.version).toBe(2);

    const created = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: generation.id, profile: { name: 'daily', version: 1 } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(created.status).toBe(201);
    expect(created.body.payload).toEqual({
      generation_id: generation.id,
      profile: { name: 'daily', version: 1 },
      options: { keep_legwear: 0.6 },
    });
  });

  it('404s an unknown profile name without creating a queued row', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });

    const res = await postJson('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: generation.id, profile: { name: 'nonexistent' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(404);

    const list = await getJson<{ items: unknown[] }>(`/api/v1/requests?kind=deliver&generation_id=${generation.id}`);
    expect(list.body.items).toEqual([]);
  });

  it('404s when the generation_id does not resolve', async () => {
    const res = await postJson('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: 'does-not-exist', profile: { name: 'daily' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(404);
  });
});

describe('resolvePreset for kind=deliver', () => {
  it('GET /api/v1/presets/{recipe}/deliver/{name}/{version} resolves to {options} with no patches', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createDeliverResult(recipe, { repin: true, keep_legwear: 'on' });
    await setRatingGood(delivered.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const got = await getJson<{ record: { options: Record<string, unknown> }; patches: unknown[] }>(
      `/api/v1/presets/${recipe}/deliver/daily/1`,
    );
    expect(got.status).toBe(200);
    expect(got.body.record).toEqual({ options: { repin: true, keep_legwear: 'on' } });
    expect(got.body.patches).toEqual([]);
  });
});

describe('promote_to_profile', () => {
  it('promotes a rating=good deliver-kind Generation; repeated names append the next version', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createDeliverResult(recipe, { repin: true, keep_legwear: 'on' });
    await setRatingGood(delivered.id);

    const v1 = await postJson<{ recipe: string; kind: string; name: string; version: number; source: string; record: unknown }>(
      '/api/v1/presets/promote-profile',
      { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() },
    );
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({ recipe, kind: 'deliver', name: 'daily', version: 1, source: 'promote' });
    expect(v1.body.record).toEqual({ options: { repin: true, keep_legwear: 'on' } });

    const { delivered: delivered2 } = await createDeliverResult(recipe, { keep_legwear: 0.8 });
    await setRatingGood(delivered2.id);
    const v2 = await postJson<{ version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered2.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(v2.status).toBe(200);
    expect(v2.body.version).toBe(2);

    const versions = await getJson<{ items: { version: number }[] }>(`/api/v1/presets/${recipe}/deliver/daily`);
    expect(versions.body.items.map((p) => p.version)).toEqual([2, 1]);
  });

  it('idempotency replay returns the same version; the same key with different input is a conflict', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createDeliverResult(recipe);
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
    const { delivered } = await createDeliverResult(recipe);
    const res = await postJson('/api/v1/presets/promote-profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
  });

  it('409s when the generation was not produced by a deliver request', async () => {
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
    const { delivered } = await createDeliverResult(recipe, { keep_legwear: 0.55 });
    await setRatingGood(delivered.id);
    const tool = await mcpToolCall<{ version: number; record: { options: Record<string, unknown> } }>('promote_to_profile', {
      generation_id: delivered.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.version).toBe(1);
    expect(tool.data?.record).toEqual({ options: { keep_legwear: 0.55 } });
  });
});

describe('deliver_generation MCP tool profile field', () => {
  it('passes profile through and resolves it server-side, same as REST', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ requestOverrides: { recipe } });
    const { delivered } = await createDeliverResult(recipe, { keep_legwear: 0.6 });
    await setRatingGood(delivered.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const tool = await mcpToolCall<{ request: { payload: Record<string, unknown> } }>('deliver_generation', {
      generation_id: generation.id,
      profile: { name: 'daily' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      profile: { name: 'daily', version: 1 },
      options: { keep_legwear: 0.6 },
    });
  });
});

describe('lib helpers for the UI (listDeliverProfiles / findDeliverDials)', () => {
  it('listDeliverProfiles returns each name once, at its latest active version, with options inlined', async () => {
    const recipe = uniqueRecipe();
    const { delivered: d1 } = await createDeliverResult(recipe, { keep_legwear: 0.6 });
    await setRatingGood(d1.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d1.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const { delivered: d2 } = await createDeliverResult(recipe, { keep_legwear: 0.9 });
    await setRatingGood(d2.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d2.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const { delivered: d3 } = await createDeliverResult(recipe, { keep_legwear: 'on' });
    await setRatingGood(d3.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: d3.id, name: 'heavy', idempotency_key: crypto.randomUUID() });

    const profiles = await listDeliverProfiles(env.DB, recipe);
    expect(profiles.map((p) => p.name).sort()).toEqual(['daily', 'heavy']);
    const daily = profiles.find((p) => p.name === 'daily');
    expect(daily?.version).toBe(2);
    expect(daily?.options).toEqual({ keep_legwear: 0.9 });
    const heavy = profiles.find((p) => p.name === 'heavy');
    expect(heavy?.options).toEqual({ keep_legwear: 'on' });
  });

  it('listDeliverProfiles returns [] for a recipe with no deliver Presets', async () => {
    const profiles = await listDeliverProfiles(env.DB, uniqueRecipe());
    expect(profiles).toEqual([]);
  });

  it('findDeliverDials / findRedrawDials extract recipes[].dials.deliver / .redraw; null when recipe/dials are absent', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${recipeRef}`, catalogWithDials(recipe), 'PUT');

    const found = await getCatalog(env.DB, recipeRef);
    expect(found).not.toBeNull();
    expect(findDeliverDials(found!.doc, recipe)).toEqual({ keep_legwear: { on: 0.62 } });
    expect(findRedrawDials(found!.doc, recipe)).toEqual({ denoise: { tidy: 0.65, heavy: 0.8 } });
    expect(findRepairDials(found!.doc, recipe)).toBeNull();
    const withRepair = { ...found!.doc, recipes: [{ name: recipe, poses: [], dials: { repair: { denoise: { light: 0.4 } } } }] };
    expect(findRepairDials(withRepair, recipe)).toEqual({ denoise: { light: 0.4 } });
    expect(findRepairDials(found!.doc, 'nonexistent-recipe')).toBeNull();
    expect(findDeliverDials(found!.doc, 'nonexistent-recipe')).toBeNull();
    expect(findRedrawDials(found!.doc, 'nonexistent-recipe')).toBeNull();
  });

  it('findDeliverDefaults extracts recipes[].deliver.defaults; null when deliver is absent or defaults is not an object', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${recipeRef}`, catalogWithDeliverDefaults(recipe, { repin: true, stroke_light: 'n', backdrop: 'dots' }), 'PUT');

    const found = await getCatalog(env.DB, recipeRef);
    expect(found).not.toBeNull();
    expect(findDeliverDefaults(found!.doc, recipe)).toEqual({ repin: true, stroke_light: 'n', backdrop: 'dots' });
    expect(findDeliverDefaults(found!.doc, 'nonexistent-recipe')).toBeNull();

    // Older catalogs never publish a `deliver` key at all — must resolve to null, not throw.
    const noDeliverRef = uniqueRecipeRef();
    const noDeliverRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${noDeliverRef}`, catalogWithDeliverDefaults(noDeliverRecipe, undefined), 'PUT');
    const foundNoFinalize = await getCatalog(env.DB, noDeliverRef);
    expect(findDeliverDefaults(foundNoFinalize!.doc, noDeliverRecipe)).toBeNull();

    // A malformed `deliver.defaults` (not a plain object) is treated as absent, not thrown.
    const malformedRef = uniqueRecipeRef();
    const malformedRecipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${malformedRef}`, catalogWithDeliverDefaults(malformedRecipe, 'not-an-object'), 'PUT');
    const foundMalformed = await getCatalog(env.DB, malformedRef);
    expect(findDeliverDefaults(foundMalformed!.doc, malformedRecipe)).toBeNull();
  });
});

describe('redraw and deliver catalog sections', () => {
  const section = {
    deliver: { defaults: { repin: true, stroke_light: 'n', backdrop: 'dots' }, backdrop_color: '#c7e5e9' },
    redraw: {
      defaults: { canvas: { denoise: 0.4, size: 2560, route: 'pixel' }, hires: { hires_denoise: 0.45 } },
      light: { scenes: ['sunset', 'moon'], from: ['n', 'nw'], default_from: 'nw' },
    },
  };

  async function publish(recipe: string, extra: Record<string, unknown>) {
    const ref = uniqueRecipeRef();
    const put = await postJson<{ recipes: Record<string, unknown>[] }>(
      `/api/v1/catalogs/${ref}`,
      { schema_version: 2, recipes: [{ name: recipe, poses: [], ...extra }], patches: {} },
      'PUT',
    );
    expect(put.status).toBe(200);
    return { ref, put: put.body };
  }

  it('readers pick recipes[].deliver.* and recipes[].redraw.*', async () => {
    const recipe = uniqueRecipe();
    const { ref } = await publish(recipe, section);
    const doc = (await getCatalog(env.DB, ref))!.doc;
    expect(findDeliverDefaults(doc, recipe)).toEqual(section.deliver.defaults);
    expect(findDeliverBackdropColor(doc, recipe)).toBe('#c7e5e9');
    expect(findRedrawDefaults(doc, recipe)).toEqual(section.redraw.defaults);
    expect(findRedrawLight(doc, recipe)).toEqual({ scenes: ['sunset', 'moon'], from: ['n', 'nw'], defaultFrom: 'nw' });
  });

  it('does not read the legacy recipes[].finalize.* sections', async () => {
    const recipe = uniqueRecipe();
    const { ref } = await publish(recipe, {
      finalize: {
        defaults: { repin: false },
        backdrop_color: '#c7e5e9',
        dof: { f_number: { min: 2.8, max: 22, default: 2.8, stops: [2.8] } },
        light: section.redraw.light,
      },
      dials: { finalize: { denoise: { tidy: 0.65 } } },
    });
    const doc = (await getCatalog(env.DB, ref))!.doc;
    expect(findDeliverDefaults(doc, recipe)).toBeNull();
    expect(findDeliverBackdropColor(doc, recipe)).toBeNull();
    expect(findRedrawLight(doc, recipe)).toBeNull();
    expect(findRedrawDials(doc, recipe)).toBeNull();
    expect(findDeliverDials(doc, recipe)).toBeNull();
  });

  it('a malformed backdrop_color or redraw.defaults entry is treated as absent', async () => {
    const recipe = uniqueRecipe();
    const { ref } = await publish(recipe, { deliver: { backdrop_color: 'white' }, redraw: { defaults: { canvas: 'x', hires: { hires_denoise: 0.45 } } } });
    const doc = (await getCatalog(env.DB, ref))!.doc;
    expect(findDeliverBackdropColor(doc, recipe)).toBeNull();
    expect(findRedrawDefaults(doc, recipe)).toEqual({ hires: { hires_denoise: 0.45 } });
  });

  it('PUT, GET, the catalog list and MCP list_catalog expose recipes[].deliver and recipes[].redraw', async () => {
    const recipe = uniqueRecipe();
    const { ref, put } = await publish(recipe, section);
    expect(put.recipes[0]).toMatchObject({ deliver: section.deliver, redraw: section.redraw });

    const get = await getJson<{ recipes: Record<string, unknown>[] }>(`/api/v1/catalogs/${ref}`);
    expect(get.body.recipes[0]).toMatchObject({ deliver: section.deliver, redraw: section.redraw });

    const list = await getJson<{ items: { recipe_ref: string; recipes: Record<string, unknown>[] }[] }>('/api/v1/catalogs');
    expect(list.body.items.find((i) => i.recipe_ref === ref)?.recipes[0]).toMatchObject({ deliver: section.deliver, redraw: section.redraw });

    const tool = await mcpToolCall<{ recipes: Record<string, unknown>[] }>('list_catalog', { recipe_ref: ref });
    expect(tool.isError).toBe(false);
    expect(tool.data?.recipes[0]).toMatchObject({ deliver: section.deliver, redraw: section.redraw });
  });
});

describe('findDof', () => {
  const fNumber = { min: 1.4, max: 22, default: 2.8, stops: [1.4, 2.0, 2.8, 4.0, 5.6, 8.0, 11.0, 16.0, 22.0] };

  function catalogWithDof(dof: unknown) {
    return { schema_version: 3, recipes: [{ name: uniqueRecipe(), poses: [] }], patches: {}, dof };
  }

  async function read(dof: unknown) {
    const ref = uniqueRecipeRef();
    const put = await postJson(`/api/v1/catalogs/${ref}`, catalogWithDof(dof), 'PUT');
    expect(put.status).toBe(200);
    return findDof((await getCatalog(env.DB, ref))!.doc);
  }

  it('reads the top-level dof section, defaulting scope layers to true', async () => {
    const viewfinder = { values: ['off', 'on', 'both'], default: 'off' };
    expect(await read({ f_number: fNumber, scope: { figure: true, outline: true, backdrop: false }, viewfinder, focus: 'x, y', guide_radius_per_f: 0.0417 })).toEqual({
      ...fNumber,
      scope: { figure: true, outline: true, backdrop: false },
      viewfinder,
      focus: 'x, y',
      guideRadiusPerF: 0.0417,
    });
    expect(await read({ f_number: fNumber })).toEqual({
      ...fNumber,
      scope: { figure: true, outline: true, backdrop: true },
      viewfinder: null,
      focus: null,
      guideRadiusPerF: null,
    });
  });

  it('drops a malformed viewfinder and a non-positive guide radius, and is null without a usable f_number', async () => {
    for (const bad of [{ values: ['on', 'both'], default: 'on' }, { values: ['off', 'on'], default: 'both' }, 'on']) {
      expect((await read({ f_number: fNumber, viewfinder: bad }))?.viewfinder).toBeNull();
    }
    for (const [raw, expected] of [[0, null], [-1, null], ['0.04', null]] as const) {
      expect((await read({ f_number: fNumber, guide_radius_per_f: raw }))?.guideRadiusPerF).toBe(expected);
    }
    for (const bad of [{ f_number: 'x' }, { f_number: { ...fNumber, stops: [] } }, { f_number: { ...fNumber, default: '2.8' } }, {}]) {
      expect(await read(bad)).toBeNull();
    }
    const ref = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${ref}`, { schema_version: 3, recipes: [], patches: {} }, 'PUT');
    expect(findDof((await getCatalog(env.DB, ref))!.doc)).toBeNull();
  });

  it('is published in the catalog summary', async () => {
    const ref = uniqueRecipeRef();
    const put = await postJson<{ dof: unknown }>(`/api/v1/catalogs/${ref}`, catalogWithDof({ f_number: fNumber }), 'PUT');
    expect(put.body.dof).toEqual({ f_number: fNumber });
  });
});

describe('findDeliverOutlines', () => {
  async function read(outlines: unknown) {
    const ref = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${ref}`, { schema_version: 3, recipes: [{ name: recipe, poses: [], deliver: { outlines } }], patches: {} }, 'PUT');
    return findDeliverOutlines((await getCatalog(env.DB, ref))!.doc, recipe);
  }

  it('reads the default list and limits, falling back to 6 / 5', async () => {
    const list = [{ color: '#ffffff', width: 0.4 }, { color: '#885b80', width: 1.04 }];
    expect(await read({ default: list, max_count: 4, max_width: 3 })).toEqual({ default: list, maxCount: 4, maxWidth: 3 });
    expect(await read({ default: list })).toEqual({ default: list, maxCount: 6, maxWidth: 5 });
    expect(await read({ default: [] })).toEqual({ default: [], maxCount: 6, maxWidth: 5 });
  });

  it('is null when absent or any default entry is malformed', async () => {
    expect(await read(undefined)).toBeNull();
    expect(await read({ default: 'x' })).toBeNull();
    expect(await read({ default: [{ color: 'white', width: 1 }] })).toBeNull();
    expect(await read({ default: [{ color: '#ffffff', width: '1' }] })).toBeNull();
  });
});

describe('findRedrawLight', () => {
  const light = { scenes: ['sunset', 'moon'], from: ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'], default_from: 'nw' };

  async function lookup(value: unknown) {
    const ref = uniqueRecipeRef();
    const name = uniqueRecipe();
    await postJson(`/api/v1/catalogs/${ref}`, { schema_version: 1, recipes: [{ name, poses: [], redraw: { light: value } }], patches: {} }, 'PUT');
    return findRedrawLight((await getCatalog(env.DB, ref))!.doc, name);
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
    await postJson(`/api/v1/catalogs/${ref}`, { schema_version: 1, recipes: [{ name: 'only', poses: [], redraw: { light } }], patches: {} }, 'PUT');
    expect(findRedrawLight((await getCatalog(env.DB, ref))!.doc, 'nonexistent-recipe')).toBeNull();
  });
});

describe('list_presets / get_preset accept kind=deliver', () => {
  it('list_presets kind=deliver and get_preset match the REST routes', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createDeliverResult(recipe, { keep_legwear: 0.6 });
    await setRatingGood(delivered.id);
    await postJson('/api/v1/presets/promote-profile', { generation_id: delivered.id, name: 'daily', idempotency_key: crypto.randomUUID() });

    const rest = await getJson<{ items: { kind: string; name: string }[] }>(`/api/v1/presets?recipe=${recipe}&kind=deliver`);
    expect(rest.body.items.map((p) => p.name)).toEqual(['daily']);

    const tool = await mcpToolCall<{ items: { kind: string; name: string }[] }>('list_presets', { recipe, kind: 'deliver' });
    expect(tool.isError).toBe(false);
    expect(tool.data?.items.map((p) => p.name)).toEqual(['daily']);

    const getTool = await mcpToolCall<{ record: { options: Record<string, unknown> } }>('get_preset', {
      recipe,
      kind: 'deliver',
      name: 'daily',
    });
    expect(getTool.isError).toBe(false);
    expect(getTool.data?.record).toEqual({ options: { keep_legwear: 0.6 } });
  });
});

describe('result.resolved_options (worker-written, opaque)', () => {
  it('findProducingRequest finds the request whose result.generation_ids includes the generation; null otherwise', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createDeliverResult(recipe, { keep_legwear: 'tidy' });

    const producing = await findProducingRequest(env.DB, delivered.id);
    expect(producing).not.toBeNull();
    expect(JSON.parse(producing!.payload_json)).toMatchObject({ options: { keep_legwear: 'tidy' } });

    const { generation: unrelated } = await createGeneration();
    expect(await findProducingRequest(env.DB, unrelated.id)).toBeNull();
  });

  it('/g/{short_id} of the delivered row renders the resolved options as rows, with the raw requested/resolved JSON folded, when the worker wrote resolved_options', async () => {
    const recipe = uniqueRecipe();
    const { generation: source } = await createGeneration({ requestOverrides: { recipe } });

    const deliverReq = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: source.id, options: { keep_legwear: 'tidy' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(deliverReq.status).toBe(201);

    const claimed = await req('/api/v1/requests/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: `worker-${crypto.randomUUID()}` }),
    });
    const claimedBody = (await claimed.json()) as { worker_id: string };
    const { generation: delivered } = await createGeneration({
      requestId: deliverReq.body.id,
      requestOverrides: { recipe },
      jobOverrides: { source_generation_id: source.id },
    });

    const done = await postJson(
      `/api/v1/requests/${deliverReq.body.id}`,
      {
        status: 'done',
        worker_id: claimedBody.worker_id,
        result: {
          generation_ids: [delivered.id],
          resolved_options: {
            keep_legwear: 0.62,
            backdrop: null,
            stroke_light: 'n',
            dof: { focus: [0.37, 0.36], f_number: 2.2, scope: 'all', viewfinder: 'both' },
          },
        },
      },
      'PATCH',
    );
    expect(done.status).toBe(200);

    const html = await (await req(`/g/${delivered.short_id}`)).text();
    expect(html).toContain('仕上げの解決値');
    expect(html).toContain('<td>keep legwear</td><td>0.62</td>');
    expect(html).toContain('<td>背景</td><td>透過 PNG</td>');
    expect(html).toContain('<td>紫縁</td><td>立体（上から）</td>');
    expect(html).toContain('<td>F値</td><td>F2.2</td>');
    expect(html).toContain('<td>ピント位置</td><td>x 0.37 · y 0.36</td>');
    expect(html).toContain('<td>ボケの範囲</td><td>背景も</td>');
    expect(html).toContain('<td>ファインダー</td><td>ON/OFF 2枚</td>');
    expect(html).toContain('&quot;keep_legwear&quot;: &quot;tidy&quot;');

    // The source's own page lists this request among those targeting it and shows the resolved
    // value too, but it's not the delivered row, so no 仕上げの解決値 section.
    const sourceHtml = await (await req(`/g/${source.short_id}`)).text();
    expect(sourceHtml).not.toContain('仕上げの解決値');
    expect(sourceHtml).toContain('resolved:');
    expect(sourceHtml).toContain('&quot;keep_legwear&quot;:0.62');
  });

  it('a redraw output renders its resolved method options as rows', async () => {
    const recipe = uniqueRecipe();
    const { generation: source } = await createGeneration({ requestOverrides: { recipe } });
    const redrawReq = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'redraw',
      payload: { generation_id: source.id, options: { method: 'light', scene: 'moon' } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    const claimed = await req('/api/v1/requests/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: `worker-${crypto.randomUUID()}` }),
    });
    const claimedBody = (await claimed.json()) as { worker_id: string };
    const { generation: redrawn } = await createGeneration({
      requestId: redrawReq.body.id,
      requestOverrides: { recipe },
      jobOverrides: { source_generation_id: source.id },
    });
    await postJson(
      `/api/v1/requests/${redrawReq.body.id}`,
      {
        status: 'done',
        worker_id: claimedBody.worker_id,
        result: { generation_ids: [redrawn.id], resolved_options: { method: 'light', scene: 'moon', from: 'nw' } },
      },
      'PATCH',
    );

    const html = await (await req(`/g/${redrawn.short_id}`)).text();
    expect(html).toContain('<td>方法</td><td>light</td>');
    expect(html).toContain('<td>光源</td><td>月明かり</td>');
    expect(html).toContain('<td>光の向き</td><td>左上から</td>');
  });

  it('an old finalize Generation still renders its resolved options', async () => {
    const { generation: source } = await createGeneration();
    const finalizeRow = await createRequest({
      kind: 'finalize',
      status: 'done',
      payload: { generation_id: source.id, options: { denoise: 'tidy', repin: true } },
      parameters: { kind: 'hires-chain', base_generation: source.id },
    });
    const { generation: delivered } = await createGeneration({
      requestId: finalizeRow.body.id,
      jobOverrides: { source_generation_id: source.id },
    });
    await env.DB.prepare('UPDATE requests SET result_json = ? WHERE id = ?')
      .bind(JSON.stringify({ generation_ids: [delivered.id], resolved_options: { denoise: 0.65, deliver_only: true, repair: ['feet'] } }), finalizeRow.body.id)
      .run();

    const res = await req(`/g/${delivered.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('仕上げの解決値');
    expect(html).toContain('<td>denoise</td><td>0.65</td>');
    expect(html).toContain('<td>deliver only</td><td>ON</td>');
    expect(html).toContain('<td>部分描き直し</td><td>feet</td>');
    // An old finalize output is a delivered picture: neither form is offered.
    expect(html).not.toContain('redraw-form');
    expect(html).not.toContain('deliver-form');
  });

  it('a delivered row with no resolved_options written yet shows no 仕上げの解決値 section', async () => {
    const recipe = uniqueRecipe();
    const { delivered } = await createDeliverResult(recipe, { keep_legwear: 0.6 });
    const html = await (await req(`/g/${delivered.short_id}`)).text();
    expect(html).not.toContain('仕上げの解決値');
  });
});
