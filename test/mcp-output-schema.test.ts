import { describe, expect, it } from 'vitest';
import { createGeneration, mcpCall, mcpToolCall, postJson } from './helpers';

// structuredContent の schema 検証は helpers の mcpToolCall が行う。他のテストが
// 呼んでいない tool はここで一度呼んで、schema と serializer のずれを本番ではなくここで出す。

interface ToolsList {
  tools: { name: string; inputSchema?: unknown; outputSchema?: { type?: string } }[];
}

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

describe('MCP outputSchema', () => {
  it('every registered tool advertises an object-rooted outputSchema', async () => {
    const listed = await mcpCall<ToolsList>('tools/list', {});
    const tools = listed.body.result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);

    const missing = tools.filter((t) => !t.outputSchema).map((t) => t.name);
    expect(missing).toEqual([]);
    for (const tool of tools) {
      expect(tool.outputSchema?.type, tool.name).toBe('object');
    }
  });

  it('validates the Run and Experiment tools that no other test calls', async () => {
    const experiment = await postJson<{ id: string }>('/api/v1/experiments', { name: uniqueName('exp') });
    const run = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {
      overrides: { patches: [{ target: 'pose', op: 'append', reason: 'test', value: 'x' }] },
    });

    for (const [name, args] of [
      ['list_experiments', {}],
      ['get_experiment', { id: experiment.body.id }],
      ['get_run', { run_id: run.body.id }],
      ['set_evaluation', { run_id: run.body.id, evaluation: { overall: 'good' } }],
      ['set_decision', { run_id: run.body.id, decision: { keep: true } }],
    ] as const) {
      const call = await mcpToolCall(name, args);
      expect(call.isError, name).toBe(false);
      expect(call.structured, name).toBeTypeOf('object');
    }
  });

  it('validates the request tools', async () => {
    const created = await mcpToolCall<{ request: { id: string } }>('create_request', {
      kind: 'generate',
      payload: { schema_version: 1, request: { count: 1 }, generation: { recipe: 'yukari', pose: 'lounge' } },
      idempotency_key: crypto.randomUUID(),
    });
    expect(created.isError).toBe(false);
    expect(created.structured).toBeTypeOf('object');

    const id = created.data?.request.id as string;
    const got = await mcpToolCall('get_request', { id });
    expect(got.isError).toBe(false);
    expect(got.structured).toBeTypeOf('object');

    const listed = await mcpToolCall('list_requests', { kind: 'generate' });
    expect(listed.isError).toBe(false);
    expect(listed.structured).toBeTypeOf('object');
  });

  it('returns a body-less catalog pose as an object, not a bare name string', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    await postJson(
      `/api/v1/catalogs/${recipeRef}`,
      {
        schema_version: 1,
        recipes: [{ name: 'yukari', poses: ['seated'], costumes: [], expressions: [], parameters: {} }],
        patches: {},
        generated_at: '2026-09-09T00:00:00.000Z',
      },
      'PUT',
    );

    const call = await mcpToolCall('get_catalog_pose', { recipe: 'yukari', pose: 'seated', recipe_ref: recipeRef });
    expect(call.isError).toBe(false);
    expect(call.structured).toEqual({ name: 'seated' });
  });

  it('carries the image tool result in structuredContent as well as the image block', async () => {
    const missing = await mcpToolCall('get_generation_image', { short_id: 'nope' });
    expect(missing.isError).toBe(true);

    const { generation } = await createGeneration();
    const call = await mcpToolCall('get_generation_image', { short_id: generation.short_id });
    expect(call.isError).toBe(false);
    expect(call.result?.content?.[0]?.type).toBe('image');
    expect(call.structured).toMatchObject({ short_id: generation.short_id, inlined: true });
  });
});
