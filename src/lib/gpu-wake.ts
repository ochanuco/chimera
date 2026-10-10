// GPU 機（comfyui-recipes の worker が動く Windows 機）はジョブも入力も無いまま 10 分経つと自分でスリープし、
// 寝ている間は claim に来られない。どの経路のジョブも chimera のキューを通るので、起こす役は chimera が担う。
// /wake を叩くのは WorkerHub (src/worker-hub.ts) だけで、ここはその状態機械（純関数）と wol API の呼び出しを持つ。
// 一斉投入で /wake がジョブの数だけ飛ばないよう手順は 1 本に集約し、失敗は alarm でバックオフ再送する。

import type { Bindings } from '../types';

const WOL_TIMEOUT_MS = 5000;

/** 2xx の後、次に /wake を送るまでの間隔。この間の新しい起床要求は送らない。 */
export const WAKE_SUCCESS_INTERVAL_MS = 30_000;
export const WAKE_RETRY_BASE_MS = 5_000;
export const WAKE_RETRY_MAX_MS = 60_000;
/** 手順を始めてからこれを超えても worker が来なければ諦める（wol 側も offline を Discord に通知する）。 */
export const WAKE_GIVE_UP_MS = 5 * 60_000;
/** 送信中の印がこれより古ければ、送信中に DO が落ちたとみなして送り直す。 */
export const WAKE_SENDING_STALE_MS = 15_000;
/** queued 行がこれより長く残り、その間 worker が来ていなければ起床手順を再開する。 */
export const WAKE_HEAL_QUEUED_MS = 2 * 60_000;
/** 諦めた後、自己修復で手順を再開するまでの間隔。新しいジョブの投入はこれを待たずに起こす。 */
export const WAKE_HEAL_COOLDOWN_MS = 30 * 60_000;

/** 進行中の起床手順。手順が無いときは null。時刻はすべて epoch ms。 */
export interface WakeState {
  started_at: number;
  /** 連続した失敗の回数。バックオフの指数。 */
  failures: number;
  /** 次に /wake を送る時刻。送信中は null。 */
  next_at: number | null;
  sending_since: number | null;
  succeeded_at: number | null;
}

export type WakeResult = { ok: true; status: number } | { ok: false; status: number | null; retry_after_ms: number | null; error: string };

/** 起床要求（ジョブの投入・自己修復）。手順が進行中なら変えない。 */
export function requestWake(state: WakeState | null, now: number): WakeState {
  if (!state) return { started_at: now, failures: 0, next_at: now, sending_since: null, succeeded_at: null };
  if (state.next_at === null && state.sending_since !== null && now - state.sending_since >= WAKE_SENDING_STALE_MS) {
    return { ...state, sending_since: null, next_at: now };
  }
  return state;
}

/** 送信の時刻が来ていれば送信中に移す。来ていなければ null。 */
export function beginWakeSend(state: WakeState | null, now: number): WakeState | null {
  if (!state || state.next_at === null || state.next_at > now) return null;
  return { ...state, next_at: null, sending_since: now };
}

/** 送信結果を反映する。次の送信が手順の期限を越えるなら諦めて null を返す。 */
export function applyWakeResult(state: WakeState, result: WakeResult, now: number): { state: WakeState | null; gaveUp: boolean } {
  let nextAt: number;
  let next: WakeState;
  if (result.ok) {
    nextAt = now + WAKE_SUCCESS_INTERVAL_MS;
    next = { ...state, failures: 0, sending_since: null, succeeded_at: now, next_at: nextAt };
  } else {
    const backoff = Math.min(WAKE_RETRY_BASE_MS * 2 ** state.failures, WAKE_RETRY_MAX_MS);
    nextAt = now + (result.retry_after_ms ?? backoff);
    next = { ...state, failures: state.failures + 1, sending_since: null, next_at: nextAt };
  }
  if (nextAt - state.started_at > WAKE_GIVE_UP_MS) return { state: null, gaveUp: true };
  return { state: next, gaveUp: false };
}

export interface HealInput {
  state: WakeState | null;
  now: number;
  last_worker_seen_at: number | null;
  gave_up_at: number | null;
  oldest_queued_at: number | null;
  running: number;
}

/** 起こし損ねた queued 行の自己修復。running 行があれば worker は起きている。 */
export function shouldHealWake(input: HealInput): boolean {
  const { now } = input;
  if (input.state) return false;
  if (input.oldest_queued_at === null || now - input.oldest_queued_at < WAKE_HEAL_QUEUED_MS) return false;
  if (input.running > 0) return false;
  if (input.last_worker_seen_at !== null && now - input.last_worker_seen_at < WAKE_HEAL_QUEUED_MS) return false;
  if (input.gave_up_at !== null && now - input.gave_up_at < WAKE_HEAL_COOLDOWN_MS) return false;
  return true;
}

const WOL_NOT_SET = 'WOL_BASE_URL / WOL_CLIENT_ID / WOL_CLIENT_SECRET not set';

export function wolConfigured(env: Bindings): boolean {
  return Boolean(env.WOL_BASE_URL && env.WOL_CLIENT_ID && env.WOL_CLIENT_SECRET);
}

function wolRequest(env: Bindings, method: 'GET' | 'POST', path: string): Promise<Response> | null {
  if (!env.WOL_BASE_URL || !env.WOL_CLIENT_ID || !env.WOL_CLIENT_SECRET) return null;
  return fetch(`${env.WOL_BASE_URL.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      'CF-Access-Client-Id': env.WOL_CLIENT_ID,
      'CF-Access-Client-Secret': env.WOL_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(WOL_TIMEOUT_MS),
  });
}

/** Retry-After は秒数か HTTP-date。読めなければ null。 */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** `POST /wake`。200（online）も 202（起動を開始）も成功。 */
export async function postWake(env: Bindings): Promise<WakeResult> {
  try {
    const pending = wolRequest(env, 'POST', '/wake');
    if (!pending) return { ok: false, status: null, retry_after_ms: null, error: WOL_NOT_SET };
    const res = await pending;
    if (res.ok) return { ok: true, status: res.status };
    const retryAfter = res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After'), Date.now()) : null;
    return { ok: false, status: res.status, retry_after_ms: retryAfter, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, retry_after_ms: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export type GpuState = 'online' | 'going_to_sleep' | 'sleeping' | 'offline' | 'waking';

export interface GpuStatus {
  state: GpuState | string;
  since: string | null;
  reason: string | null;
  last_seen: string | null;
}

/** `GET /status`。secret 未設定・タイムアウト・非 2xx・形の崩れた応答は理由付きのエラーで返す。 */
export async function getGpuStatus(env: Bindings): Promise<{ ok: true; status: GpuStatus } | { ok: false; error: string }> {
  try {
    const pending = wolRequest(env, 'GET', '/status');
    if (!pending) return { ok: false, error: WOL_NOT_SET };
    const res = await pending;
    if (!res.ok) return { ok: false, error: `wol status returned HTTP ${res.status}` };
    const body = (await res.json()) as Partial<Record<keyof GpuStatus, unknown>>;
    if (typeof body.state !== 'string') return { ok: false, error: 'wol status response has no state' };
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      ok: true,
      status: { state: body.state, since: str(body.since), reason: str(body.reason), last_seen: str(body.last_seen) },
    };
  } catch (err) {
    return { ok: false, error: `wol status request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
