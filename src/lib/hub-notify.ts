// requests 行のライフサイクルを WorkerHub DO (src/worker-hub.ts) に知らせる。hub は通知路であって
// 正本ではないので、失敗しても呼び出し元の HTTP レスポンスは落とさず try/catch で握りつぶす。
// env を必要とするため routes / mcp からだけ呼ぶ（lib/requests.ts・lib/experiments.ts からは呼ばない）。

import { getWorkerHubStub } from '../worker-hub';
import { wakeGpu } from './gpu-wake';
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

/**
 * 新しく作った requests 行の通知。hub への 'queued' に加え、worker が claim する行（status queued）なら
 * スリープ中の GPU 機を起こす。claim 時の stale 戻しは claim した worker が起きているので notifyHub を直に使う。
 */
export async function notifyEnqueued(env: Bindings, request: HubNotifyRequest): Promise<void> {
  await Promise.all([notifyHub(env, 'queued', request), request.status === 'queued' ? wakeGpu(env) : undefined]);
}

export interface HubNotifyGeneration {
  generation_id: string;
  short_id: string;
  request_id: string | null;
  /** short_id of the raw Generation this Generation refines, or null for a raw Generation. */
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

/** 判定 (PUT /safety) が後から届いた Generation の viewer に、カードのバッジ更新を促す (docs/ui.md「Gallery」)。 */
export async function notifyHubSafety(env: Bindings, safety: { generation_id: string; short_id: string }): Promise<void> {
  try {
    const stub = getWorkerHubStub(env);
    await stub.fetch('https://hub/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'safety', generation_id: safety.generation_id, short_id: safety.short_id }),
    });
  } catch (err) {
    console.error('notifyHubSafety failed', err);
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
