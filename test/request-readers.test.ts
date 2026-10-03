// 読む側が Request / Generation の列 (generations.refines_generation_id、request_references、requests の解決済みの値) だけで動くことの検証。
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createRequest, createGeneration, createJob, getJson, ingestGeneration, mcpToolCall, postJson } from './helpers';

function uniqueRecipe(): string {
  return `yukari-${crypto.randomUUID()}`;
}

async function importCatalog(recipe: string): Promise<void> {
  const recipeRef = `test-${crypto.randomUUID()}`;
  const catalog = {
    schema_version: 1,
    recipes: [{ name: recipe, poses: [{ name: 'lounge', prompt: 'reclining' }], costumes: [], expressions: [] }],
    patches: {},
    git_commit: 'abc1234',
    git_branch: 'main',
    generated_at: '2026-10-03T00:00:00.000Z',
  };
  expect((await postJson(`/api/v1/catalogs/${recipeRef}`, catalog, 'PUT')).status).toBe(200);
  expect((await postJson('/api/v1/presets/import', { recipe_ref: recipeRef })).status).toBe(200);
}

async function rateGood(generationId: string): Promise<void> {
  expect((await postJson(`/api/v1/generations/${generationId}/rating`, { rating: 'good' }, 'PUT')).status).toBe(200);
}

/** raw Generation と、それを仕上げ元に持つ Generation (Job の source_generation_id が generations.refines_generation_id に写る)。 */
async function createRefinedPair() {
  const raw = await createGeneration({ requestOverrides: { recipe: 'yukari', parameters: { pose: 'lounge' } } });
  const refined = await createGeneration({
    requestOverrides: { kind: 'finalize', parameters: { kind: 'hires-chain', base_generation: raw.generation.id } },
    jobOverrides: { source_generation_id: raw.generation.id },
  });
  return { raw, refined };
}

