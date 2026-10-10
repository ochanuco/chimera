// requests キューの push / 進捗中継用 Durable Object。正本は D1 — このオブジェクトは通知路であって
// 状態の正本ではない（progress cache も viewer 再接続時の snapshot 用に過ぎない）。単一インスタンス
// (idFromName('global')) を Hibernation API 上で運用するため、接続数が多くても課金対象の起動時間は増えない。

import { DurableObject } from 'cloudflare:workers';
import { nowIso } from './lib/db';
import {
  applyWakeResult,
  beginWakeSend,
  postWake,
  requestWake,
  shouldHealWake,
  WAKE_SUCCESS_INTERVAL_MS,
  wolConfigured,
  type WakeState,
} from './lib/gpu-wake';
import { queuedAgeForWake, requeueStaleRunning } from './lib/requests';
import type { Bindings, RequestKind } from './types';

type Role = 'worker' | 'viewer';

interface WorkerAttachment {
  role: 'worker';
  worker_id: string | null;
  /** hello 未受信なら null — その worker は全 kind の queued を受け取る。 */
  kinds: RequestKind[] | null;
  connected_at: string;
}

interface ViewerAttachment {
  role: 'viewer';
  connected_at: string;
}

type Attachment = WorkerAttachment | ViewerAttachment;

interface ProgressEntry {
  request_id: string;
  worker_id: string | null;
  phase: string;
  step: number | null;
  total: number | null;
  message: string | null;
  at: string;
}

interface NotifyBody {
  type: 'queued' | 'status' | 'generation' | 'safety' | 'worker_seen';
  generation_id?: string;
  short_id?: string;
  request?: { id: string; kind: RequestKind; recipe_ref: string; status: string };
  generation?: {
    generation_id: string;
    short_id: string;
    request_id: string | null;
    refines_generation_short_id: string | null;
    created_at: string;
  };
}

const ALARM_INTERVAL_MS = 60_000;
const PROGRESS_PREFIX = 'progress:';
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);
const WAKE_KEY = 'wake';
const WORKER_SEEN_KEY = 'wake:worker_seen_at';
const WAKE_GAVE_UP_KEY = 'wake:gave_up_at';

export function getWorkerHubStub(env: Bindings) {
  return env.WORKER_HUB.get(env.WORKER_HUB.idFromName('global'));
}

function readAttachment(ws: WebSocket): Attachment | null {
  try {
    return ws.deserializeAttachment() as Attachment | null;
  } catch {
    return null;
  }
}

function acceptsKind(attachment: WorkerAttachment | null, kind: RequestKind): boolean {
  if (!attachment || !attachment.kinds) return true;
  return attachment.kinds.includes(kind);
}

