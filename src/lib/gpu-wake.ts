// GPU 機（comfyui-recipes の worker が動く Windows 機）はジョブも入力も無いまま 10 分経つと自分でスリープし、
// 寝ている間は claim に来られない。どの経路のジョブも chimera のキューを通るので、起こす役は chimera が担う。
// wol API（https://wol.chanu.co、Access の service token `wol_client` だけを通す）は何度叩いても冪等なので、
// 事前の状態確認はしない。失敗しても呼び出し元（キュー投入）は落とさず、ログに残すだけにする。

import type { Bindings } from '../types';

const DEFAULT_WOL_BASE_URL = 'https://wol.chanu.co';
const WOL_TIMEOUT_MS = 5000;

export type GpuState = 'online' | 'going_to_sleep' | 'sleeping' | 'offline' | 'waking';

export interface GpuStatus {
  state: GpuState | string;
  since: string | null;
  reason: string | null;
  last_seen: string | null;
}

function wolRequest(env: Bindings, method: 'GET' | 'POST', path: string): Promise<Response> | null {
  if (!env.WOL_CLIENT_ID || !env.WOL_CLIENT_SECRET) return null;
  const base = env.WOL_BASE_URL ?? DEFAULT_WOL_BASE_URL;
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'CF-Access-Client-Id': env.WOL_CLIENT_ID,
      'CF-Access-Client-Secret': env.WOL_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(WOL_TIMEOUT_MS),
  });
}

/** `POST /wake`。online なら 200、それ以外は 202 で wol 側が online になるまでマジックパケットを再送する。 */
export async function wakeGpu(env: Bindings): Promise<void> {
  try {
    const pending = wolRequest(env, 'POST', '/wake');
    if (!pending) {
      console.warn('wakeGpu skipped: WOL_CLIENT_ID / WOL_CLIENT_SECRET not set');
      return;
    }
    const res = await pending;
    if (!res.ok) console.error(`wakeGpu failed: HTTP ${res.status}`);
  } catch (err) {
    console.error('wakeGpu failed', err);
  }
}

/** `GET /status`。secret 未設定・タイムアウト・非 2xx・形の崩れた応答は理由付きのエラーで返す。 */
export async function getGpuStatus(env: Bindings): Promise<{ ok: true; status: GpuStatus } | { ok: false; error: string }> {
  try {
    const pending = wolRequest(env, 'GET', '/status');
    if (!pending) return { ok: false, error: 'WOL_CLIENT_ID / WOL_CLIENT_SECRET not set' };
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
