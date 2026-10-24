import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { styleCheckIdempotencyKey } from '../src/lib/style-check';
import { getCatalog } from '../src/lib/catalogs';
import { createGeneration, getJson, mcpToolCall, postJson, req, clearRequests } from './helpers';

// STYLE_CHECK_RECIPE (src/lib/style-check.ts) hardcodes 'yukari', and defaultRecipeRef
// falls back to 'production' when REQUESTS_DEFAULT_RECIPE_REF is unset — so both are fixed
// here rather than uniqued per test like other suites do.
const RECIPE = 'yukari';
const RECIPE_REF = 'production';

function sampleCatalog(
  gitCommit: string,
  bustPrompt = 'bust up, looking at camera',
  delivery: Record<string, unknown> = {},
  bustExtra: Record<string, unknown> = {},
  extraPoses: string[] = [],
) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: RECIPE,
        model: 'model-a',
        ...delivery,
        poses: [
          { name: 'bust', prompt: bustPrompt, positive: bustPrompt, ...bustExtra },
          { name: 'coffee', prompt: 'holding cup, cowboy shot' },
          ...extraPoses.map((name) => ({ name, prompt: `${name} pose` })),
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

async function publishAndImport(
  gitCommit: string,
  bustPrompt?: string,
  delivery?: Record<string, unknown>,
  bustExtra?: Record<string, unknown>,
  extraPoses?: string[],
): Promise<void> {
  const put = await postJson(`/api/v1/catalogs/${RECIPE_REF}`, sampleCatalog(gitCommit, bustPrompt, delivery, bustExtra, extraPoses), 'PUT');
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

  it('renders only the named pose when the body carries one', async () => {
    await publishAndImport('abc1234');
    await pinPose('bust');
    await pinPose('coffee');

    const res = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, { pose: 'coffee' });
    expect(res.body.results.map((r) => r.pose)).toEqual(['coffee']);
    expect(res.body.results[0]!.created).toBe(true);
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
    return styleCheckIdempotencyKey(env.DB, await getCatalog(env.DB, RECIPE_REF), RECIPE, pose, seed);
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

  it('stays the same when only parameters, vocab lists or pose metadata change', async () => {
    await publishAndImport('aaa1111');
    const before = await keyFor('bust', 123);

    await publishAndImport(
      'aaa1111',
      undefined,
      {
        parameters: { allowed: ['angle', 'framing'] },
        angles: ['front', 'side'],
        framings: ['bust', 'cowboy'],
      },
      { framing: 'bust', parts: { face: 'smile' }, costume: 'default', expression: 'smile', legwear: 'none', fingerprint: 'fp-2' },
    );
    expect(await keyFor('bust', 123)).toBe(before);
  });

  it('changes when positive, negative, canvas, model, seed or preset version changes', async () => {
    await publishAndImport('aaa1111', undefined, undefined, { negative: 'blurry', canvas: { width: 832, height: 1216 } });
    const before = await keyFor('bust', 123);

    await publishAndImport('aaa1111', undefined, undefined, { negative: 'blurry', canvas: { width: 832, height: 1216 }, positive: 'other' });
    expect(await keyFor('bust', 123)).not.toBe(before);
    await publishAndImport('aaa1111', undefined, undefined, { negative: 'lowres', canvas: { width: 832, height: 1216 } });
    expect(await keyFor('bust', 123)).not.toBe(before);
    await publishAndImport('aaa1111', undefined, undefined, { negative: 'blurry', canvas: { width: 1024, height: 1024 } });
    expect(await keyFor('bust', 123)).not.toBe(before);
    await publishAndImport('aaa1111', undefined, { model: 'model-b' }, { negative: 'blurry', canvas: { width: 832, height: 1216 } });
    expect(await keyFor('bust', 123)).not.toBe(before);

    await publishAndImport('aaa1111', undefined, undefined, { negative: 'blurry', canvas: { width: 832, height: 1216 } });
    expect(await keyFor('bust', 123)).toBe(before);
    expect(await keyFor('bust', 124)).not.toBe(before);
    await env.DB.prepare("UPDATE presets SET version = version + 1 WHERE recipe = ? AND kind = 'pose' AND name = 'bust'").bind(RECIPE).run();
    expect(await keyFor('bust', 123)).not.toBe(before);
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
    const keysBefore = new Set(Object.values(keys));

    expect((await put('ccc3333', 'bust up, smiling')).status).toBe(200);
    await vi.waitFor(async () => expect(await count()).toBe(3));
    const { results } = await env.DB.prepare("SELECT idempotency_key FROM requests WHERE idempotency_key LIKE 'style-check:%'").all<{
      idempotency_key: string;
    }>();
    const added = results.map((r) => r.idempotency_key).filter((k) => !keysBefore.has(k));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^style-check:yukari:bust:/);
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

  interface CheckPose {
    pose: string;
    pin: { short_id: string } | null;
    drift: string;
    prompt_diff: { column: string; baseline: string | null; arm: string | null }[];
    request: { id: string; status: string } | null;
    result: { short_id: string } | null;
  }

  /** The poses the page hands its client script. */
  async function checkPoses(): Promise<{ html: string; poses: CheckPose[] }> {
    const html = await (await req('/check')).text();
    const initial = html.match(/data-initial="([^"]*)"/)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return { html, poses: (JSON.parse(initial) as { poses: CheckPose[] }).poses };
  }

  async function setFingerprint(generationId: string, fingerprint: string, positive?: string): Promise<void> {
    await env.DB.prepare(
      'UPDATE requests SET pose_fingerprint = ? WHERE id = (SELECT request_id FROM generations WHERE id = ?)',
    )
      .bind(fingerprint, generationId)
      .run();
    if (positive !== undefined) {
      const facts = {
        version: 2,
        checkpoints: [],
        models: { clip: [], vae: null },
        samplers: [{ node_id: '1', steps: null, cfg: null, sampler_name: null, scheduler: null, denoise: null, seed: null, prompt: { positive, negative: null }, latent: null }],
        canvas: null,
        loras: [],
        controlnets: [],
        seed: null,
        output: { filename_prefix: null },
      };
      await env.DB.prepare(
        'UPDATE comfy_jobs SET render_facts_json = ? WHERE id = (SELECT comfy_job_id FROM generations WHERE id = ?)',
      )
        .bind(JSON.stringify(facts), generationId)
        .run();
    }
  }

  it('lists every catalog pose and every preset-only pose by name, and marks unpinned ones "pin なし"', async () => {
    await publishAndImport('def5678', undefined, undefined, undefined, ['promoted']);
    const put = await postJson(`/api/v1/catalogs/${RECIPE_REF}`, sampleCatalog('def5679', undefined, undefined, undefined, ['catalogonly']), 'PUT');
    expect(put.status).toBe(200);
    const bust = await pinPose('bust');

    const { html, poses } = await checkPoses();
    expect(poses.map((p) => p.pose)).toEqual(['bust', 'catalogonly', 'coffee', 'promoted']);
    expect(poses.find((p) => p.pose === 'bust')).toMatchObject({ pin: { short_id: bust.shortId, bookmark: false }, request: null, result: null });
    expect(poses.find((p) => p.pose === 'coffee')).toMatchObject({ pin: null, drift: 'no_pin' });
    // pin は共通カードで出し、結果のカードは JS がテンプレートから組む。
    expect(html).toMatch(new RegExp(`class="card card-compact"[^]*?data-short-id="${bust.shortId}"[^]*?class="rating-group" data-generation-id`));
    expect(html).toContain('<template data-generation-card-template="true">');
    expect(html).toContain('>pin なし</span>');
    expect(html).toContain('pin 済みを全部描き直す');
    expect(html).toContain('今のコードで描き直す');
  });

  it('computes drift from the pin request fingerprint against the catalog pose fingerprint', async () => {
    await publishAndImport('fp00001', undefined, undefined, { fingerprint: 'sha256:aaa' });
    const bust = await pinPose('bust');

    await setFingerprint(bust.generationId, 'sha256:aaa');
    expect((await checkPoses()).poses.find((p) => p.pose === 'bust')).toMatchObject({ drift: 'match', prompt_diff: [] });

    await setFingerprint(bust.generationId, 'sha256:bbb');
    expect((await checkPoses()).poses.find((p) => p.pose === 'bust')!.drift).toBe('drift');

    await env.DB.prepare('UPDATE requests SET pose_fingerprint = NULL WHERE id = (SELECT request_id FROM generations WHERE id = ?)')
      .bind(bust.generationId)
      .run();
    expect((await checkPoses()).poses.find((p) => p.pose === 'bust')!.drift).toBe('unknown');

    await setFingerprint(bust.generationId, 'sha256:aaa');
    await publishAndImport('fp00002');
    expect((await checkPoses()).poses.find((p) => p.pose === 'bust')!.drift).toBe('unknown');
  });

  it('diffs the pin prompt against the catalog pose prompt only on drift', async () => {
    await publishAndImport('fp00003', undefined, undefined, { fingerprint: 'sha256:new', positive: 'bust, smiling' });
    const bust = await pinPose('bust');
    await setFingerprint(bust.generationId, 'sha256:old', 'bust');

    const row = (await checkPoses()).poses.find((p) => p.pose === 'bust')!;
    expect(row.drift).toBe('drift');
    expect(row.prompt_diff).toMatchObject([{ column: 'positive', baseline: 'bust', arm: 'bust, smiling' }]);
  });

  it('shows the queued status once a render is enqueued, and hands the generation to the page once it is done', async () => {
    await publishAndImport('feed001');
    const bust = await pinPose('bust');

    const render = await postJson<{ results: StyleCheckPostItem[] }>(`/api/v1/style-check/${RECIPE}`, { pose: 'bust' });
    const bustResult = render.body.results[0]!;
    expect((await checkPoses()).poses.find((p) => p.pose === 'bust')!.request).toMatchObject({ id: bustResult.request_id, status: 'queued' });

    const claimed = await claim(`worker-${crypto.randomUUID()}`);
    expect(claimed.body!.id).toBe(bustResult.request_id);
    const resultGen = await createGeneration({ requestOverrides: { recipe: RECIPE, parameters: { pose: 'bust' } } });
    const doneRes = await postJson(
      `/api/v1/requests/${bustResult.request_id}`,
      { status: 'done', worker_id: claimed.body!.worker_id, result: { generation_ids: [resultGen.generation.id] } },
      'PATCH',
    );
    expect(doneRes.status).toBe(200);

    const bustPose = (await checkPoses()).poses.find((p) => p.pose === 'bust')!;
    expect(bustPose.pin!.short_id).toBe(bust.shortId);
    expect(bustPose.result!.short_id).toBe(resultGen.generation.short_id);
    expect(bustPose.request!.status).toBe('done');
  });

  it('good + repin: rating the re-render good then posting pose-reference moves the pin to it', async () => {
    await publishAndImport('feed002');
    await pinPose('bust');
    const rerender = await createGeneration({ requestOverrides: { recipe: RECIPE, parameters: { pose: 'bust' } } });

    const rated = await postJson(`/api/v1/generations/${rerender.generation.id}/rating`, { rating: 'good' }, 'PUT');
    expect(rated.status).toBe(200);
    const repin = await postJson(`/api/v1/generations/${rerender.generation.id}/pose-reference`, {});
    expect(repin.status).toBe(201);

    const bustPose = (await checkPoses()).poses.find((p) => p.pose === 'bust')!;
    expect(bustPose.pin!.short_id).toBe(rerender.generation.short_id);
  });

  it('opens the compare viewer for ?pose= and leaves it closed for no or an unknown pose', async () => {
    await publishAndImport('feed003');
    await pinPose('bust');

    const open = await (await req('/check?pose=bust')).text();
    expect(open).toMatch(/class="sc-viewer wb"[^>]*data-sc-viewer/);
    expect(open).not.toMatch(/data-sc-viewer="true" hidden/);
    expect(open).toMatch(/data-scv-name="true">bust</);

    for (const url of ['/check', '/check?pose=nonexistent']) {
      const closed = await (await req(url)).text();
      expect(closed).toMatch(/data-sc-viewer="true" hidden/);
    }
  });
});
