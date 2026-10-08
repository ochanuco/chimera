import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { styleCheckIdempotencyKey } from '../src/lib/style-check';
import { createGeneration, getJson, mcpToolCall, postJson, req, clearRequests } from './helpers';

// STYLE_CHECK_RECIPE/POSES (src/lib/style-check.ts) hardcode 'yukari', and defaultRecipeRef
// falls back to 'production' when REQUESTS_DEFAULT_RECIPE_REF is unset — so both are fixed
// here rather than uniqued per test like other suites do.
const RECIPE = 'yukari';
const RECIPE_REF = 'production';

function sampleCatalog(gitCommit: string, bustPrompt = 'bust up, looking at camera', delivery: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: RECIPE,
        ...delivery,
        poses: [
          { name: 'bust', prompt: bustPrompt },
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

async function publishAndImport(gitCommit: string, bustPrompt?: string, delivery?: Record<string, unknown>): Promise<void> {
  const put = await postJson(`/api/v1/catalogs/${RECIPE_REF}`, sampleCatalog(gitCommit, bustPrompt, delivery), 'PUT');
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
  const { generation } = await createGeneration({ requestOverrides: { recipe: RECIPE, parameters: { pose } } });
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
    await clearRequests();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  it('enqueues one plain-render request per pinned pose at the default key; a second POST with the same render content replays (created: false)', async () => {
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
    expect(requestRow.body.idempotency_key).toMatch(new RegExp(`^style-check:${RECIPE}:bust:[0-9a-f]{64}$`));
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

async function styleCheckKeys(): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT idempotency_key FROM requests WHERE idempotency_key LIKE 'style-check:%'").all<{
    idempotency_key: string;
  }>();
  const keys: Record<string, string> = {};
  for (const r of results) keys[r.idempotency_key.split(':')[2]!] = r.idempotency_key;
  return keys;
}

describe('style-check content key', () => {
  beforeEach(async () => {
    await clearRequests();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  async function keyFor(pose: string, seed: number): Promise<string> {
    return styleCheckIdempotencyKey(env.DB, RECIPE_REF, RECIPE, pose, seed);
  }

  it('stays the same across a catalog commit change and changes when the pose prompt changes', async () => {
    await publishAndImport('aaa1111');
    const before = await keyFor('bust', 123);
    const beforeCoffee = await keyFor('coffee', 123);

    await publishAndImport('bbb2222');
    expect(await keyFor('bust', 123)).toBe(before);

    await publishAndImport('ccc3333', 'bust up, smiling');
    expect(await keyFor('bust', 123)).not.toBe(before);
    expect(await keyFor('coffee', 123)).toBe(beforeCoffee);
    expect(await keyFor('bust', 124)).not.toBe(await keyFor('bust', 123));
  });

  it('stays the same when only the deliver / redraw / dials / legacy finalize sections change', async () => {
    await publishAndImport('aaa1111');
    const before = await keyFor('bust', 123);

    await publishAndImport('aaa1111', undefined, {
      deliver: { defaults: { repin: true }, backdrop_color: '#c7e5e9' },
      redraw: { defaults: { canvas: { denoise: 0.4 } } },
      dials: { deliver: { keep_legwear: { on: 0.62 } } },
      finalize: { defaults: { repin: false } },
    });
    expect(await keyFor('bust', 123)).toBe(before);
  });
});

describe('catalog PUT auto render', () => {
  beforeEach(async () => {
    await clearRequests();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  it('enqueues only the poses whose render content changed, and an identical PUT creates nothing', async () => {
    await publishAndImport('aaa1111');
    await pinPose('bust');
    await pinPose('coffee');

    const put = (commit: string, bustPrompt?: string) => postJson(`/api/v1/catalogs/${RECIPE_REF}`, sampleCatalog(commit, bustPrompt), 'PUT');
    const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE idempotency_key LIKE 'style-check:%'").first<{ n: number }>())!.n;

    expect((await put('aaa1111')).status).toBe(200);
    await vi.waitFor(async () => expect(await count()).toBe(2));

    expect((await put('bbb2222')).status).toBe(200);
    expect((await put('bbb2222')).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await count()).toBe(2);
    const keys = await styleCheckKeys();

    expect((await put('ccc3333', 'bust up, smiling')).status).toBe(200);
    await vi.waitFor(async () => expect(await count()).toBe(3));
    const after = await styleCheckKeys();
    expect(after.coffee).toBe(keys.coffee);
    expect(after.bust).not.toBe(keys.bust);
  });

  it('does not render for a non-default recipe_ref', async () => {
    await publishAndImport('aaa1111');
    await pinPose('bust');
    await postJson('/api/v1/catalogs/feature-branch', sampleCatalog('zzz9999'), 'PUT');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(Object.keys(await styleCheckKeys())).toEqual([]);
  });
});

describe('GET /check', () => {
  beforeEach(async () => {
    await clearRequests();
    await env.DB.prepare('DELETE FROM preset_references').run();
  });

  /** The poses the page hands its client script. */
  async function checkPoses(query = ''): Promise<{ html: string; poses: { pose: string; pin: { short_id: string } | null; request: { id: string; status: string } | null; result: { short_id: string } | null }[] }> {
    const html = await (await req(`/check${query}`)).text();
    const initial = html.match(/data-initial="([^"]*)"/)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return { html, poses: (JSON.parse(initial) as { poses: never[] }).poses };
  }

  it('hints "pin 無し" for an unpinned pose and "未描画" for a pinned pose with no render yet, then the queued status once one is enqueued', async () => {
    await publishAndImport('def5678');
    const bust = await pinPose('bust');

    const before = await req('/check');
    expect(before.status).toBe(200);
    const { html, poses } = await checkPoses();
    expect(poses.find((p) => p.pose === 'bust')).toMatchObject({ pin: { short_id: bust.shortId }, request: null, result: null });
    expect(poses.find((p) => p.pose === 'coffee')!.pin).toBeNull();
    expect(html).toContain('>未描画</span>');
    expect(html).toContain('>pin 無し</span>');

    const render = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    const bustResult = render.body.results.find((r) => r.pose === 'bust');
    expect(bustResult!.created).toBe(true);

    const after = await checkPoses();
    expect(after.poses.find((p) => p.pose === 'bust')!.request).toMatchObject({ id: bustResult!.request_id, status: 'queued' });
    expect(after.html).toContain('>queued</span>');
  });

  it('keeps showing the existing render after a catalog commit change with the same pose content, with the pose picker and the any-ID form', async () => {
    await publishAndImport('aaa1111');
    await pinPose('bust');
    const render = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    const bustResult = render.body.results.find((r) => r.pose === 'bust')!;

    await publishAndImport('bbb2222');
    const { html, poses } = await checkPoses();
    expect(poses.find((p) => p.pose === 'bust')!.request!.id).toBe(bustResult.request_id);
    expect(html).toContain('data-sc-pose="bust"');
    expect(html).toContain('data-sc-any-id');
    expect(html).toContain('pin を差し替える');
    expect(html).toContain('今の既定で描く');
  });

  it('hands the resulting generation to the page once the plain-render request is done', async () => {
    await publishAndImport('feed001');
    const bust = await pinPose('bust');

    const render = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, {});
    const bustResult = render.body.results.find((r) => r.pose === 'bust')!;

    const claimed = await claim(`worker-${crypto.randomUUID()}`);
    expect(claimed.status).toBe(200);
    expect(claimed.body!.id).toBe(bustResult.request_id);

    const resultGen = await createGeneration({ requestOverrides: { recipe: RECIPE, parameters: { pose: 'bust' } } });
    const doneRes = await postJson(
      `/api/v1/requests/${bustResult.request_id}`,
      {
        status: 'done',
        worker_id: claimed.body!.worker_id,
        result: { generation_ids: [resultGen.generation.id] },
      },
      'PATCH',
    );
    expect(doneRes.status).toBe(200);

    const { poses } = await checkPoses('?pose=bust');
    const bustPose = poses.find((p) => p.pose === 'bust')!;
    expect(bustPose.pin!.short_id).toBe(bust.shortId);
    expect(bustPose.result!.short_id).toBe(resultGen.generation.short_id);
    expect(bustPose.request!.status).toBe('done');
  });
});
