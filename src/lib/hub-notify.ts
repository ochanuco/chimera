// requests 行のライフサイクルを WorkerHub DO (段階3, src/worker-hub.ts) に知らせる。
// hub は通知路であって正本ではないので、失敗しても呼び出し元の HTTP レスポンスは
// 落とさない — try/catch で握りつぶし console.error に出すだけ。
//
// env を必要とするため routes / mcp からだけ呼ぶ。lib/requests.ts や lib/experiments.ts
// (テストが env なしで直接叩く) からは呼ばない。

import { getWorkerHubStub } from '../worker-hub';
import type { Bindings, RequestKind, RequestStatus } from '../types';

export type HubNotifyType = 'queued' | 'status';

/**
 * waitUntil だけを要求する最小の型。呼び出し側は Hono の `Context.executionCtx`
 * (waitUntil + passThroughOnException) だったり、Worker 本体の `ExecutionContext`
 * (waitUntil + passThroughOnException + tracing + abort) だったりして構造が食い違うため、
 * 両方を構造的に満たす最小の形をここで定義する。
 */
export interface Waitable {
  waitUntil(promise: Promise<unknown>): void;
}

export interface HubNotifyRequest {
  id: string;
  kind: RequestKind;
  recipe_ref: string;
  status: RequestStatus;
}

export async function notifyHub(env: Bindings, type: HubNotifyType, request: HubNotifyRequest): Promise<void> {
  try {
    const stub = getWorkerHubStub(env);
    await stub.fetch('https://hub/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        request: { id: request.id, kind: request.kind, recipe_ref: request.recipe_ref, status: request.status },
      }),
    });
  } catch (err) {
    console.error('notifyHub failed', err);
  }
}

/**
 * `c.executionCtx` はテストハーネス (`app.request(url, init, env)`) では未設定で、
 * アクセスすると例外を投げる (src/app.ts の `/mcp` ハンドラと同じガード)。本番では
 * waitUntil に積んで通知のレイテンシをレスポンスに乗せない。
 */
export function runInBackground(c: { executionCtx: Waitable }, promise: Promise<unknown>): void {
  let ctx: Waitable | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx) {
    ctx.waitUntil(promise);
  } else {
    void promise;
  }
}
