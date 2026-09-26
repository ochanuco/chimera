// requests 行のライフサイクルを WorkerHub DO (src/worker-hub.ts) に知らせる。hub は通知路であって
// 正本ではないので、失敗しても呼び出し元の HTTP レスポンスは落とさず try/catch で握りつぶす。
// env を必要とするため routes / mcp からだけ呼ぶ（lib/requests.ts・lib/experiments.ts からは呼ばない）。

import { getWorkerHubStub } from '../worker-hub';
import type { Bindings, RequestKind, RequestStatus } from '../types';

export type HubNotifyType = 'queued' | 'status';

/** waitUntil だけを要求する最小の型。Hono の `Context.executionCtx` と Worker 本体の `ExecutionContext` は構造が食い違うため、両方を満たす最小形をここで定義する。 */
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

export interface HubNotifyGeneration {
  generation_id: string;
  short_id: string;
  batch_id: string;
  /** short_id of the raw Generation this Generation's Batch refines, or null for a raw Generation. */
  refines_generation_short_id: string | null;
  created_at: string;
}

/** Notifies viewers of a freshly-ingested Generation (Gallery live insertion, docs/ui.md「Gallery」). */
export async function notifyHubGeneration(env: Bindings, generation: HubNotifyGeneration): Promise<void> {
  try {
    const stub = getWorkerHubStub(env);
    await stub.fetch('https://hub/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'generation', generation }),
    });
  } catch (err) {
    console.error('notifyHub failed', err);
  }
}

/** `c.executionCtx` はテストハーネスでは未設定でアクセスすると例外を投げる。本番では waitUntil に積んで通知のレイテンシをレスポンスに乗せない。 */
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
