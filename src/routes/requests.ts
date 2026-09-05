import { Hono } from 'hono';
import { createRequestSchema, claimRequestSchema, updateRequestSchema, requestKindSchema, requestStatusSchema } from '../schemas/requests';
import { createRequest, listRequests, claimRequest, updateRequest, getRequestOr404, defaultRecipeRef } from '../lib/requests';
import { serializeRequest } from '../lib/serialize';
import { parsePagination } from '../lib/db';
import { badRequest } from '../lib/errors';
import type { AppEnv, RequestKind, RequestStatus } from '../types';

export const requests = new Hono<AppEnv>();

requests.post('/', async (c) => {
  const body = createRequestSchema.parse(await c.req.json());
  const db = c.env.DB;
  const { row, created } = await createRequest(db, body, { defaultRecipeRef: defaultRecipeRef(c.env) });
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
  const row = await claimRequest(db, body.worker_id, body.kinds);
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
  return c.json(serializeRequest(updated));
});
