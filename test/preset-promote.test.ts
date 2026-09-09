import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall, postJson, req } from './helpers';

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

// presets は recipe_ref ではなく (recipe, kind, name, version) で一意なので、recipe
// 名自体をテストごとにユニークにする (test/presets.test.ts と同じ理由)。
function uniqueRecipe(): string {
  return `yukari-${crypto.randomUUID()}`;
}

function sampleCatalog(recipe: string) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag, warm light' }],
        costumes: [{ name: 'default', prompt: 'plain roomwear' }],
        expressions: [{ name: 'smile', prompt: 'a gentle smile' }],
      },
    ],
    patches: {},
    git_commit: 'abc1234',
    git_branch: 'main',
    generated_at: '2026-09-08T00:00:00.000Z',
  };
}

async function publishAndImport(recipe: string): Promise<void> {
  const recipeRef = uniqueRecipeRef();
  await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(recipe), 'PUT');
  const res = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: recipeRef });
  expect(res.status).toBe(200);
}

interface RequestBody {
  id: string;
  status: string;
  payload: { generation?: { presets?: unknown } } & Record<string, unknown>;
  idempotency_key: string;
  worker_id: string | null;
}

function generateRequestBody(recipe: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'generate',
    payload: {
      schema_version: 1,
      request: { instruction: 'test run', count: 1 },
      generation: { recipe, parameters: { pose: 'lounge' } },
    },
    idempotency_key: crypto.randomUUID(),
    created_by: 'brain',
    ...overrides,
  };
}

async function createGenerateRequest(recipe: string, overrides: Record<string, unknown> = {}) {
  return postJson<RequestBody>('/api/v1/requests', generateRequestBody(recipe, overrides));
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

interface PresetView {
  id: string;
  recipe: string;
  kind: string;
  name: string;
  version: number;
  status: string;
  source: string;
  source_generation_id: string | null;
  note: string | null;
  record: unknown;
  patches: unknown[];
  created_at: string;
}

async function setRatingGood(generationId: string): Promise<void> {
  const res = await postJson(`/api/v1/generations/${generationId}/rating`, { rating: 'good' }, 'PUT');
  expect(res.status).toBe(200);
}

async function setPatches(generationId: string, patches: unknown[]): Promise<void> {
  const res = await postJson(
    `/api/v1/generations/${generationId}/semantic`,
    { schema_version: 1, attributes: { patches } },
    'PUT',
  );
  expect(res.status).toBe(200);
}

/**
 * Builds a raw (non-refinement) Batch + Generation for `recipe`, and — unless
 * `withPin` is false — a matching kind=generate request that pins `parameters.pose`
 * (the pin promote later reads as its base). Marks the request `done` against the
 * created Batch so `promoteGenerationToPreset`'s `json_extract(result_json, '$.batch_id')`
 * lookup finds it.
 */
async function setupGeneration(recipe: string, options: { withPin?: boolean; parameters?: Record<string, unknown> } = {}) {
  const { withPin = true, parameters = { pose: 'lounge' } } = options;
  const { batch, generation } = await createGeneration({ batchOverrides: { recipe, parameters } });

  if (withPin) {
    const genReq = await createGenerateRequest(recipe, {
      payload: {
        schema_version: 1,
        request: { instruction: 'test run', count: 1 },
        generation: { recipe, parameters },
      },
    });
    expect(genReq.status).toBe(201);

    const claimed = await claim(`worker-${crypto.randomUUID()}`);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(genReq.body.id);

    const done = await postJson(
      `/api/v1/requests/${genReq.body.id}`,
      { status: 'done', worker_id: claimed.body!.worker_id, result: { batch_id: batch.id, generation_ids: [generation.id] } },
      'PATCH',
    );
    expect(done.status).toBe(200);
  }

  return { batch, generation };
}

describe('preset pin (createRequest / generate)', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
  });

  it('pins generation.presets to the latest active version when the recipe has a matching preset', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const res = await createGenerateRequest(recipe);
    expect(res.status).toBe(201);
    expect(res.body.payload.generation?.presets).toEqual([{ kind: 'pose', name: 'lounge', version: 1 }]);
  });

  it('does not pin, and does not fail, when the recipe has no presets at all', async () => {
    const recipe = uniqueRecipe(); // never imported
    const res = await createGenerateRequest(recipe);
    expect(res.status).toBe(201);
    expect(res.body.payload.generation).not.toHaveProperty('presets');
  });

  it('400s when parameters name a preset that does not exist for a recipe that has some presets', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const res = await postJson('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'test', count: 1 },
        generation: { recipe, parameters: { pose: 'nonexistent' } },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(400);
  });

  it('does not pin a graph-mode payload', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const res = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'test', count: 1 },
        generation: { graph: { nodes: [] }, recipe, parameters: { pose: 'lounge' } },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(201);
    expect(res.body.payload.generation).not.toHaveProperty('presets');
  });

  it('respects an explicit generation.presets without resolving from parameters', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const explicit = [{ kind: 'pose', name: 'lounge', version: 999 }];
    const res = await postJson<RequestBody>('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'test', count: 1 },
        generation: { recipe, parameters: { pose: 'lounge' }, presets: explicit },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(201);
    expect(res.body.payload.generation?.presets).toEqual(explicit);
  });

  it('idempotency_key replay returns 200 with the same pinned payload (same payload_hash)', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const body = generateRequestBody(recipe);
    const first = await postJson<RequestBody>('/api/v1/requests', body);
    expect(first.status).toBe(201);

    const second = await postJson<RequestBody>('/api/v1/requests', body);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.payload).toEqual(first.body.payload);
  });
});

