import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWakeResult,
  beginWakeSend,
  getGpuStatus,
  parseRetryAfter,
  postWake,
  requestWake,
  shouldHealWake,
  WAKE_GIVE_UP_MS,
  type WakeResult,
  type WakeState,
} from '../src/lib/gpu-wake';
import type { Bindings } from '../src/types';
import { clearRequests, mcpToolCall, postJson } from './helpers';

const bindings = env as unknown as Bindings;
const T0 = 1_800_000_000_000;
const OK: WakeResult = { ok: true, status: 202 };
const FAIL: WakeResult = { ok: false, status: 503, retry_after_ms: null, error: 'HTTP 503' };

type FetchSpy = ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

function wolCalls(spy: FetchSpy): { url: string; init: RequestInit | undefined }[] {
  return spy.mock.calls
    .map(([input, init]) => ({ url: String(input instanceof Request ? input.url : input), init }))
    .filter((c) => c.url.startsWith('https://wol.chanu.co/'));
}

describe('wake state machine', () => {
  it('starts a procedure on request and leaves a running one alone', () => {
    const started = requestWake(null, T0);
    expect(started).toEqual({ started_at: T0, failures: 0, next_at: T0, sending_since: null, succeeded_at: null });
    expect(requestWake(started, T0 + 1000)).toBe(started);

    const sending = beginWakeSend(started, T0)!;
    expect(sending).toMatchObject({ next_at: null, sending_since: T0 });
    expect(requestWake(sending, T0 + 1000)).toBe(sending);
    // 送信中の印が古ければ送り直す
    expect(requestWake(sending, T0 + 15_000)).toMatchObject({ next_at: T0 + 15_000, sending_since: null });
  });

  it('sends only once the next send is due', () => {
    const s = { ...requestWake(null, T0), next_at: T0 + 5000 };
    expect(beginWakeSend(s, T0 + 4999)).toBeNull();
    expect(beginWakeSend(s, T0 + 5000)).toMatchObject({ sending_since: T0 + 5000, next_at: null });
    expect(beginWakeSend(null, T0)).toBeNull();
  });

  it('holds new sends for 30 s after a success', () => {
    const { state, gaveUp } = applyWakeResult(beginWakeSend(requestWake(null, T0), T0)!, OK, T0 + 100);
    expect(gaveUp).toBe(false);
    expect(state).toMatchObject({ failures: 0, succeeded_at: T0 + 100, next_at: T0 + 30_100, sending_since: null });
  });

  it('backs off 5 s, 10 s, 20 s … capped at 60 s, and prefers Retry-After', () => {
    let state: WakeState = requestWake(null, T0);
    let now = T0;
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      state = beginWakeSend(state, now)!;
      const applied = applyWakeResult(state, FAIL, now);
      state = applied.state!;
      gaps.push(state.next_at! - now);
      now = state.next_at!;
    }
    expect(gaps).toEqual([5000, 10_000, 20_000, 40_000, 60_000, 60_000]);

    const retry = applyWakeResult(beginWakeSend(requestWake(null, T0), T0)!, { ...FAIL, status: 429, retry_after_ms: 7000 }, T0);
    expect(retry.state?.next_at).toBe(T0 + 7000);

    // 成功で失敗の回数は戻る
    expect(applyWakeResult({ ...state, sending_since: now }, OK, now).state?.failures).toBe(0);
  });

  it('gives up when the next send would pass 5 minutes', () => {
    const old: WakeState = { started_at: T0, failures: 5, next_at: null, sending_since: T0 + WAKE_GIVE_UP_MS - 30_000, succeeded_at: null };
    expect(applyWakeResult(old, FAIL, T0 + WAKE_GIVE_UP_MS - 30_000)).toEqual({ state: null, gaveUp: true });
    expect(applyWakeResult(old, OK, T0 + WAKE_GIVE_UP_MS - 10_000)).toEqual({ state: null, gaveUp: true });
    expect(applyWakeResult(old, OK, T0 + WAKE_GIVE_UP_MS - 40_000).gaveUp).toBe(false);
  });

  it('heals a queued row left 2 minutes without a worker', () => {
    const base = { state: null, now: T0, last_worker_seen_at: null, gave_up_at: null, oldest_queued_at: T0 - 120_000, running: 0 };
    expect(shouldHealWake(base)).toBe(true);
    expect(shouldHealWake({ ...base, oldest_queued_at: T0 - 119_000 })).toBe(false);
    expect(shouldHealWake({ ...base, oldest_queued_at: null })).toBe(false);
    expect(shouldHealWake({ ...base, running: 1 })).toBe(false);
    expect(shouldHealWake({ ...base, last_worker_seen_at: T0 - 60_000 })).toBe(false);
    expect(shouldHealWake({ ...base, gave_up_at: T0 - 10 * 60_000 })).toBe(false);
    expect(shouldHealWake({ ...base, gave_up_at: T0 - 30 * 60_000 })).toBe(true);
    expect(shouldHealWake({ ...base, state: requestWake(null, T0) })).toBe(false);
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfter('12', T0)).toBe(12_000);
    expect(parseRetryAfter(new Date(T0 + 3000).toUTCString(), T0)).toBe(3000);
    expect(parseRetryAfter('soon', T0)).toBeNull();
    expect(parseRetryAfter(null, T0)).toBeNull();
  });
});

