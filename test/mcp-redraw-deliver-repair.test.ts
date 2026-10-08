import { describe, expect, it } from 'vitest';
import { createGeneration, getJson, mcpToolCall } from './helpers';

interface CreateRequestResult {
  created: boolean;
  request: { id: string; kind: string; created_by: string; payload: Record<string, unknown> };
}

interface RequestListItem {
  id: string;
}

describe('MCP redraw_generation', () => {
  it('queues a redraw row with created_by mcp and the given method options, returning created: true', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('redraw_generation', {
      generation_id: generation.id,
      options: { method: 'canvas', denoise: 0.55, size: 2048 },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.request.kind).toBe('redraw');
    expect(call.data?.request.created_by).toBe('mcp');
    expect(call.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: { method: 'canvas', denoise: 0.55, size: 2048 },
    });

    const viaRest = await getJson<{ kind: string; created_by: string }>(`/api/v1/requests/${call.data?.request.id}`);
    expect(viaRest.status).toBe(200);
    expect(viaRest.body.kind).toBe('redraw');
    expect(viaRest.body.created_by).toBe('mcp');
  });

  it.each([
    [{ method: 'hires', hires: 2048, denoise: 0.35 }],
    [{ method: 'light', scene: 'moon', from: 'ne' }],
  ])('stores method options %j in the payload', async (options) => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('redraw_generation', {
      generation_id: generation.short_id,
      options,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id, options });
  });

  it('requires a method and rejects options of another method', async () => {
    const { generation } = await createGeneration();
    for (const options of [undefined, { denoise: 0.5 }, { method: 'hires', route: 'latent' }, { method: 'light', scene: 'noon' }]) {
      const call = await mcpToolCall('redraw_generation', {
        generation_id: generation.id,
        ...(options ? { options } : {}),
        idempotency_key: crypto.randomUUID(),
      });
      expect(call.isError).toBe(true);
    }
    const list = await getJson<{ items: RequestListItem[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=redraw`);
    expect(list.body.items).toEqual([]);
  });

  it('replays the same idempotency_key as created: false', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();
    const input = { generation_id: generation.id, options: { method: 'canvas' }, idempotency_key: key };

    const first = await mcpToolCall<CreateRequestResult>('redraw_generation', input);
    expect(first.isError).toBe(false);
    expect(first.data?.created).toBe(true);

    const second = await mcpToolCall<CreateRequestResult>('redraw_generation', input);
    expect(second.isError).toBe(false);
    expect(second.data?.created).toBe(false);
    expect(second.data?.request.id).toBe(first.data?.request.id);
  });

  it('404s as a tool error for an unknown generation', async () => {
    const call = await mcpToolCall('redraw_generation', {
      generation_id: 'does-not-exist',
      options: { method: 'canvas' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
  });
});

describe('MCP deliver_generation', () => {
  it('queues a deliver row with created_by mcp and the given options, returning created: true', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('deliver_generation', {
      generation_id: generation.id,
      options: { repin: true, backdrop: 'dots', stroke_light: 'n' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.request.kind).toBe('deliver');
    expect(call.data?.request.created_by).toBe('mcp');
    expect(call.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: { repin: true, backdrop: 'dots', stroke_light: 'n' },
    });

    const viaRest = await getJson<{ kind: string; created_by: string }>(`/api/v1/requests/${call.data?.request.id}`);
    expect(viaRest.status).toBe(200);
    expect(viaRest.body.kind).toBe('deliver');
    expect(viaRest.body.created_by).toBe('mcp');
  });

  it('omits options from the payload when not given', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('deliver_generation', {
      generation_id: generation.short_id,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id });
  });

  it('stores outlines, light and a null backdrop in the payload', async () => {
    const { generation } = await createGeneration();
    const options = {
      backdrop: null,
      transparent: true,
      outlines: [{ color: '#ffffff', width: 0.4 }],
      light: { scene: 'sunset', from: 'nw' },
    };
    const call = await mcpToolCall<CreateRequestResult>('deliver_generation', {
      generation_id: generation.id,
      options,
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload).toEqual({ generation_id: generation.short_id, options });
  });

  it('rejects options that only finalize or redraw knew, as a tool error that creates no row', async () => {
    const { generation } = await createGeneration();
    for (const options of [{ deliver_only: true }, { repair: ['feet'] }, { denoise: 0.5 }, { hires: 2048 }, { route: 'foo' }, { stroke_light: 'none' }, { dof: { focus: [0.5, 0.5], f_number: 2.8 } }, { outlines: [{ color: 'red', width: 1 }] }]) {
      const call = await mcpToolCall('deliver_generation', {
        generation_id: generation.id,
        options,
        idempotency_key: crypto.randomUUID(),
      });
      expect(call.isError).toBe(true);
    }
    const list = await getJson<{ items: RequestListItem[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=deliver`);
    expect(list.body.items).toEqual([]);
  });

  it('replays the same idempotency_key as created: false', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await mcpToolCall<CreateRequestResult>('deliver_generation', { generation_id: generation.id, idempotency_key: key });
    expect(first.isError).toBe(false);
    expect(first.data?.created).toBe(true);

    const second = await mcpToolCall<CreateRequestResult>('deliver_generation', { generation_id: generation.id, idempotency_key: key });
    expect(second.isError).toBe(false);
    expect(second.data?.created).toBe(false);
    expect(second.data?.request.id).toBe(first.data?.request.id);
  });

  it('404s as a tool error for an unknown generation', async () => {
    const call = await mcpToolCall('deliver_generation', {
      generation_id: 'does-not-exist',
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
  });
});

