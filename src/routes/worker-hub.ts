// WebSocket upgrade エンドポイント (docs/worker-protocol.md 段階3)。実体は src/worker-hub.ts
// の単一 WorkerHub DO インスタンス — ここは Access の内側で受けたリクエストに role
// マーカーを付けて DO へ転送するだけ。role はこのサーバー側コードが決め、client
// からは信用しない (worker 用と viewer 用でパスが分かれているのはそのため)。
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

/**
 * GET /api/v1/requests/ws — src/routes/requests.ts の `GET /:id` より前に登録すること。
 * Hono のルーターは登録順を見るので、後に置くと "ws" が :id にマッチしてしまう。
 */
export function viewerWs(c: Context<AppEnv>): Promise<Response> {
  return upgradeToHub(c, 'viewer');
}