describe('readers work from Request and Generation columns', () => {
  it('gallery refines: origin filter, refines_generation_short_id and get_generation.refines_generation', async () => {
    const { raw, refined } = await createRefinedPair();

    const refinedList = await getJson<{ items: { short_id: string; refines_generation_short_id: string | null }[] }>(
      '/api/v1/generations?origin=refined&limit=200',
    );
    const refinedItem = refinedList.body.items.find((i) => i.short_id === refined.generation.short_id);
    expect(refinedItem?.refines_generation_short_id).toBe(raw.generation.short_id);
    expect(refinedList.body.items.some((i) => i.short_id === raw.generation.short_id)).toBe(false);

    const rawList = await getJson<{ items: { short_id: string }[] }>('/api/v1/generations?origin=raw&limit=200');
    expect(rawList.body.items.some((i) => i.short_id === refined.generation.short_id)).toBe(false);
    expect(rawList.body.items.some((i) => i.short_id === raw.generation.short_id)).toBe(true);

    const detail = await getJson<{ refines_generation: { id: string; short_id: string } | null }>(
      `/api/v1/generations/${refined.generation.id}`,
    );
    expect(detail.body.refines_generation).toMatchObject({ id: raw.generation.id, short_id: raw.generation.short_id });
  });

  it('lineage: refinement edge from generations.refines_generation_id and material edge from request_references', async () => {
    const { raw, refined } = await createRefinedPair();
    const material = await createGeneration({
      requestOverrides: { references: [{ source_generation_id: raw.generation.id, purpose: 'composition', aspect: 'pose' }] },
    });

    const fromRefined = await mcpToolCall<{
      ancestors: { via: string; purpose_or_kind: string | null; request: { id: string } }[];
    }>('get_generation_lineage', { generation_id: refined.generation.id });
    expect(fromRefined.isError).toBe(false);
    expect(fromRefined.data?.ancestors).toEqual([
      expect.objectContaining({ via: 'refinement', purpose_or_kind: 'finalize', request: expect.objectContaining({ id: raw.request.id }) }),
    ]);

    const fromRaw = await mcpToolCall<{ descendants: { via: string; purpose_or_kind: string | null; request: { id: string } }[] }>(
      'get_generation_lineage',
      { generation_id: raw.generation.id },
    );
    expect(fromRaw.data?.descendants.map((n) => [n.request.id, n.via, n.purpose_or_kind]).sort()).toEqual(
      [
        [refined.request.id, 'refinement', 'finalize'],
        [material.request.id, 'reference', 'composition'],
      ].sort(),
    );
  });

  it('derive_request resolves a refined Generation back to its raw Request', async () => {
    const { raw, refined } = await createRefinedPair();

    const call = await mcpToolCall<{ payload: { generation: { recipe: string; parameters: unknown } }; derived_from: { source: { id: string } } }>(
      'derive_request',
      {
        from_generation_id: refined.generation.short_id,
        instruction: 'again',
        count: 1,
        semantic: { summary: 'x' },
        idempotency_key: crypto.randomUUID(),
      },
    );
    expect(call.isError).toBe(false);
    expect(call.data?.derived_from.source.id).toBe(raw.generation.id);
    expect(call.data?.payload.generation).toEqual({ recipe: 'yukari', parameters: { pose: 'lounge' } });
  });

  it('promote reads recipe, parameters, patches and pose_fingerprint from the Request', async () => {
    const recipe = uniqueRecipe();
    await importCatalog(recipe);
    const patches = [{ target: 'prompt.positive.face', op: 'append', value: 'smile', reason: 'x' }];
    const { generation } = await createGeneration({
      requestOverrides: { recipe, parameters: { pose: 'lounge' }, patches, pose_fingerprint: 'sha256:request-side' },
    });
    await rateGood(generation.id);

    const res = await postJson<{ version: number; base_fingerprint: string | null; patches: unknown[] }>('/api/v1/presets/promote', {
      generation_id: generation.id,
      name: 'lounge-smile',
      kind: 'pose',
      base_version: 1,
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.base_fingerprint).toBe('sha256:request-side');
    expect(res.body.patches).toEqual(patches);
  });

  it('promote_to_profile and the finalize profile expansion read the Request kind and recipe', async () => {
    const recipe = uniqueRecipe();
    const source = await createGeneration({ requestOverrides: { recipe } });
    const finalize = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'finalize',
      payload: { generation_id: source.generation.id, options: { denoise: 0.6 } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(finalize.status).toBe(201);
    const delivered = await createGeneration({
      requestId: finalize.body.id,
      requestOverrides: { recipe },
      jobOverrides: { source_generation_id: source.generation.id },
    });
    await rateGood(delivered.generation.id);

    const promoted = await postJson<{ name: string; version: number }>('/api/v1/presets/promote-profile', {
      generation_id: delivered.generation.id,
      name: 'daily',
      idempotency_key: crypto.randomUUID(),
    });
    expect(promoted.status).toBe(200);

    const profiled = await postJson<{ payload: { options: Record<string, unknown>; profile: { name: string; version: number } } }>(
      '/api/v1/requests',
      {
        kind: 'finalize',
        payload: { generation_id: source.generation.id, profile: { name: 'daily' } },
        idempotency_key: crypto.randomUUID(),
        created_by: 'gui',
      },
    );
    expect(profiled.status).toBe(201);
    expect(profiled.body.payload.options).toMatchObject({ denoise: 0.6 });
    expect(profiled.body.payload.profile).toEqual({ name: 'daily', version: 1 });
  });

  it('set_pose_reference checks recipe, pose and patches on the Request', async () => {
    const recipe = uniqueRecipe();
    await importCatalog(recipe);
    const plain = await createGeneration({ requestOverrides: { recipe, parameters: { pose: 'lounge' } } });
    const patched = await createGeneration({
      requestOverrides: {
        recipe,
        parameters: { pose: 'lounge' },
        patches: [{ target: 'prompt.positive.face', op: 'append', value: 'smile', reason: 'x' }],
        pose_fingerprint: 'sha256:fixture',
      },
    });
    await rateGood(plain.generation.id);
    await rateGood(patched.generation.id);

    const rejected = await mcpToolCall('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: patched.generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain('request carries 1 patches');

    const pinned = await mcpToolCall<{ reference: { generation_id: string } }>('set_pose_reference', {
      recipe,
      pose: 'lounge',
      generation_id: plain.generation.id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(pinned.isError).toBe(false);
    expect(pinned.data?.reference.generation_id).toBe(plain.generation.id);
  });

  it('A/B judgments resolve a Run through requests.run_id', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: `ab-${crypto.randomUUID().slice(0, 8)}` });
    const baselineRun = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
    const armRun = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});

    const makeSide = async (runId: string) => {
      const request = await createRequest();
      const job = await createJob(request.body.id, { seed: 11 });
      const generation = await ingestGeneration(job.body.id, { seed: 11, original_filename: `${runId}.png`, comfy_output_index: 0 });
      await env.DB.prepare('UPDATE requests SET run_id = ? WHERE id = ?').bind(runId, request.body.id).run();
      return { requestId: request.body.id, generation: generation.body };
    };
    const baseline = await makeSide(baselineRun.body.id);
    const arm = await makeSide(armRun.body.id);

    const judged = await postJson<{ winner: string }>(`/api/v1/experiments/${experiment.body.id}/judgments`, {
      baseline_run_id: baselineRun.body.id,
      arm_run_id: armRun.body.id,
      seed: 11,
      left_generation_id: baseline.generation.id,
      right_generation_id: arm.generation.id,
      verdict: 'right',
    });
    expect(judged.status).toBe(201);
    expect(judged.body.winner).toBe('arm');

    const summary = await getJson<{
      pairs: { win: number; total: number }[];
      runs: { run_id: string; request_id: string | null; generation_count: number }[];
    }>(`/api/v1/experiments/${experiment.body.id}/judgments/summary`);
    expect(summary.body.pairs[0]).toMatchObject({ win: 1, total: 1 });
    expect(summary.body.runs.find((r) => r.run_id === armRun.body.id)).toMatchObject({
      request_id: arm.requestId,
      generation_count: 1,
    });

    const run = await mcpToolCall<{ request: { id: string } | null; generations: { id: string }[] }>('get_run', {
      run_id: armRun.body.id,
    });
    expect(run.data?.request?.id).toBe(arm.requestId);
    expect(run.data?.generations.map((g) => g.id)).toEqual([arm.generation.id]);
  });
});

