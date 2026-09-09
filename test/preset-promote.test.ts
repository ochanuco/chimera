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

/** Same shape as sampleCatalog, but with two importable poses — needed to pin a preset whose name differs from the recipe's other pose name. */
function twoPoseCatalog(recipe: string) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [
          { name: 'lounge', prompt: 'reclining on a beanbag, warm light' },
          { name: 'lounge-relaxed', prompt: 'reclining, a bit more relaxed' },
        ],
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

async function publishAndImportTwoPoses(recipe: string): Promise<void> {
  const recipeRef = uniqueRecipeRef();
  await postJson(`/api/v1/catalogs/${recipeRef}`, twoPoseCatalog(recipe), 'PUT');
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
  base_fingerprint: string | null;
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
 * lookup finds it. `patches` / `poseFingerprint`, when given, land on the Batch row itself
 * (`patches_json` / `pose_fingerprint`) — the source promote actually reads.
 */
async function setupGeneration(
  recipe: string,
  options: { withPin?: boolean; parameters?: Record<string, unknown>; patches?: unknown[]; poseFingerprint?: string } = {},
) {
  // patches のある Batch は pose_fingerprint も要る (schemas/batches.ts の superRefine)。
  const { withPin = true, parameters = { pose: 'lounge' }, patches } = options;
  const poseFingerprint = options.poseFingerprint ?? (patches ? 'sha256:fixture' : undefined);
  const { batch, generation } = await createGeneration({
    batchOverrides: {
      recipe,
      parameters,
      ...(patches ? { patches } : {}),
      ...(poseFingerprint ? { pose_fingerprint: poseFingerprint } : {}),
    },
  });

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

/**
 * Builds a derivation source whose Batch `parameters.pose` ("lounge", simulating the
 * worker-resolved `recipe_pose`) deliberately differs from the pin it recorded
 * ("lounge-relaxed", simulating a promoted preset name) — so a test can tell whether
 * `derive_request` copied the Batch value or the pin's name.
 */
async function setupPinnedDerivationSource(recipe: string, patches: unknown[]) {
  const { batch, generation } = await createGeneration({
    batchOverrides: { recipe, parameters: { pose: 'lounge' }, patches, pose_fingerprint: 'sha256:fixture' },
  });

  const genReq = await createGenerateRequest(recipe, {
    payload: {
      schema_version: 1,
      request: { instruction: 'test run', count: 1 },
      generation: { recipe, parameters: { pose: 'lounge-relaxed' } },
    },
  });
  expect(genReq.status).toBe(201);

  const claimed = await claim(`worker-${crypto.randomUUID()}`);
  expect(claimed.status).toBe(200);

  const done = await postJson(
    `/api/v1/requests/${genReq.body.id}`,
    { status: 'done', worker_id: claimed.body!.worker_id, result: { batch_id: batch.id, generation_ids: [generation.id] } },
    'PATCH',
  );
  expect(done.status).toBe(200);

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

  it('keeps an explicit pin at the version it names rather than re-resolving it from parameters', async () => {
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

  it('fills in a kind the explicit pin leaves out instead of skipping resolution wholesale', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    // import は pose しか取り込まないので、pin されない kind を作るために直接入れる。
    await env.DB.prepare(
      `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at)
       VALUES (?, ?, 'expression', 'smile', 1, ?, 'active', 'import', NULL, NULL, 'system', ?)`,
    )
      .bind(crypto.randomUUID(), recipe, JSON.stringify({ recipe_pose: 'smile' }), new Date().toISOString())
      .run();

    const res = await postJson<{ payload: { generation?: { presets?: { kind: string; name: string; version: number }[] } } }>(
      '/api/v1/requests',
      {
        kind: 'generate',
        payload: {
          schema_version: 1,
          request: { instruction: 'partial pin', count: 1 },
          generation: {
            recipe,
            parameters: { pose: 'lounge', expression: 'smile' },
            presets: [{ kind: 'pose', name: 'lounge', version: 1 }],
          },
          semantic: { summary: 'partial pin' },
        },
        created_by: 'brain',
        idempotency_key: crypto.randomUUID(),
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.payload.generation?.presets).toEqual([
      { kind: 'pose', name: 'lounge', version: 1 },
      { kind: 'expression', name: 'smile', version: 1 },
    ]);
  });

  it('400s creating a Batch that carries patches without a pose_fingerprint', async () => {
    const res = await postJson('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      recipe: 'yukari',
      patches: [{ target: 'pose', op: 'append', reason: 'no fingerprint', value: 'x' }],
    });
    expect(res.status).toBe(400);
  });

  it('400s when an explicit generation.presets pin does not match parameters for that kind', async () => {
    const recipe = uniqueRecipe();
    await publishAndImportTwoPoses(recipe);

    const res = await postJson('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'test', count: 1 },
        generation: { recipe, parameters: { pose: 'lounge' }, presets: [{ kind: 'pose', name: 'lounge-relaxed', version: 1 }] },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(400);
  });

  it('200s when an explicit generation.presets pin matches parameters for that kind', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const res = await postJson('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'test', count: 1 },
        generation: { recipe, parameters: { pose: 'lounge' }, presets: [{ kind: 'pose', name: 'lounge', version: 1 }] },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(201);
  });

  it('200s when parameters omits the kind an explicit pin names', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const res = await postJson('/api/v1/requests', {
      kind: 'generate',
      payload: {
        schema_version: 1,
        request: { instruction: 'test', count: 1 },
        generation: { recipe, parameters: {}, presets: [{ kind: 'pose', name: 'lounge', version: 1 }] },
      },
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(res.status).toBe(201);
  });

  it('done: does not 404 when a pin is present but result.batch_id does not resolve (skips writing preset_versions_json)', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const genReq = await createGenerateRequest(recipe);
    expect(genReq.status).toBe(201);
    expect(genReq.body.payload.generation?.presets).toEqual([{ kind: 'pose', name: 'lounge', version: 1 }]);

    const claimed = await claim(`worker-${crypto.randomUUID()}`);
    expect(claimed.status).toBe(200);

    const done = await postJson<RequestBody>(
      `/api/v1/requests/${genReq.body.id}`,
      { status: 'done', worker_id: claimed.body!.worker_id, result: { batch_id: 'does-not-exist', generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('done');
  });
});

describe('MCP derive_request (preset pin inheritance)', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
  });

  it("carries the source Batch's pin into generation.presets, setting parameters.pose to the pin name (not the Batch's own recorded value)", async () => {
    const recipe = uniqueRecipe();
    await publishAndImportTwoPoses(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    const { generation } = await setupPinnedDerivationSource(recipe, patches);

    const call = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      semantic: { summary: 'variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation).toEqual({
      recipe,
      parameters: { pose: 'lounge-relaxed' },
      patches,
      presets: [{ kind: 'pose', name: 'lounge-relaxed', version: 1 }],
    });
  });

  it('drops the pin (and its generation.presets entry) when the caller overrides that kind in parameters', async () => {
    const recipe = uniqueRecipe();
    await publishAndImportTwoPoses(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'x', value: 'y' }];
    const { generation } = await setupPinnedDerivationSource(recipe, patches);

    const call = await mcpToolCall<{ payload: { generation: Record<string, unknown> } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      count: 1,
      parameters: { pose: 'lounge' },
      semantic: { summary: 'variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation.parameters).toEqual({ pose: 'lounge' });
    expect(call.data?.payload.generation).not.toHaveProperty('presets');
  });
});

describe('POST /api/v1/presets/promote', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
  });

  it('promotes a rating=good Generation to version 2, body {base, patches}; GET resolves the root record + patches', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);

    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    const { generation } = await setupGeneration(recipe, { patches });
    await setRatingGood(generation.id);

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
    expect(res.body.record).toEqual({ recipe_pose: 'lounge' });
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

  it('409s when the Batch has no patches', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);

    const res = await postJson('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
  });

  it('records base_fingerprint from the Batch pose_fingerprint', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    const { generation } = await setupGeneration(recipe, { patches, poseFingerprint: 'sha256:deadbeef' });
    await setRatingGood(generation.id);

    const res = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.base_fingerprint).toBe('sha256:deadbeef');
  });

  it('an explicit base_version works even without a pin', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    const { generation } = await setupGeneration(recipe, { withPin: false, parameters: { pose: 'lounge' }, patches });
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
    expect(res.body.record).toEqual({ recipe_pose: 'lounge' });
  });

  it('idempotency_key replay returns the already-created version instead of creating a new one', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    const { generation } = await setupGeneration(recipe, { patches });
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

  it('409s reusing an idempotency_key for a different promotion instead of returning the old version', async () => {
    const recipe = uniqueRecipe();
    await publishAndImportTwoPoses(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'promote v2', value: 'a bit more relaxed' }];
    const { generation } = await setupGeneration(recipe, { patches });
    await setRatingGood(generation.id);

    const idempotencyKey = crypto.randomUUID();
    const first = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: idempotencyKey,
    });
    expect(first.status).toBe(200);

    const reused = await postJson('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge-relaxed',
      kind: 'pose',
      idempotency_key: idempotencyKey,
    });
    expect(reused.status).toBe(409);
  });

  it('ignores semantic.attributes.patches: the Batch patches_json is what gets promoted', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const batchPatches = [{ target: 'pose', op: 'append', reason: 'from batch', value: 'a bit more relaxed' }];
    const { generation } = await setupGeneration(recipe, { patches: batchPatches });
    await setRatingGood(generation.id);
    await setPatches(generation.id, [{ target: 'pose', op: 'append', reason: 'from semantic (should be ignored)', value: 'ignored' }]);

    const res = await postJson<PresetView>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge',
      kind: 'pose',
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.patches).toEqual(batchPatches);
  });
});

describe('MCP promote_to_pose', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
  });

  it('creates the same version REST would, verified through GET /api/v1/presets/{recipe}/{kind}/{name}/{version}', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'mcp promote', value: 'holding a drink' }];
    const { generation } = await setupGeneration(recipe, { patches });
    await setRatingGood(generation.id);

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
