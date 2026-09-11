import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBatch, createGeneration, createJob, getJson, ingestGeneration, mcpToolCall, postJson, req } from './helpers';

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

// presets は recipe_ref ではなく (recipe, kind, name, version) で一意なので、recipe
// 名自体をテストごとにユニークにする (test/preset-promote.test.ts と同じ理由)。
function uniqueRecipe(): string {
  return `yukari-${crypto.randomUUID()}`;
}

function sampleCatalog(recipe: string) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag, warm light', costume: 'default' }],
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

/** Same shape as sampleCatalog, but with two importable poses — needed for the pose-mismatch case. */
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

async function publishAndImport(recipe: string): Promise<string> {
  const recipeRef = uniqueRecipeRef();
  await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(recipe), 'PUT');
  const res = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: recipeRef });
  expect(res.status).toBe(200);
  return recipeRef;
}

/**
 * Preset import only ever covers `kind = 'pose'` (lib/presets.ts importFromCatalog); costume/
 * expression presets, when they exist at all, are inserted directly. plain_render's payload
 * names `parameters.costume` from the catalog pose record, and createRequest's pinPresets
 * requires that name to resolve once the recipe has any Preset row — so the plain_render tests
 * need this row for pinning to succeed at all.
 */
async function importCostumePreset(recipe: string, name = 'default'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at)
     VALUES (?, ?, 'costume', ?, 1, ?, 'active', 'import', NULL, NULL, 'system', ?)`,
  )
    .bind(crypto.randomUUID(), recipe, name, JSON.stringify({ recipe_pose: name }), new Date().toISOString())
    .run();
}

async function publishAndImportTwoPoses(recipe: string): Promise<string> {
  const recipeRef = uniqueRecipeRef();
  await postJson(`/api/v1/catalogs/${recipeRef}`, twoPoseCatalog(recipe), 'PUT');
  const res = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: recipeRef });
  expect(res.status).toBe(200);
  return recipeRef;
}

interface RequestBody {
  id: string;
  status: string;
  payload: { generation?: Record<string, unknown> } & Record<string, unknown>;
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

async function setRatingGood(generationId: string): Promise<void> {
  const res = await postJson(`/api/v1/generations/${generationId}/rating`, { rating: 'good' }, 'PUT');
  expect(res.status).toBe(200);
}

/**
 * Builds a raw (non-refinement) Batch + Generation for `recipe`, and — unless `withPin` is
 * false — a matching kind=generate request that pins `parameters.pose` (the pin
 * set_pose_reference later reads to confirm the resolved Batch drew this pose). Marks the
 * request `done` against the created Batch so its `json_extract(result_json, '$.batch_id')`
 * lookup finds it. `patches`, when given, land on the Batch row itself (`patches_json` /
 * `pose_fingerprint`). `generationPayload`, when given, is merged into the pinning request's
 * `payload.generation` (used to simulate a prompt override).
 */
async function setupGeneration(
  recipe: string,
  options: {
    withPin?: boolean;
    parameters?: Record<string, unknown>;
    patches?: unknown[];
    generationPayload?: Record<string, unknown>;
  } = {},
) {
  const { withPin = true, parameters = { pose: 'lounge' }, patches, generationPayload } = options;
  const poseFingerprint = patches ? 'sha256:fixture' : undefined;
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
        generation: { recipe, parameters, ...generationPayload },
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
 * Builds a refinement Batch (the shape finalize/repair leave behind): a Batch whose generation
 * is wired back to `source` via `batch_relations` (type=refinement) and `batch_references`
 * (purpose=rebuild) — the two tables resolveDerivationSource (lib/requests.ts) walks. Modeled on
 * test/mcp-agent-loop.test.ts's createRefinementBatch. Uses a different seed than `source` so a
 * test can tell whether set_pose_reference read the source's seed rather than this one's.
 */
async function createRefinementBatch(source: { batch: { id: string }; generation: { id: string } }) {
  const refinementBatch = await createBatch({
    parameters: { kind: 'hires-chain', base_generation: source.generation.id, size: 2560 },
  });
  const job = await createJob(refinementBatch.body.id, { seed: 999 });
  const ingest = await ingestGeneration(job.body.id, {
    seed: 999,
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

interface ReferenceView {
  generation_id: string;
  short_id: string;
  seed: number;
}

interface SetPoseReferenceResult {
  created: boolean;
  recipe: string;
  kind: string;
  name: string;
  reference: ReferenceView;
  source: { generation_id: string; short_id: string };
  superseded: ReferenceView | null;
}

describe('MCP set_pose_reference', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  it('pins a raw rating=good generation and surfaces it on list_presets / get_preset / get_catalog_pose', async () => {
    const recipe = uniqueRecipe();
    const recipeRef = await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);

    const call = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.reference.generation_id).toBe(generation.id);
    expect(call.data?.reference.seed).toBe(123); // createJob's default seed (test/helpers.ts)
    expect(call.data?.source.short_id).toBe(generation.short_id);
    expect(call.data?.superseded).toBeNull();

    const listed = await mcpToolCall<{ items: { name: string; reference: ReferenceView | null }[] }>('list_presets', { recipe });
    expect(listed.isError).toBe(false);
    const lounge = listed.data?.items.find((i) => i.name === 'lounge');
    expect(lounge?.reference?.generation_id).toBe(generation.id);

    const got = await mcpToolCall<{ reference: ReferenceView | null }>('get_preset', { recipe, kind: 'pose', name: 'lounge' });
    expect(got.isError).toBe(false);
    expect(got.data?.reference?.generation_id).toBe(generation.id);

    const catalogPose = await mcpToolCall<{ reference: ReferenceView | null }>('get_catalog_pose', {
      recipe,
      pose: 'lounge',
      recipe_ref: recipeRef,
    });
    expect(catalogPose.isError).toBe(false);
    expect(catalogPose.data?.reference?.generation_id).toBe(generation.id);

    // A pose with no pin shows null.
    await env.DB.prepare(
      `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at)
       VALUES (?, ?, 'pose', 'unpinned', 1, ?, 'active', 'import', NULL, NULL, 'system', ?)`,
    )
      .bind(crypto.randomUUID(), recipe, JSON.stringify({ recipe_pose: 'unpinned' }), new Date().toISOString())
      .run();
    const unpinned = await mcpToolCall<{ reference: ReferenceView | null }>('get_preset', { recipe, kind: 'pose', name: 'unpinned' });
    expect(unpinned.data?.reference).toBeNull();
  });

  it('409s when rating is not good', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe);

    const call = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('requires rating good');
  });

  it('409s when the resolved batch carries patches', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const patches = [{ target: 'pose', op: 'append', reason: 'x', value: 'y' }];
    const { generation } = await setupGeneration(recipe, { patches });
    await setRatingGood(generation.id);

    const call = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('patches');
  });

  it('409s when the resolved batch drew a different pose', async () => {
    const recipe = uniqueRecipe();
    await publishAndImportTwoPoses(recipe);
    const { generation } = await setupGeneration(recipe, { parameters: { pose: 'lounge' } });
    await setRatingGood(generation.id);

    const call = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge-relaxed',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain("pose is 'lounge'");
  });

  it('409s when the queued generate request overrode the prompt', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(recipe, { generationPayload: { prompt: 'a hand-written override' } });
    await setRatingGood(generation.id);

    const call = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('overrides the prompt');
  });

  it('409s when the resolved batch belongs to a different recipe', async () => {
    const recipe = uniqueRecipe();
    const otherRecipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await setupGeneration(otherRecipe, { withPin: false });
    await setRatingGood(generation.id);

    const call = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain(`recipe is '${otherRecipe}'`);
  });

  it('404s (not found) for a pose with no Preset yet', async () => {
    const recipe = uniqueRecipe();
    const { generation } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });
    await setRatingGood(generation.id);

    const call = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('not found');
  });

  it('resolves a finalize/repair-style refinement output back to the raw generation and its seed', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { batch, generation: rawGeneration } = await setupGeneration(recipe);
    const refined = await createRefinementBatch({ batch, generation: rawGeneration });
    await setRatingGood(refined.generation.id);

    const call = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: refined.generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.source.generation_id).toBe(rawGeneration.id);
    expect(call.data?.reference.seed).toBe(123); // rawGeneration's job seed, not refined's (999)
  });

  it('re-setting supersedes the previous pin, keeping both rows in history', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation: first } = await setupGeneration(recipe);
    await setRatingGood(first.id);
    const { generation: second } = await setupGeneration(recipe);
    await setRatingGood(second.id);

    const firstCall = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: first.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(firstCall.isError).toBe(false);

    const secondCall = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: second.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(secondCall.isError).toBe(false);
    expect(secondCall.data?.created).toBe(true);
    expect(secondCall.data?.reference.generation_id).toBe(second.id);
    expect(secondCall.data?.superseded?.generation_id).toBe(first.id);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM preset_references WHERE recipe = ? AND kind = ? AND name = ?')
      .bind(recipe, 'pose', 'lounge')
      .first<{ n: number }>();
    expect(count?.n).toBe(2);

    const current = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM preset_references WHERE recipe = ? AND kind = ? AND name = ? AND superseded_at IS NULL',
    )
      .bind(recipe, 'pose', 'lounge')
      .first<{ n: number }>();
    expect(current?.n).toBe(1);
  });

  it('idempotency_key replay returns the existing pin; reuse with different arguments 409s', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation: first } = await setupGeneration(recipe);
    await setRatingGood(first.id);
    const { generation: second } = await setupGeneration(recipe);
    await setRatingGood(second.id);

    const key = crypto.randomUUID();
    const initial = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: first.id,
      idempotency_key: key,
    });
    expect(initial.isError).toBe(false);
    expect(initial.data?.created).toBe(true);

    const replay = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: first.id,
      idempotency_key: key,
    });
    expect(replay.isError).toBe(false);
    expect(replay.data?.created).toBe(false);
    expect(replay.data?.reference.generation_id).toBe(first.id);

    const reused = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: second.id,
      idempotency_key: key,
    });
    expect(reused.isError).toBe(true);
    expect(reused.text).toContain('idempotency_key already used for a different reference');
  });
});

interface PlainRenderResult {
  created: boolean;
  request: { id: string; idempotency_key: string; payload: Record<string, unknown> };
  payload: { request: { seeds: number[] }; generation: { parameters: Record<string, unknown>; patches?: unknown } };
  seed: number;
  reference: ReferenceView | null;
}

describe('MCP plain_render', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  async function pin(recipe: string, pose: string, generationId: string): Promise<void> {
    const call = await mcpToolCall<SetPoseReferenceResult>('set_pose_reference', {
      recipe,
      pose,
      generation_id: generationId,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
  }

  it('enqueues a generate request at the pinned seed with recipe defaults and no patches; replays on the default key', async () => {
    const recipe = uniqueRecipe();
    const recipeRef = await publishAndImport(recipe);
    await importCostumePreset(recipe);
    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);
    await pin(recipe, 'lounge', generation.id);

    const call = await mcpToolCall<PlainRenderResult>('plain_render', { recipe, pose: 'lounge', recipe_ref: recipeRef });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.seed).toBe(123);
    expect(call.data?.payload.request.seeds).toEqual([123]);
    expect(call.data?.payload.generation.parameters).toEqual({ pose: 'lounge', costume: 'default' });
    expect(call.data?.payload.generation).not.toHaveProperty('patches');
    expect(call.data?.reference?.generation_id).toBe(generation.id);
    expect(call.data?.request.idempotency_key).toBe(`plain:${recipe}:lounge:123:abc1234`);

    const replay = await mcpToolCall<PlainRenderResult>('plain_render', { recipe, pose: 'lounge', recipe_ref: recipeRef });
    expect(replay.isError).toBe(false);
    expect(replay.data?.created).toBe(false);
    expect(replay.data?.request.id).toBe(call.data?.request.id);
  });

  it('an explicit seed overrides the pin', async () => {
    const recipe = uniqueRecipe();
    const recipeRef = await publishAndImport(recipe);
    await importCostumePreset(recipe);
    const { generation } = await setupGeneration(recipe);
    await setRatingGood(generation.id);
    await pin(recipe, 'lounge', generation.id);

    const call = await mcpToolCall<PlainRenderResult>('plain_render', { recipe, pose: 'lounge', recipe_ref: recipeRef, seed: 777 });
    expect(call.isError).toBe(false);
    expect(call.data?.seed).toBe(777);
    expect(call.data?.payload.request.seeds).toEqual([777]);
  });

  it('409s with no pin and no seed', async () => {
    const recipe = uniqueRecipe();
    const recipeRef = await publishAndImport(recipe);

    const call = await mcpToolCall('plain_render', { recipe, pose: 'lounge', recipe_ref: recipeRef });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('no reference pinned');
  });

  it('bootstraps a pose with no pin when an explicit seed is given', async () => {
    const recipe = uniqueRecipe();
    const recipeRef = await publishAndImport(recipe);
    await importCostumePreset(recipe);

    const call = await mcpToolCall<PlainRenderResult>('plain_render', { recipe, pose: 'lounge', recipe_ref: recipeRef, seed: 42 });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.seed).toBe(42);
    expect(call.data?.reference).toBeNull();
  });
});
