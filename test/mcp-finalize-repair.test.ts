import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall } from './helpers';

interface CreateRequestResult {
  created: boolean;
  request: { id: string; kind: string; created_by: string; payload: Record<string, unknown> };
}

interface RequestListItem {
  id: string;
}

describe('MCP finalize_generation', () => {
  it('queues a finalize row with created_by mcp and the given options, returning created: true', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('finalize_generation', {
      generation_id: generation.id,
      options: { repin: true, denoise: 0.55 },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.request.kind).toBe('finalize');
    expect(call.data?.request.created_by).toBe('mcp');
    expect(call.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: { repin: true, denoise: 0.55 },
    });

    const viaRest = await getJson<{ kind: string; created_by: string }>(`/api/v1/requests/${call.data?.request.id}`);
    expect(viaRest.status).toBe(200);
    expect(viaRest.body.kind).toBe('finalize');
    expect(viaRest.body.created_by).toBe('mcp');
  });

  it('omits options from the payload when not given', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('finalize_generation', {
      generation_id: generation.short_id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id });
  });

  it('replays the same idempotency_key as created: false', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await mcpToolCall<CreateRequestResult>('finalize_generation', {
      generation_id: generation.id,
      idempotency_key: key,
    });
    expect(first.isError).toBe(false);
    expect(first.data?.created).toBe(true);

    const second = await mcpToolCall<CreateRequestResult>('finalize_generation', {
      generation_id: generation.id,
      idempotency_key: key,
    });
    expect(second.isError).toBe(false);
    expect(second.data?.created).toBe(false);
    expect(second.data?.request.id).toBe(first.data?.request.id);
  });

  it('rejects an invalid option as a tool error and creates no row', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall('finalize_generation', {
      generation_id: generation.id,
      options: { route: 'foo' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);

    const list = await getJson<{ items: RequestListItem[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=finalize`);
    expect(list.body.items).toEqual([]);
  });

  it('404s as a tool error for an unknown generation', async () => {
    const call = await mcpToolCall('finalize_generation', {
      generation_id: 'does-not-exist',
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
  });
});

describe('MCP repair_generation', () => {
  it('queues a repair row with created_by mcp and the given options, returning created: true', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('repair_generation', {
      generation_id: generation.id,
      options: { parts: ['hands', 'feet'], denoise: 0.6 },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.request.kind).toBe('repair');
    expect(call.data?.request.created_by).toBe('mcp');
    expect(call.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: { parts: ['hands', 'feet'], denoise: 0.6 },
    });

    const viaRest = await getJson<{ kind: string; created_by: string }>(`/api/v1/requests/${call.data?.request.id}`);
    expect(viaRest.status).toBe(200);
    expect(viaRest.body.kind).toBe('repair');
    expect(viaRest.body.created_by).toBe('mcp');
  });

  it('omits options from the payload when not given', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('repair_generation', {
      generation_id: generation.short_id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id });
  });

  it('replays the same idempotency_key as created: false', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await mcpToolCall<CreateRequestResult>('repair_generation', {
      generation_id: generation.id,
      idempotency_key: key,
    });
    expect(first.isError).toBe(false);
    expect(first.data?.created).toBe(true);

    const second = await mcpToolCall<CreateRequestResult>('repair_generation', {
      generation_id: generation.id,
      idempotency_key: key,
    });
    expect(second.isError).toBe(false);
    expect(second.data?.created).toBe(false);
    expect(second.data?.request.id).toBe(first.data?.request.id);
  });

  it('rejects an invalid option as a tool error and creates no row', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall('repair_generation', {
      generation_id: generation.id,
      options: { pad: 9 },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);

    const list = await getJson<{ items: RequestListItem[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=repair`);
    expect(list.body.items).toEqual([]);
  });

  it('404s as a tool error for an unknown generation', async () => {
    const call = await mcpToolCall('repair_generation', {
      generation_id: 'does-not-exist',
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
  });
});
