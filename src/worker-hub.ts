// WorkerHub (docs/worker-protocol.md 段階3): requests キューの push / 進捗中継用 Durable
// Object。正本は D1 のまま — このオブジェクトは通知路であって状態の正本ではない
// (`progress:<request_id>` の DO storage エントリも、viewer が後から繋いだときの
// snapshot 用キャッシュに過ぎない)。
//
// 単一インスタンスを `idFromName('global')` で運用する。Hibernation API を使うので
// 接続数が多くても課金対象の起動時間は増えない。

import { DurableObject } from 'cloudflare:workers';
import { nowIso } from './lib/db';
import { requeueStaleRunning } from './lib/requests';
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
  type: 'queued' | 'status';
  request: { id: string; kind: RequestKind; recipe_ref: string; status: string };
}

const ALARM_INTERVAL_MS = 60_000;
const PROGRESS_PREFIX = 'progress:';
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

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
  if (!attachment || !attachment.kinds) return true; // hello 未送信の worker は全種を受け取る
  return attachment.kinds.includes(kind);
}

export class WorkerHub extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // ping/pong は Hibernation の auto-response に任せ、DO を起こさない
    // (worker-protocol.md「Messages」節)。
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
    } else {
      const attachment: ViewerAttachment = { role: 'viewer', connected_at: now };
      server.serializeAttachment(attachment);
      void this.sendSnapshot(server);
    }
    void this.ensureAlarmScheduled();

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

  /** 各ソケットへの送信失敗 (閉じている等) を個別に握りつぶす。戻り値は実際に送れた数。 */
  private broadcast(sockets: WebSocket[], data: unknown): number {
    const text = JSON.stringify(data);
    let sent = 0;
    for (const ws of sockets) {
      try {
        ws.send(text);
        sent += 1;
      } catch {
        // ignore — per-socket failure only.
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
      return; // unparsable frame -> ignore (worker-protocol.md「Messages」節)
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
    // unknown type -> ignore
  }

  private async handleHello(ws: WebSocket, body: { worker_id?: unknown; kinds?: unknown }): Promise<void> {
    const workerId = typeof body.worker_id === 'string' ? body.worker_id : null;
    const kinds = Array.isArray(body.kinds)
      ? body.kinds.filter((k): k is RequestKind => k === 'generate' || k === 'finalize')
      : null;
    const prev = readAttachment(ws) as WorkerAttachment | null;
    const attachment: WorkerAttachment = {
      role: 'worker',
      worker_id: workerId,
      kinds,
      connected_at: prev?.connected_at ?? nowIso(),
    };
    ws.serializeAttachment(attachment);
    await this.ensureAlarmScheduled();
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
    // 1005/1006 (no status / abnormal) はクライアントが実際に送ってくるコードでは
    // あり得るが、close() に渡すと invalid code として例外になる。素の close() に
    // 落として、下位のソケット解放だけ行う。
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
    const req = body.request;
    let workersSent = 0;
    let viewersSent = 0;

    if (body.type === 'queued') {
      const workers = this.ctx.getWebSockets('worker').filter((ws) => acceptsKind(readAttachment(ws) as WorkerAttachment | null, req.kind));
      workersSent = this.broadcast(workers, { type: 'queued', request_id: req.id, kind: req.kind, recipe_ref: req.recipe_ref });
      viewersSent = this.broadcast(this.ctx.getWebSockets('viewer'), {
        type: 'status',
        request_id: req.id,
        status: 'queued',
        kind: req.kind,
      });
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

    await this.ensureAlarmScheduled();
    return Response.json({ workers: workersSent, viewers: viewersSent });
  }

  private async handleState(): Promise<Response> {
    return Response.json({
      workers: this.listWorkers(),
      viewers: this.ctx.getWebSockets('viewer').length,
      progress: await this.listProgress(),
    });
  }

  private async ensureAlarmScheduled(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  /** stale running の回収 (claimRequest と同じ規則、src/lib/requests.ts の requeueStaleRunning)。 */
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
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }
}