describe('requests', () => {
  it('serializes short_id and filters by kind=import', async () => {
    const { request } = await createGeneration();
    const one = await getJson<{ id: string; short_id: string | null }>(`/api/v1/requests/${request.id}`);
    expect(one.body.short_id).toBe(request.short_id);

    await env.DB.prepare("UPDATE requests SET kind = 'import' WHERE id = ?").bind(request.id).run();
    const imports = await getJson<{ items: { id: string; kind: string }[] }>('/api/v1/requests?kind=import&limit=200');
    expect(imports.status).toBe(200);
    expect(imports.body.items.map((i) => i.id)).toContain(request.id);
    const viaMcp = await mcpToolCall<{ items: { id: string }[] }>('list_requests', { kind: 'import' });
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.data?.items.map((i) => i.id)).toContain(request.id);
  });

  it('accepts done for a Run-linked generate request without result.batch_id', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', {
      name: `done-${crypto.randomUUID().slice(0, 8)}`,
      base_recipe: 'yukari',
      base_parameters: { pose: 'lounge' },
    });
    const run = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {});
    const queued = await getJson<{ items: { id: string; run_id: string | null }[] }>(`/api/v1/requests?run_id=${run.body.id}`);
    const requestId = queued.body.items[0]!.id;
    await env.DB.prepare("UPDATE requests SET status = 'cancelled' WHERE status = 'queued' AND id != ?").bind(requestId).run();
    const claimed = await postJson<{ id: string; worker_id: string }>('/api/v1/requests/claim', { worker_id: 'worker-nobatch' });
    expect(claimed.body.id).toBe(requestId);

    const generation = await createGeneration();
    const done = await postJson<{ status: string }>(
      `/api/v1/requests/${requestId}`,
      { status: 'done', worker_id: 'worker-nobatch', result: { generation_ids: [generation.generation.id] } },
      'PATCH',
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('done');
  });
});