describe('MCP create_request kinds', () => {
  it('no longer accepts finalize', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall('create_request', {
      kind: 'finalize',
      payload: { generation_id: generation.id },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    const list = await getJson<{ items: RequestListItem[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=finalize`);
    expect(list.body.items).toEqual([]);
  });

  it.each([
    ['redraw', { method: 'light', scene: 'moon' }],
    ['deliver', { backdrop: 'stripes' }],
  ])('creates a %s row through create_request', async (kind, options) => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('create_request', {
      kind,
      payload: { generation_id: generation.id, options },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.request.kind).toBe(kind);
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

describe('MCP dof_generation', () => {
  it('queues a dof row with created_by mcp, a short_id payload and only the given options', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall<CreateRequestResult>('dof_generation', {
      generation_id: generation.id,
      focus: [0.4, 0.6],
      f_number: 2,
      scope: { figure: true, outline: false, backdrop: true },
      viewfinder: 'on',
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.request.kind).toBe('dof');
    expect(call.data?.request.created_by).toBe('mcp');
    expect(call.data?.request.payload).toEqual({
      generation_id: generation.short_id,
      options: { focus: [0.4, 0.6], f_number: 2, scope: { figure: true, outline: false, backdrop: true }, viewfinder: 'on' },
    });

    const minimal = await mcpToolCall<CreateRequestResult>('dof_generation', {
      generation_id: generation.id,
      focus: [0.5, 0.5],
      idempotency_key: crypto.randomUUID(),
    });
    expect(minimal.data?.request.payload).toEqual({ generation_id: generation.short_id, options: { focus: [0.5, 0.5] } });
  });

  it('rejects invalid input as a tool error that creates no row, and 404s an unknown generation', async () => {
    const { generation } = await createGeneration();
    for (const bad of [
      { focus: [1.5, 0.5] },
      { focus: [0.5, 0.5], f_number: 30 },
      { focus: [0.5, 0.5], scope: { figure: false, outline: false, backdrop: false } },
      { focus: [0.5, 0.5], viewfinder: 'grid' },
      {},
    ]) {
      const call = await mcpToolCall('dof_generation', { generation_id: generation.id, ...bad, idempotency_key: crypto.randomUUID() });
      expect(call.isError).toBe(true);
    }
    const list = await getJson<{ items: RequestListItem[] }>(`/api/v1/requests?generation_id=${generation.id}&kind=dof`);
    expect(list.body.items).toEqual([]);
    const missing = await mcpToolCall('dof_generation', { generation_id: 'does-not-exist', focus: [0.5, 0.5], idempotency_key: crypto.randomUUID() });
    expect(missing.isError).toBe(true);
  });
});