describe('wol API calls', () => {
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

  it('posts /wake with the Access service token and reads the outcome', async () => {
    expect(await postWake(bindings)).toEqual({ ok: true, status: 202 });
    const [call] = wolCalls(fetchSpy);
    expect(call?.url).toBe('https://wol.chanu.co/wake');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toMatchObject({ 'CF-Access-Client-Id': 'test-id', 'CF-Access-Client-Secret': 'test-secret' });
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await postWake(bindings)).toEqual({ ok: true, status: 200 });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '9' } }));
    expect(await postWake(bindings)).toMatchObject({ ok: false, status: 429, retry_after_ms: 9000 });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect(await postWake(bindings)).toMatchObject({ ok: false, status: 502, retry_after_ms: null });
    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    expect(await postWake(bindings)).toMatchObject({ ok: false, status: null, error: 'timeout' });
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

describe('WorkerHub wakes the GPU machine', () => {
  const stub = () => env.WORKER_HUB.get(env.WORKER_HUB.idFromName('global'));
  let fetchSpy: FetchSpy;

  const readWake = () =>
    runInDurableObject(stub(), async (_instance, state) => ({
      wake: (await state.storage.get<WakeState>('wake')) ?? null,
      gaveUpAt: (await state.storage.get<number>('wake:gave_up_at')) ?? null,
      alarm: await state.storage.getAlarm(),
    }));

  const runAlarm = () => runInDurableObject(stub(), (instance) => instance.alarm());

  const writeWake = (wake: WakeState) =>
    runInDurableObject(stub(), async (_instance, state) => {
      await state.storage.put('wake', wake);
    });

  /** 投入経路は hub 通知を投げっぱなしにするので、DO に届くまで待つ。 */
  async function waitForWake(pred: (w: WakeState | null) => boolean): Promise<WakeState | null> {
    for (let i = 0; i < 50; i++) {
      const { wake } = await readWake();
      if (pred(wake)) return wake;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('wake state never matched');
  }

  const queueGenerate = () =>
    postJson<{ id: string; status: string }>('/api/v1/requests', {
      kind: 'generate',
      idempotency_key: `gen-${crypto.randomUUID()}`,
      created_by: 'brain',
      payload: { schema_version: 1, request: { instruction: 'x', count: 1 }, generation: { recipe: 'yukari' } },
    });

  const clearWake = () =>
    runInDurableObject(stub(), async (_instance, state) => {
      await state.storage.delete(['wake', 'wake:gave_up_at', 'wake:worker_seen_at']);
    });

  beforeEach(async () => {
    await clearRequests();
    await clearWake();
    bindings.WOL_CLIENT_ID = 'test-id';
    bindings.WOL_CLIENT_SECRET = 'test-secret';
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
  });

  // 残った手順は実時間の alarm で再送を続けるので、後続のテストへ持ち越さない。
  afterEach(async () => {
    await clearWake();
    fetchSpy.mockRestore();
    delete bindings.WOL_CLIENT_ID;
    delete bindings.WOL_CLIENT_SECRET;
  });

  it('sends one /wake for a burst of queued requests, then holds for 30 s', async () => {
    for (let i = 0; i < 3; i++) expect((await queueGenerate()).status).toBe(201);
    await waitForWake((w) => w !== null);
    // alarm はこのハーネスでも実時間で発火するので、手で回すのと競合しても送信は1回になる。
    await runAlarm();
    const wake = await waitForWake((w) => w?.succeeded_at != null);
    expect(wolCalls(fetchSpy).map((c) => c.url)).toEqual(['https://wol.chanu.co/wake']);
    expect(wake?.next_at).toBe(wake!.succeeded_at! + 30_000);
    expect((await readWake()).alarm).toBe(wake?.next_at);

    expect((await queueGenerate()).status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect((await readWake()).wake).toEqual(wake);
    expect(wolCalls(fetchSpy)).toHaveLength(1);
  });

  it('schedules a backoff retry after a failure and stops once a worker claims', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect((await queueGenerate()).status).toBe(201);
    await waitForWake((w) => w !== null);
    await runAlarm();

    const wake = await waitForWake((w) => w?.failures === 1);
    expect(wake?.succeeded_at).toBeNull();
    expect((await readWake()).alarm).toBe(wake?.next_at);
    expect(wake!.next_at! - Date.now()).toBeGreaterThan(4000);
    expect(wake!.next_at! - Date.now()).toBeLessThanOrEqual(5000);

    expect((await postJson('/api/v1/requests/claim', { worker_id: 'gpu-box-1' })).status).toBe(200);
    await waitForWake((w) => w === null);
    // claim 直後の投入では起こさない
    expect((await queueGenerate()).status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect((await readWake()).wake).toBeNull();
  });

  it('gives up 5 minutes after the procedure started', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));
    const now = Date.now();
    await writeWake({ started_at: now - WAKE_GIVE_UP_MS + 1000, failures: 4, next_at: now, sending_since: null, succeeded_at: null });
    await runAlarm();
    expect(wolCalls(fetchSpy)).toHaveLength(1);
    const { wake, gaveUpAt } = await readWake();
    expect(wake).toBeNull();
    expect(gaveUpAt).not.toBeNull();
  });

  it('restarts the procedure for a queued row left without a worker', async () => {
    const queued = await queueGenerate();
    await waitForWake((w) => w !== null);
    await runInDurableObject(stub(), async (_instance, state) => {
      await state.storage.delete('wake');
    });
    await env.DB.prepare("UPDATE requests SET status = 'cancelled' WHERE status = 'running'").run();
    await env.DB.prepare('UPDATE requests SET created_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 3 * 60_000).toISOString(), queued.body.id)
      .run();

    fetchSpy.mockClear();
    await runAlarm();
    expect(wolCalls(fetchSpy)).toHaveLength(1);
    expect((await readWake()).wake?.succeeded_at).not.toBeNull();
  });

  it('does not wake for a done import, nor without secrets, and still queues', async () => {
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

    delete bindings.WOL_CLIENT_SECRET;
    const queued = await queueGenerate();
    expect(queued.status).toBe(201);
    expect(queued.body.status).toBe('queued');
    await new Promise((r) => setTimeout(r, 50));
    expect((await readWake()).wake).toBeNull();
  });
});
