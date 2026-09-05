// WorkerHub (docs/worker-protocol.md 段階3) の WebSocket push / 進捗中継のテスト。
//
// WebSocket は `app.request(url, { headers: { Upgrade: 'websocket' } }, env)` で開く。
// このハーネス (@cloudflare/vitest-plugin) は実 workerd 上で `app.request` をそのまま
// fetch handler に渡すため、返る Response が本物の `webSocket` (WebSocketPair の
// client 側) を持つ — SELF.fetch でも同様に動くことを確認済みだが、test/helpers.ts の
// 他のヘルパーと同じ app.request の流儀に揃えるためこちらを使う。
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { createGeneration, getJson, postJson, req } from './helpers';

const BASE = 'https://chimera.test';

beforeEach(async () => {
  // claim() はグローバルに最古の queued 行を掴む (test/requests.test.ts と同じ注記)。
  // hub のテストも claim / stale-requeue を経由するので、他テストの残骸を持ち込まない。
  await env.DB.prepare('DELETE FROM requests').run();
});

async function connectWs(path: string): Promise<WebSocket> {
  const res = await app.request(`${BASE}${path}`, { headers: { Upgrade: 'websocket' } }, env);
  if (res.status !== 101 || !res.webSocket) {
    throw new Error(`expected a WebSocket upgrade, got ${res.status}`);
  }
  const ws = res.webSocket;
  ws.accept();
  return ws;
}

