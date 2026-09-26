// WebSocket upgrade は単一 WorkerHub DO (src/worker-hub.ts) へ転送するだけ。role はこの
// サーバー側コードが決め、client からは信用しない — worker/viewer でパスを分ける理由。
import type { Context } from 'hono';
import { getWorkerHubStub } from '../worker-hub';
import type { AppEnv } from '../types';

const UPGRADE_REQUIRED = { error: { code: 'upgrade_required', message: 'expected a WebSocket upgrade request' } } as const;

async function upgradeToHub(c: Context<AppEnv>, role: 'worker' | 'viewer'): Promise<Response> {
  if ((c.req.header('upgrade') ?? '').toLowerCase() !== 'websocket') {
    return c.json(UPGRADE_REQUIRED, 426);
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Chimera-Ws-Role', role);
  const forwarded = new Request(c.req.raw, { headers });
  return getWorkerHubStub(c.env).fetch(forwarded);
}

/** GET /api/v1/worker/ws */
export function workerWs(c: Context<AppEnv>): Promise<Response> {
  return upgradeToHub(c, 'worker');
}

/** GET /api/v1/requests/ws。登録順の制約は src/routes/requests.ts 参照。 */
export function viewerWs(c: Context<AppEnv>): Promise<Response> {
  return upgradeToHub(c, 'viewer');
}
