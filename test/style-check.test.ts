import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall, postJson, req } from './helpers';

// STYLE_CHECK_RECIPE / STYLE_CHECK_POSES (src/lib/style-check.ts) hardcode 'yukari', and
// defaultRecipeRef (src/lib/requests.ts) falls back to 'production' when
// REQUESTS_DEFAULT_RECIPE_REF is unset (as in this test env) — so both are fixed here rather
// than uniqued per test like other suites do.
const RECIPE = 'yukari';
const RECIPE_REF = 'production';

function sampleCatalog(gitCommit: string) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: RECIPE,
        poses: [
          { name: 'bust', prompt: 'bust up, looking at camera' },
          { name: 'coffee', prompt: 'holding cup, cowboy shot' },
        ],
        costumes: [{ name: 'default', prompt: 'plain roomwear' }],
      },
    ],
    patches: {},
    git_commit: gitCommit,
    git_branch: 'main',
    generated_at: '2026-09-24T00:00:00.000Z',
  };
}

async function publishAndImport(gitCommit: string): Promise<void> {
  const put = await postJson(`/api/v1/catalogs/${RECIPE_REF}`, sampleCatalog(gitCommit), 'PUT');
  expect(put.status).toBe(200);
  const imported = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: RECIPE_REF });
  expect(imported.status).toBe(200);
}

interface RequestBody {
  id: string;
  status: string;
  worker_id: string | null;
  idempotency_key: string;
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

/** Builds a raw rating=good Generation for `pose` and pins it (set_pose_reference). */
async function pinPose(pose: string): Promise<{ generationId: string; shortId: string }> {
  const { generation } = await createGeneration({ batchOverrides: { recipe: RECIPE, parameters: { pose } } });
  await setRatingGood(generation.id);
  const pin = await mcpToolCall<{ reference: { short_id: string } }>('set_pose_reference', {
    recipe: RECIPE,
    pose,
    generation_id: generation.id,
    idempotency_key: crypto.randomUUID(),
  });
  expect(pin.isError).toBe(false);
  return { generationId: generation.id, shortId: generation.short_id };
}

interface StyleCheckPostItem {
  framing: string;
  pose: string;
  skipped: string | null;
  created: boolean | null;
  request_id: string | null;
  status: string | null;
}

describe('POST /api/v1/style-check/:recipe', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  it('enqueues one plain-render request per pinned pose at the default key; a second POST at the same catalog commit replays (created: false)', async () => {
    await publishAndImport('abc1234');
    await pinPose('bust');

    const first = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    expect(first.status).toBe(200);
    const bustResult = first.body.results.find((r) => r.pose === 'bust');
    expect(bustResult).toBeTruthy();
    expect(bustResult!.created).toBe(true);
    expect(bustResult!.status).toBe('queued');
    expect(bustResult!.request_id).toBeTruthy();

    const requestRow = await getJson<{ idempotency_key: string; payload: { generation: { parameters: unknown } } }>(
      `/api/v1/requests/${bustResult!.request_id}`,
    );
    expect(requestRow.body.idempotency_key).toBe(`plain:${RECIPE}:bust:123:abc1234`);
    expect(requestRow.body.payload.generation.parameters).toEqual({ pose: 'bust' });

    const second = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    const bustReplay = second.body.results.find((r) => r.pose === 'bust');
    expect(bustReplay!.created).toBe(false);
    expect(bustReplay!.request_id).toBe(bustResult!.request_id);
  });

  it('skips a pose with no pin and reports it', async () => {
    await publishAndImport('abc1234');

    const res = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    expect(res.status).toBe(200);
    const coffee = res.body.results.find((r) => r.pose === 'coffee');
    expect(coffee).toBeTruthy();
    expect(coffee!.skipped).toBe('no_pin');
    expect(coffee!.request_id).toBeNull();
  });
});

describe('GET /check', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM requests').run();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  it('shows "pin 無し" for an unpinned pose, "まだ描いていない" for a pinned pose with no render yet, and the pin + queued status once one is enqueued', async () => {
    await publishAndImport('def5678');
    const bust = await pinPose('bust');

    const before = await req('/check');
    expect(before.status).toBe(200);
    const beforeBody = await before.text();
    expect(beforeBody).toContain(bust.shortId);
    expect(beforeBody).toContain('まだ描いていない');
    expect(beforeBody).toContain('pin 無し'); // coffee has no pin

    const render = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    const bustResult = render.body.results.find((r) => r.pose === 'bust');
    expect(bustResult!.created).toBe(true);

    const after = await req('/check');
    const afterBody = await after.text();
    expect(afterBody).toContain(`data-request-id="${bustResult!.request_id}"`);
    expect(afterBody).toContain('request-status-queued');
  });

  it('shows the resulting generation and a compare link once the plain-render request is done', async () => {
    await publishAndImport('feed001');
    const bust = await pinPose('bust');

    const render = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    const bustResult = render.body.results.find((r) => r.pose === 'bust')!;

    const claimed = await claim(`worker-${crypto.randomUUID()}`);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(bustResult.request_id);

    const resultGen = await createGeneration({ batchOverrides: { recipe: RECIPE, parameters: { pose: 'bust' } } });
    const doneRes = await postJson(
      `/api/v1/requests/${bustResult.request_id}`,
      {
        status: 'done',
        worker_id: claimed.body!.worker_id,
        result: { batch_id: resultGen.batch.id, generation_ids: [resultGen.generation.id] },
      },
      'PATCH',
    );
    expect(doneRes.status).toBe(200);

    const page = await req('/check');
    const body = await page.text();
    expect(body).toContain(resultGen.generation.short_id);
    expect(body).toContain(`/compare?ids=${bust.shortId},${resultGen.generation.short_id}`);
  });
});
