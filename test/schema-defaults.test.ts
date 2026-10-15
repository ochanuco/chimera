// スキーマ宣言が省略時に埋める値を HTTP / MCP 越しに固定する。宣言の書き方を変えても省略時の挙動が同じであることの確認用。
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, createRequest, mcpToolCall, postJson } from './helpers';

describe('MCP derive_request', () => {
  it('count defaults to 1 and replace_patches to false (parent patches are carried and the new ones appended)', async () => {
    const parentPatches = [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }];
    const { generation } = await createGeneration({
      requestOverrides: { recipe: 'yukari', parameters: { pose: 'lounge' }, patches: parentPatches, pose_fingerprint: 'sha256:fixture' },
    });
    const added = { target: 'prompt.positive', op: 'append', value: 'smile', reason: 'variant' };

    const call = await mcpToolCall<{ payload: { request: Record<string, unknown>; generation: { patches: unknown[] } } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'try a variant',
      patches: [added],
      semantic: { summary: 'variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.request).toMatchObject({ instruction: 'try a variant', count: 1 });
    expect(call.data?.payload.generation.patches).toEqual([...parentPatches, added]);
  });
});

describe('MCP list_catalog', () => {
  it("recipe_ref defaults to 'production'", async () => {
    const catalog = { schema_version: 1, recipes: [{ name: 'yukari', poses: [] }], patches: {}, git_commit: 'abc1234' };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);

    const tool = await mcpToolCall<{ recipe_ref: string; git_commit: string }>('list_catalog', {});
    expect(tool.isError).toBe(false);
    expect(tool.data).toMatchObject({ recipe_ref: 'production', git_commit: 'abc1234' });
  });
});

describe('PUT /api/v1/requests/:id/timings', () => {
  it('prompts defaults to [], and a prompt without resumed / nodes gets resumed=false and no nodes', async () => {
    const { body: request } = await createRequest();
    const attempt = { worker_id: 'w1', version: 'v2', source: 'worker', status: 'done' };

    const bare = await postJson(`/api/v1/requests/${request.id}/timings`, { ...attempt, attempt: 1 }, 'PUT');
    expect(bare.status).toBe(200);
    const prompt = {
      prompt_id: 'a1111111-0000-4000-8000-000000000002',
      purpose: 'render',
      status: 'success',
    };
    const withPrompt = await postJson(`/api/v1/requests/${request.id}/timings`, { ...attempt, attempt: 2, prompts: [prompt] }, 'PUT');
    expect(withPrompt.status).toBe(200);

    const attempts = await env.DB.prepare('SELECT COUNT(*) AS n FROM request_attempt_timings WHERE request_id = ?').bind(request.id).first<{ n: number }>();
    expect(attempts!.n).toBe(2);
    const { results: prompts } = await env.DB.prepare('SELECT resumed FROM prompt_timings WHERE request_id = ?').bind(request.id).all<{ resumed: number }>();
    expect(prompts).toEqual([{ resumed: 0 }]);
    const nodes = await env.DB.prepare('SELECT COUNT(*) AS n FROM node_timings').first<{ n: number }>();
    expect(nodes!.n).toBe(0);
  });
});
