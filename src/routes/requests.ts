import { Hono } from 'hono';
import { createRequestSchema, claimRequestSchema, updateRequestSchema, requestKindSchema, requestStatusSchema } from '../schemas/requests';
import { createRequest, listRequests, claimRequest, updateRequest, getRequestOr404, defaultRecipeRef } from '../lib/requests';
import { notifyHub, runInBackground } from '../lib/hub-notify';
import { viewerWs } from './worker-hub';
import { serializeRequest } from '../lib/serialize';
import { parsePagination } from '../lib/db';
import { badRequest } from '../lib/errors';
import type { AppEnv, RequestKind, RequestStatus } from '../types';

export const requests = new Hono<AppEnv>();

// GET /api/v1/requests/ws (段階3 WorkerHub の viewer 接続) は下の GET /:id より前に
// 登録すること — Hono のルーターは登録順で "ws" が :id にマッチするのを防ぐ。
requests.get('/ws', viewerWs);

requests.post('/', async (c) => {
  const body = createRequestSchema.parse(await c.req.json());
  const db = c.env.DB;
  const { row, created } = await createRequest(db, body, { defaultRecipeRef: defaultRecipeRef(c.env) });
  if (created) runInBackground(c, notifyHub(c.env, 'queued', row));
  return c.json(serializeRequest(row), created ? 201 : 200);
});

requests.get('/', async (c) => {
  const db = c.env.DB;
  const query = c.req.query();
  const { limit, offset } = parsePagination(query);

  // ?pending=true は status=queued の別名 (worker-protocol.md「List Requests」)。
  let status: RequestStatus | undefined;
  if (query.pending === 'true') {
    status = 'queued';
  } else if (query.status) {
    const parsed = requestStatusSchema.safeParse(query.status);
    if (!parsed.success) throw badRequest(`invalid status '${query.status}'`);
    status = parsed.data;
  }

  let kind: RequestKind | undefined;
  if (query.kind) {
    const parsed = requestKindSchema.safeParse(query.kind);
    if (!parsed.success) throw badRequest(`invalid kind '${query.kind}'`);
    kind = parsed.data;
  }

  const rows = await listRequests(
    db,
    { status, kind, run_id: query.run_id, generation_id: query.generation_id, batch_id: query.batch_id },
    limit,
    offset,
  );
  return c.json({ items: rows.map(serializeRequest) });
});

requests.post('/claim', async (c) => {
  const body = claimRequestSchema.parse(await c.req.json());
  const db = c.env.DB;
  const { row, requeued } = await claimRequest(db, body.worker_id, body.kinds);
  for (const r of requeued) {
    runInBackground(c, notifyHub(c.env, r.status === 'failed' ? 'status' : 'queued', r));
  }
  if (row) runInBackground(c, notifyHub(c.env, 'status', row));
  if (!row) return c.body(null, 204);
  return c.json(serializeRequest(row), 200);
});

requests.get('/:id', async (c) => {
  const db = c.env.DB;
  const row = await getRequestOr404(db, c.req.param('id'));
  return c.json(serializeRequest(row));
});

requests.patch('/:id', async (c) => {
  const body = updateRequestSchema.parse(await c.req.json());
  const db = c.env.DB;
  const row = await getRequestOr404(db, c.req.param('id'));
  const updated = await updateRequest(db, row, body);
  if (updated.status === 'done' || updated.status === 'failed' || updated.status === 'cancelled') {
    runInBackground(c, notifyHub(c.env, 'status', updated));
  }
  return c.json(serializeRequest(updated));
});
