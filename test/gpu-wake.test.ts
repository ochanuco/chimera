import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGpuStatus, wakeGpu } from '../src/lib/gpu-wake';
import type { Bindings } from '../src/types';
import { mcpToolCall, postJson } from './helpers';

const bindings = env as unknown as Bindings;

type FetchSpy = ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

function wolCalls(spy: FetchSpy): { url: string; init: RequestInit | undefined }[] {
  return spy.mock.calls
    .map(([input, init]) => ({ url: String(input instanceof Request ? input.url : input), init }))
    .filter((c) => c.url.startsWith('https://wol.chanu.co/'));
}

/** runInBackground はテストでは waitUntil が無く Promise を投げっぱなしにするので、wake の fetch が走るまで待つ。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
}

describe('GPU wake', () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    bindings.WOL_CLIENT_ID = 'test-id';
    bindings.WOL_CLIENT_SECRET = 'test-secret';
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/status')) {
        return Response.json({ state: 'sleeping', since: '2026-10-10T00:00:00Z', reason: 'idle', last_seen: '2026-10-09T23:50:00Z' });
      }
      return new Response(null, { status: 202 });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete bindings.WOL_CLIENT_ID;
    delete bindings.WOL_CLIENT_SECRET;
  });

  it('posts /wake with the Access service token headers', async () => {
    await wakeGpu(bindings);
    const calls = wolCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://wol.chanu.co/wake');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toMatchObject({ 'CF-Access-Client-Id': 'test-id', 'CF-Access-Client-Secret': 'test-secret' });
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips without secrets and swallows wol failures', async () => {
    delete bindings.WOL_CLIENT_SECRET;
    await wakeGpu(bindings);
    expect(wolCalls(fetchSpy)).toHaveLength(0);

    bindings.WOL_CLIENT_SECRET = 'test-secret';
    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    await expect(wakeGpu(bindings)).resolves.toBeUndefined();
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 502 }));
    await expect(wakeGpu(bindings)).resolves.toBeUndefined();
  });

  it('wakes the GPU after queueing a request and not for a done import', async () => {
    const queued = await postJson<{ status: string }>('/api/v1/requests', {
      kind: 'generate',
      idempotency_key: `gen-${crypto.randomUUID()}`,
      created_by: 'brain',
      payload: { schema_version: 1, request: { instruction: 'x', count: 1 }, generation: { recipe: 'yukari' } },
    });
    expect(queued.status).toBe(201);
    await settle();
    expect(wolCalls(fetchSpy).map((c) => c.url)).toEqual(['https://wol.chanu.co/wake']);

    fetchSpy.mockClear();
    const imported = await postJson('/api/v1/requests', {
      kind: 'import',
      status: 'done',
      idempotency_key: `import-${crypto.randomUUID()}`,
      created_by: 'brain',
      recipe: null,
      raw_instruction: 'hand edit',
      parameters: { kind: 'hand-edit' },
      git_commit: 'abc1234',
      git_dirty: false,
    });
    expect(imported.status).toBe(201);
    await settle();
    expect(wolCalls(fetchSpy)).toHaveLength(0);
  });

  it('queues the request even when wol is unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('unreachable'));
    const queued = await postJson<{ status: string }>('/api/v1/requests', {
      kind: 'generate',
      idempotency_key: `gen-${crypto.randomUUID()}`,
      created_by: 'brain',
      payload: { schema_version: 1, request: { instruction: 'x', count: 1 }, generation: { recipe: 'yukari' } },
    });
    expect(queued.status).toBe(201);
    expect(queued.body.status).toBe('queued');
    await settle();
  });

  it('reads /status, and reports why it could not', async () => {
    expect(await getGpuStatus(bindings)).toEqual({
      ok: true,
      status: { state: 'sleeping', since: '2026-10-10T00:00:00Z', reason: 'idle', last_seen: '2026-10-09T23:50:00Z' },
    });

    fetchSpy.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    expect(await getGpuStatus(bindings)).toEqual({ ok: false, error: 'wol status returned HTTP 403' });

    delete bindings.WOL_CLIENT_ID;
    expect(await getGpuStatus(bindings)).toEqual({ ok: false, error: 'WOL_CLIENT_ID / WOL_CLIENT_SECRET not set' });
  });

  it('exposes the status through MCP get_gpu_status', async () => {
    const call = await mcpToolCall<Record<string, unknown>>('get_gpu_status', {});
    expect(call.isError).toBe(false);
    expect(call.data).toEqual({
      state: 'sleeping',
      since: '2026-10-10T00:00:00Z',
      reason: 'idle',
      last_seen: '2026-10-09T23:50:00Z',
      error: null,
    });

    delete bindings.WOL_CLIENT_ID;
    const unset = await mcpToolCall<Record<string, unknown>>('get_gpu_status', {});
    expect(unset.data).toMatchObject({ state: null, error: 'WOL_CLIENT_ID / WOL_CLIENT_SECRET not set' });
  });
});