interface Tracker {
  messages: Record<string, unknown>[];
  waitFor: (pred: (m: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

/** 受信したフレームを都度JSONにパースして貯め、条件に合うものを (既に来ていれば即座に、なければ待って) 返す。 */
function trackMessages(ws: WebSocket): Tracker {
  const messages: Record<string, unknown>[] = [];
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];

  ws.addEventListener('message', (ev) => {
    let data: unknown;
    try {
      data = JSON.parse(String((ev as MessageEvent).data));
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    const msg = data as Record<string, unknown>;
    messages.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(msg)) {
        waiters[i]!.resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  function waitFor(pred: (m: Record<string, unknown>) => boolean, timeoutMs = 2000): Promise<Record<string, unknown>> {
    const found = messages.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a matching message')), timeoutMs);
      waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  return { messages, waitFor };
}

function hello(ws: WebSocket, workerId: string, kinds?: ('generate' | 'finalize')[]): void {
  ws.send(JSON.stringify({ type: 'hello', worker_id: workerId, kinds }));
}

function generateRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'generate',
    payload: {
      schema_version: 1,
      request: { instruction: 'hub test', count: 1 },
      generation: { recipe: 'yukari', parameters: {} },
    },
    idempotency_key: crypto.randomUUID(),
    created_by: 'brain',
    ...overrides,
  };
}

async function createFinalizeRequest(generationId: string) {
  return postJson<{ id: string; kind: string; status: string }>('/api/v1/requests', {
    kind: 'finalize',
    payload: { generation_id: generationId, options: { repin: true } },
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
  });
}

describe('WorkerHub (WebSocket, docs/worker-protocol.md 段階3)', () => {
  it('hello -> hello_ack', async () => {
    const ws = await connectWs('/api/v1/worker/ws');
    const t = trackMessages(ws);
    hello(ws, 'w1', ['generate', 'finalize']);
    const ack = await t.waitFor((m) => m.type === 'hello_ack');
    expect(typeof ack.server_time).toBe('string');
    ws.close();
  });

  it('POST /api/v1/requests -> connected worker gets queued, viewer gets status queued', async () => {
    const worker = await connectWs('/api/v1/worker/ws');
    const workerT = trackMessages(worker);
    hello(worker, 'w1', ['generate', 'finalize']);
    await workerT.waitFor((m) => m.type === 'hello_ack');

    const viewer = await connectWs('/api/v1/requests/ws');
    const viewerT = trackMessages(viewer);
    await viewerT.waitFor((m) => m.type === 'snapshot');

    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    expect(created.status).toBe(201);
    const requestId = created.body.id;

    const queuedMsg = await workerT.waitFor((m) => m.type === 'queued' && m.request_id === requestId);
    expect(queuedMsg.kind).toBe('finalize');

    const statusMsg = await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId);
    expect(statusMsg.status).toBe('queued');
    expect(statusMsg.kind).toBe('finalize');

    worker.close();
    viewer.close();
  });

  it('worker progress -> viewer gets progress with worker_id; a later viewer gets it via snapshot', async () => {
    const worker = await connectWs('/api/v1/worker/ws');
    const workerT = trackMessages(worker);
    hello(worker, 'w-progress', ['generate', 'finalize']);
    await workerT.waitFor((m) => m.type === 'hello_ack');

    const viewer = await connectWs('/api/v1/requests/ws');
    const viewerT = trackMessages(viewer);
    await viewerT.waitFor((m) => m.type === 'snapshot');

    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    const requestId = created.body.id;
    await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId);

    worker.send(JSON.stringify({ type: 'progress', request_id: requestId, phase: 'sampling', step: 3, total: 10 }));

    const progressMsg = await viewerT.waitFor((m) => m.type === 'progress' && m.request_id === requestId);
    expect(progressMsg.worker_id).toBe('w-progress');
    expect(progressMsg.phase).toBe('sampling');
    expect(progressMsg.step).toBe(3);
    expect(progressMsg.total).toBe(10);

    const lateViewer = await connectWs('/api/v1/requests/ws');
    const lateViewerT = trackMessages(lateViewer);
    const snapshot = await lateViewerT.waitFor((m) => m.type === 'snapshot');
    const progressList = snapshot.progress as { request_id: string; phase: string }[];
    expect(progressList.some((p) => p.request_id === requestId && p.phase === 'sampling')).toBe(true);

    worker.close();
    viewer.close();
    lateViewer.close();
  });

  it('claim -> viewer gets status running', async () => {
    const viewer = await connectWs('/api/v1/requests/ws');
    const viewerT = trackMessages(viewer);
    await viewerT.waitFor((m) => m.type === 'snapshot');

    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    const requestId = created.body.id;
    await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId && m.status === 'queued');

    const claimed = await postJson('/api/v1/requests/claim', { worker_id: 'w-claim' });
    expect(claimed.status).toBe(200);

    const runningMsg = await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId && m.status === 'running');
    expect(runningMsg.kind).toBe('finalize');

    viewer.close();
  });

  it('PATCH done -> viewer gets status done and the progress entry disappears from GET /state', async () => {
    const worker = await connectWs('/api/v1/worker/ws');
    hello(worker, 'w-done', ['finalize']);

    const viewer = await connectWs('/api/v1/requests/ws');
    const viewerT = trackMessages(viewer);
    await viewerT.waitFor((m) => m.type === 'snapshot');

    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    const requestId = created.body.id;
    await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId && m.status === 'queued');

    const claimed = await postJson('/api/v1/requests/claim', { worker_id: 'w-done' });
    expect(claimed.status).toBe(200);
    await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId && m.status === 'running');

    worker.send(JSON.stringify({ type: 'progress', request_id: requestId, phase: 'finalize' }));
    await viewerT.waitFor((m) => m.type === 'progress' && m.request_id === requestId);

    const done = await postJson(
      `/api/v1/requests/${requestId}`,
      { status: 'done', worker_id: 'w-done', result: { batch_id: 'whatever', generation_ids: [] } },
      'PATCH',
    );
    expect(done.status).toBe(200);

    const doneMsg = await viewerT.waitFor((m) => m.type === 'status' && m.request_id === requestId && m.status === 'done');
    expect(doneMsg.kind).toBe('finalize');

    const stub = env.WORKER_HUB.get(env.WORKER_HUB.idFromName('global'));
    const stateRes = await stub.fetch('https://hub/state');
    const state = (await stateRes.json()) as { progress: { request_id: string }[] };
    expect(state.progress.find((p) => p.request_id === requestId)).toBeUndefined();

    worker.close();
    viewer.close();
  });

  it('kinds filtering: a worker with kinds ["finalize"] does not get a generate queued', async () => {
    const worker = await connectWs('/api/v1/worker/ws');
    const workerT = trackMessages(worker);
    hello(worker, 'w-finalize-only', ['finalize']);
    await workerT.waitFor((m) => m.type === 'hello_ack');

    const created = await postJson<{ id: string }>('/api/v1/requests', generateRequestBody());
    expect(created.status).toBe(201);
    const requestId = created.body.id;

    // 届かないことの確認: 十分待っても messages に現れないことを見る (waitFor のタイムアウトは使わない —
    // 届かないのが正しい結果なので、待ちきる方を積極的に待たない)。
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(workerT.messages.find((m) => m.type === 'queued' && m.request_id === requestId)).toBeUndefined();

    worker.close();
  });

  it('non-upgrade GET -> 426 upgrade_required', async () => {
    const workerRes = await req('/api/v1/worker/ws');
    expect(workerRes.status).toBe(426);
    const workerBody = (await workerRes.json()) as { error: { code: string } };
    expect(workerBody.error.code).toBe('upgrade_required');

    const viewerRes = await req('/api/v1/requests/ws');
    expect(viewerRes.status).toBe(426);
  });

  it('alarm requeues a stale running row and notifies a connected worker', async () => {
    const worker = await connectWs('/api/v1/worker/ws');
    const workerT = trackMessages(worker);
    // hello の受信は ensureAlarmScheduled も走らせる。
    hello(worker, 'w-alarm', ['finalize']);
    await workerT.waitFor((m) => m.type === 'hello_ack');

    const { generation } = await createGeneration();
    const created = await createFinalizeRequest(generation.id);
    const requestId = created.body.id;
    const claimed = await postJson('/api/v1/requests/claim', { worker_id: 'w-alarm' });
    expect(claimed.status).toBe(200);

    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE requests SET heartbeat_at = ? WHERE id = ?').bind(staleHeartbeat, requestId).run();

    const stub = env.WORKER_HUB.get(env.WORKER_HUB.idFromName('global'));
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const after = await getJson<{ status: string; attempt: number }>(`/api/v1/requests/${requestId}`);
    expect(after.body.status).toBe('queued');
    expect(after.body.attempt).toBe(1); // claim 済みの1回のみ (alarm の回収は attempt を進めない)

    const queuedMsg = await workerT.waitFor((m) => m.type === 'queued' && m.request_id === requestId);
    expect(queuedMsg.kind).toBe('finalize');

    worker.close();
  });
});
