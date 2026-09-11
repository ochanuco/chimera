import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall, postJson, req } from './helpers';
import { listFinalizeProfiles } from '../src/lib/presets';
import { getCatalog, findFinalizeDials } from '../src/lib/catalogs';
import { findProducingRequest } from '../src/lib/requests';

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

interface RequestBody {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  worker_id: string | null;
  result: { batch_id: string; generation_ids: string[] } | null;
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
 * A raw (source) Generation plus a finalize request against it, claimed and marked done against a
 * second (delivered) Generation — the shape promote_to_profile and applyFinalizeProfile expect
 * (docs/worker-protocol.md「finalize」). `result.batch_id` is the delivered Generation's own Batch,
 * matching what the worker's `done` transition records.
 */
async function createFinalizeResult(recipe: string, options: Record<string, unknown> = {}) {
  const { generation: source } = await createGeneration({ batchOverrides: { recipe } });
  const { batch: deliveredBatch, generation: delivered } = await createGeneration({ batchOverrides: { recipe } });

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

  const done = await postJson(
    `/api/v1/requests/${finalizeReq.body.id}`,
    { status: 'done', worker_id: claimed.body!.worker_id, result: { batch_id: deliveredBatch.id, generation_ids: [delivered.id] } },
    'PATCH',
  );
  expect(done.status).toBe(200);

  return { source, delivered };
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM requests').run();
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

describe('finalize/repair/masked_redraw options accept dial words', () => {
  it('finalize: denoise / keep_legwear / toe_guard / lora_strength / repair_denoise accept a word; reject a malformed string', async () => {
    const { generation } = await createGeneration();

    const ok = await postJson('/api/v1/requests', {
      kind: 'finalize',
      payload: {
        generation_id: generation.id,
        options: {
          denoise: 'tidy',
          keep_legwear: 'on',
          toe_guard: 'heavy',
          lora_strength: 'strong',
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
    const { generation } = await createGeneration({ batchOverrides: { recipe } });

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
    const { generation } = await createGeneration({ batchOverrides: { recipe } });

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
    const { generation } = await createGeneration({ batchOverrides: { recipe } });

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
    const { generation } = await createGeneration({ batchOverrides: { recipe } });
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
    const { generation } = await createGeneration({ batchOverrides: { recipe } });
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
    const { generation: source } = await createGeneration({ batchOverrides: { recipe } });
    const { batch: deliveredBatch, generation: delivered } = await createGeneration({ batchOverrides: { recipe } });

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

    const done = await postJson(
      `/api/v1/requests/${finalizeReq.body.id}`,
      {
        status: 'done',
        worker_id: claimedBody.worker_id,
        result: { batch_id: deliveredBatch.id, generation_ids: [delivered.id], resolved_options: { denoise: 0.65 } },
      },
      'PATCH',
    );
    expect(done.status).toBe(200);

    const html = await (await req(`/g/${delivered.short_id}`)).text();
    expect(html).toContain('仕上げの解決値');
    expect(html).toContain('{&quot;denoise&quot;:&quot;tidy&quot;}');
    expect(html).toContain('{&quot;denoise&quot;:0.65}');

    // The source Generation's own page lists this request among those *targeting* it, and shows
    // the resolved value there too (it is not the delivered row, so no 仕上げの解決値 section).
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