describe('POST /api/v1/presets/promote', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
  });

  it('promotes a rating=good Generation to version 2, body {base, patches}; GET resolves the root record + patches', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);
    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    await setPatches(generation.id, patches);

    const res = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      note: 'looked great',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.source).toBe('promote');
    expect(res.body.source_generation_id).toBe(generation.id);
    expect(res.body.note).toBe('looked great');
    expect(res.body.record).toEqual({ name: 'lounge', prompt: 'reclining on a beanbag, warm light' });
    expect(res.body.patches).toEqual(patches);

    const got = await getJson<PresetView>(`/api/v1/presets/${recipe}/pose/lounge/2`);
    expect(got.status).toBe(200);
    expect(got.body.record).toEqual(res.body.record);
    expect(got.body.patches).toEqual(res.body.patches);
    expect(got.body.source_generation_id).toBe(generation.id);
  });

  it('409s when rating is not good', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe);
    // rating defaults to null (never set to good).

    const res = await postJson('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
  });

  it('409s when there is no pin and no base_version', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe, { withPin: false });
    await setRatingGood(generation.id);

    const res = await postJson('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
  });

  it('an explicit base_version works even without a pin', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe, { withPin: false, parameters: { pose: 'lounge' } });
    await setRatingGood(generation.id);

    const res = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      base_version: 1,
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.record).toEqual({ name: 'lounge', prompt: 'reclining on a beanbag, warm light' });
  });

  it('idempotency_key replay returns the already-created version instead of creating a new one', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);

    const idempotencyKey = crypto.randomUUID();
    const first = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: idempotencyKey,
    });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);

    const second = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: idempotencyKey,
    });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.version).toBe(2);

    const versions = await getJson<{ items: { version: number }[] }>(`/api/v1/presets/${recipe}/pose/lounge`);
    expect(versions.body.items.map((v) => v.version)).toEqual([2, 1]);
  });
});

describe('MCP promote_to_pose', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
  });

  it('creates the same version REST would, verified through GET /api/v1/presets/{recipe}/{kind}/{name}/{version}', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);
    const patches = [{ target: 'pose', op: 'append', reason: 'mcp promote', value: 'holding a drink' }];
    await setPatches(generation.id, patches);

    const tool = await mcpToolCall<PresetView>('promote_to_pose', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: crypto.randomUUID(),
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.version).toBe(2);
    expect(tool.data?.source).toBe('promote');

    const rest = await getJson<PresetView>(`/api/v1/presets/${recipe}/pose/lounge/2`);
    expect(rest.status).toBe(200);
    expect(tool.data?.record).toEqual(rest.body.record);
    expect(tool.data?.patches).toEqual(rest.body.patches);
    expect(tool.data?.source_generation_id).toBe(rest.body.source_generation_id);
  });
});