export class WorkerHub extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // ping/pong は Hibernation の auto-response に任せ、DO を起こさない。
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/notify') {
      return this.handleNotify(request);
    }
    if (request.method === 'GET' && url.pathname === '/state') {
      return this.handleState();
    }

    const role = request.headers.get('X-Chimera-Ws-Role');
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket' || (role !== 'worker' && role !== 'viewer')) {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    return this.acceptConnection(role);
  }

  private acceptConnection(role: Role): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);

    const now = nowIso();
    if (role === 'worker') {
      const attachment: WorkerAttachment = { role: 'worker', worker_id: null, kinds: null, connected_at: now };
      server.serializeAttachment(attachment);
      void this.workerSeen();
    } else {
      const attachment: ViewerAttachment = { role: 'viewer', connected_at: now };
      server.serializeAttachment(attachment);
      void this.sendSnapshot(server);
    }
    void this.scheduleAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const progress = await this.listProgress();
    this.sendTo(ws, { type: 'snapshot', progress, workers: this.listWorkers() });
  }

  private listWorkers(): { worker_id: string | null; kinds: RequestKind[] | null; connected_at: string | null }[] {
    return this.ctx.getWebSockets('worker').map((ws) => {
      const att = readAttachment(ws) as WorkerAttachment | null;
      return { worker_id: att?.worker_id ?? null, kinds: att?.kinds ?? null, connected_at: att?.connected_at ?? null };
    });
  }

  private async listProgress(): Promise<ProgressEntry[]> {
    const map = await this.ctx.storage.list<ProgressEntry>({ prefix: PROGRESS_PREFIX });
    return Array.from(map.values());
  }

  private sendTo(ws: WebSocket, data: unknown): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // 閉じかけのソケットへの送信レース。webSocketClose 側で片付く。
    }
  }

  /** ソケットごとの送信失敗 (閉じている等) を個別に握りつぶし、他への送信は続ける。 */
  private broadcast(sockets: WebSocket[], data: unknown): number {
    const text = JSON.stringify(data);
    let sent = 0;
    for (const ws of sockets) {
      try {
        ws.send(text);
        sent += 1;
      } catch {
        // per-socket failure only.
      }
    }
    return sent;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      return; // unparsable frame -> ignore
    }
    if (!data || typeof data !== 'object') return;

    const attachment = readAttachment(ws);
    if (!attachment || attachment.role === 'viewer') return; // viewer からのメッセージは常に無視

    const type = (data as { type?: unknown }).type;
    if (type === 'hello') {
      await this.handleHello(ws, data as { worker_id?: unknown; kinds?: unknown });
      return;
    }
    if (type === 'progress') {
      await this.handleProgress(attachment, data as Record<string, unknown>);
      return;
    }
    if (type === 'ping') {
      // 通常は setWebSocketAutoResponse が答えるので届かないが、念のため。
      this.sendTo(ws, { type: 'pong' });
      return;
    }
  }

  private async handleHello(ws: WebSocket, body: { worker_id?: unknown; kinds?: unknown }): Promise<void> {
    const workerId = typeof body.worker_id === 'string' ? body.worker_id : null;
    const kinds = Array.isArray(body.kinds)
      ? body.kinds.filter((k): k is RequestKind => k === 'generate' || k === 'redraw' || k === 'repair' || k === 'masked_redraw' || k === 'deliver' || k === 'dof')
      : null;
    const prev = readAttachment(ws) as WorkerAttachment | null;
    const attachment: WorkerAttachment = {
      role: 'worker',
      worker_id: workerId,
      kinds,
      connected_at: prev?.connected_at ?? nowIso(),
    };
    ws.serializeAttachment(attachment);
    await this.workerSeen();
    await this.scheduleAlarm();
    this.sendTo(ws, { type: 'hello_ack', server_time: nowIso() });
  }

  private async handleProgress(attachment: WorkerAttachment, body: Record<string, unknown>): Promise<void> {
    const requestId = typeof body.request_id === 'string' ? body.request_id : null;
    const phase = typeof body.phase === 'string' ? body.phase : null;
    if (!requestId || !phase) return;
    const entry: ProgressEntry = {
      request_id: requestId,
      worker_id: attachment.worker_id,
      phase,
      step: typeof body.step === 'number' ? body.step : null,
      total: typeof body.total === 'number' ? body.total : null,
      message: typeof body.message === 'string' ? body.message : null,
      at: nowIso(),
    };
    await this.ctx.storage.put(PROGRESS_PREFIX + requestId, entry);
    this.broadcast(this.ctx.getWebSockets('viewer'), { type: 'progress', ...entry });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 はクライアントが送ってくることがあるが、close() に渡すと invalid code
    // として例外になるため、無引数の close() にフォールバックする。
    try {
      ws.close(code, reason);
    } catch {
      try {
        ws.close();
      } catch {
        // socket already gone — nothing to do.
      }
    }
  }

  async webSocketError(): Promise<void> {
    // Hibernation API がソケットとそのメタデータを片付ける。ここでは何もしない。
  }

  private async handleNotify(request: Request): Promise<Response> {
    const body = (await request.json()) as NotifyBody;
    let workersSent = 0;
    let viewersSent = 0;

    if (body.type === 'generation') {
      const g = body.generation;
      if (g) {
        viewersSent = this.broadcast(this.ctx.getWebSockets('viewer'), {
          type: 'generation',
          generation_id: g.generation_id,
          short_id: g.short_id,
          request_id: g.request_id,
          refines_generation_short_id: g.refines_generation_short_id,
          created_at: g.created_at,
        });
      }
      await this.scheduleAlarm();
      return Response.json({ workers: workersSent, viewers: viewersSent });
    }

    if (body.type === 'worker_seen') {
      await this.workerSeen();
      return Response.json({ workers: workersSent, viewers: viewersSent });
    }

    if (body.type === 'safety') {
      if (body.generation_id && body.short_id) {
        viewersSent = this.broadcast(this.ctx.getWebSockets('viewer'), {
          type: 'safety',
          generation_id: body.generation_id,
          short_id: body.short_id,
        });
      }
      return Response.json({ workers: workersSent, viewers: viewersSent });
    }

    const req = body.request;
    if (!req) return Response.json({ workers: workersSent, viewers: viewersSent });

    if (body.type === 'queued') {
      const workers = this.ctx.getWebSockets('worker').filter((ws) => acceptsKind(readAttachment(ws) as WorkerAttachment | null, req.kind));
      workersSent = this.broadcast(workers, { type: 'queued', request_id: req.id, kind: req.kind, recipe_ref: req.recipe_ref });
      viewersSent = this.broadcast(this.ctx.getWebSockets('viewer'), {
        type: 'status',
        request_id: req.id,
        status: 'queued',
        kind: req.kind,
      });
      // kind=import は done で作られ、hub には queued として届くが worker は claim しない。
      if (req.status === 'queued') await this.requestWake();
    } else {
      viewersSent = this.broadcast(this.ctx.getWebSockets('viewer'), {
        type: 'status',
        request_id: req.id,
        status: req.status,
        kind: req.kind,
      });
      if (TERMINAL_STATUSES.has(req.status)) {
        await this.ctx.storage.delete(PROGRESS_PREFIX + req.id);
      }
    }

    await this.scheduleAlarm();
    return Response.json({ workers: workersSent, viewers: viewersSent });
  }

  private async handleState(): Promise<Response> {
    return Response.json({
      workers: this.listWorkers(),
      viewers: this.ctx.getWebSockets('viewer').length,
      progress: await this.listProgress(),
    });
  }

  /**
   * alarm は1つしか持てないので、stale running の回収（ALARM_INTERVAL_MS ごと）と GPU 機の起床の再送
   * （WakeState.next_at）のうち早い方に合わせる。既に早い alarm があれば動かさない。
   */
  private async scheduleAlarm(): Promise<void> {
    const wake = await this.ctx.storage.get<WakeState>(WAKE_KEY);
    const target = Math.min(Date.now() + ALARM_INTERVAL_MS, wake?.next_at ?? Number.POSITIVE_INFINITY);
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  /** 起床要求。送信そのものは alarm が行うので、ここは手順を始めて alarm を早めるだけ。 */
  private async requestWake(): Promise<void> {
    if (!wolConfigured(this.env)) return;
    const now = Date.now();
    const current = (await this.ctx.storage.get<WakeState>(WAKE_KEY)) ?? null;
    if (!current) {
      // claim した直後の worker は起きている。GPU 機のスリープはアイドル 10 分からなので 30 秒なら確実。
      const seenAt = await this.ctx.storage.get<number>(WORKER_SEEN_KEY);
      if (seenAt !== undefined && now - seenAt < WAKE_SUCCESS_INTERVAL_MS) return;
    }
    const next = requestWake(current, now);
    if (next === current) return;
    if (!current) console.log('wake started');
    await this.ctx.storage.put(WAKE_KEY, next);
    await this.scheduleAlarm();
  }

  private async workerSeen(): Promise<void> {
    const wake = await this.ctx.storage.get<WakeState>(WAKE_KEY);
    if (wake) console.log(`wake done: worker seen after ${Date.now() - wake.started_at}ms`);
    await this.ctx.storage.delete([WAKE_KEY, WAKE_GAVE_UP_KEY]);
    await this.ctx.storage.put(WORKER_SEEN_KEY, Date.now());
  }

  private async runWake(): Promise<void> {
    const stored = await this.ctx.storage.get<WakeState>(WAKE_KEY);
    if (!stored) return;
    // 送信中に DO が落ちて送信中の印だけ残った手順も、ここで送り直しに戻す。
    const now = Date.now();
    const sending = beginWakeSend(requestWake(stored, now), now);
    if (!sending) return;
    await this.ctx.storage.put(WAKE_KEY, sending);
    const result = await postWake(this.env);
    // 送信中に worker_seen が届いて手順が消えていれば結果は捨てる。
    const current = await this.ctx.storage.get<WakeState>(WAKE_KEY);
    if (!current || current.sending_since !== sending.sending_since) return;
    const doneAt = Date.now();
    if (!result.ok) console.error(`wake send failed (attempt ${current.failures + 1}): ${result.error}`);
    const applied = applyWakeResult(current, result, doneAt);
    if (applied.gaveUp) {
      console.error(`wake gave up: no worker within ${doneAt - current.started_at}ms`);
      await this.ctx.storage.delete(WAKE_KEY);
      await this.ctx.storage.put(WAKE_GAVE_UP_KEY, doneAt);
    } else if (applied.state) {
      await this.ctx.storage.put(WAKE_KEY, applied.state);
    }
  }

  private async healWake(): Promise<void> {
    if (!wolConfigured(this.env)) return;
    const [state, seenAt, gaveUpAt] = await Promise.all([
      this.ctx.storage.get<WakeState>(WAKE_KEY),
      this.ctx.storage.get<number>(WORKER_SEEN_KEY),
      this.ctx.storage.get<number>(WAKE_GAVE_UP_KEY),
    ]);
    if (state) return;
    const queue = await queuedAgeForWake(this.env.DB);
    const heal = shouldHealWake({
      state: state ?? null,
      now: Date.now(),
      last_worker_seen_at: seenAt ?? null,
      gave_up_at: gaveUpAt ?? null,
      oldest_queued_at: queue.oldest_queued_at ? Date.parse(queue.oldest_queued_at) : null,
      running: queue.running,
    });
    if (!heal) return;
    console.log(`wake heal: queued since ${queue.oldest_queued_at} without a worker`);
    await this.ctx.storage.put(WAKE_KEY, requestWake(null, Date.now()));
  }

  /** stale running を回収し (claimRequest と同じ規則)、GPU 機の起床を進める。 */
  async alarm(): Promise<void> {
    const rows = await requeueStaleRunning(this.env.DB, nowIso());
    for (const row of rows) {
      if (row.status === 'queued') {
        const workers = this.ctx.getWebSockets('worker').filter((ws) => acceptsKind(readAttachment(ws) as WorkerAttachment | null, row.kind));
        this.broadcast(workers, { type: 'queued', request_id: row.id, kind: row.kind, recipe_ref: row.recipe_ref });
        this.broadcast(this.ctx.getWebSockets('viewer'), { type: 'status', request_id: row.id, status: 'queued', kind: row.kind });
      } else {
        this.broadcast(this.ctx.getWebSockets('viewer'), { type: 'status', request_id: row.id, status: 'failed', kind: row.kind });
        await this.ctx.storage.delete(PROGRESS_PREFIX + row.id);
      }
    }
    await this.healWake();
    await this.runWake();
    await this.ctx.storage.deleteAlarm();
    await this.scheduleAlarm();
  }
}
