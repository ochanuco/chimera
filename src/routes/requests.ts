import { Hono } from 'hono';
import { createRequestSchema, putResolutionSchema, claimRequestSchema, updateRequestSchema, requestKindFilterSchema, requestStatusSchema } from '../schemas/requests';
import {
  createRequest,
  listRequests,
  claimRequest,
  updateRequest,
  getRequestOr404,
  defaultRecipeRef,
  summarizeRequests,
  type RequestSummaryWorker,
} from '../lib/requests';
import { putTimingsSchema } from '../schemas/timings';
import { putRequestTimings } from '../lib/timings';
import { createJobSchema } from '../schemas/jobs';
import { buildRequestJobs, createRequestJob, putResolution } from '../lib/request-resolution';
import { notifyHub, notifyHubWorkerSeen, runInBackground } from '../lib/hub-notify';
import { viewerWs } from './worker-hub';
import { deleteSettledReferenceImages, referenceImageKey } from '../lib/reference-images';
import { getWorkerHubStub } from '../worker-hub';
import { serializeRequest } from '../lib/serialize';
import { nowIso, parsePagination } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { generatePayloadPatches } from '../lib/patch-grammar';
import { parseOrThrow, validate } from '../lib/validate';
import type { AppEnv, RequestKind, RequestStatus } from '../types';

export const requests = new Hono<AppEnv>();

// GET /:id より前に登録すること — Hono は登録順で "ws" が :id にマッチしてしまう。
requests.get('/ws', viewerWs);

requests.post('/', async (c) => {
  const body = parseOrThrow(createRequestSchema, await c.req.json());
  const db = c.env.DB;
  const { kind, payload, recipe_ref, idempotency_key, created_by, status: _status, run_id, ...rest } = body;
  const resolution = kind === 'import' ? { ...rest, parameters: rest.parameters! } : undefined;
  const { row, created } = await createRequest(
    db,
    { kind, payload, recipe_ref, idempotency_key, created_by, resolution, run_id },
    { defaultRecipeRef: defaultRecipeRef(c.env), checkPatches: generatePayloadPatches(kind, payload) },
  );
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
    const parsed = validate(requestStatusSchema, query.status);
    if (!parsed.ok) throw badRequest(`invalid status '${query.status}'`);
    status = parsed.value;
  }

  let kind: RequestKind | undefined;
  if (query.kind) {
    const parsed = validate(requestKindFilterSchema, query.kind);
    if (!parsed.ok) throw badRequest(`invalid kind '${query.kind}'`);
    kind = parsed.value;
  }

  const rows = await listRequests(
    db,
    { status, kind, run_id: query.run_id, worker_id: query.worker_id, generation_id: query.generation_id },
    limit,
    offset,
  );
  return c.json({ items: rows.map(serializeRequest) });
});

requests.post('/claim', async (c) => {
  const body = parseOrThrow(claimRequestSchema, await c.req.json());
  const db = c.env.DB;
  const { row, requeued } = await claimRequest(db, body.worker_id, body.kinds);
  // 戻した行の queued より先に worker_seen を届け、claim した worker のために GPU 機を起こさない。
  const env = c.env;
  runInBackground(
    c,
    notifyHubWorkerSeen(env).then(() =>
      Promise.all(requeued.map((r) => notifyHub(env, r.status === 'failed' ? 'status' : 'queued', r))),
    ),
  );
  await deleteSettledReferenceImages(env.IMAGES, requeued);
  if (row) runInBackground(c, notifyHub(c.env, 'status', row));
  if (!row) return c.body(null, 204);
  return c.json(serializeRequest(row), 200);
});

// GET /api/v1/requests/summary も同じ理由で GET /:id より前に登録する。
requests.get('/summary', async (c) => {
  const db = c.env.DB;
  const { counts, groups } = await summarizeRequests(db, nowIso());

  let workers: RequestSummaryWorker[] = [];
  try {
    const res = await getWorkerHubStub(c.env).fetch('https://hub/state');
    if (res.ok) {
      const state = (await res.json()) as { workers: RequestSummaryWorker[] };
      workers = state.workers ?? [];
    }
  } catch {
    workers = [];
  }

  return c.json({ counts, workers, groups });
});

requests.get('/:id', async (c) => {
  const db = c.env.DB;
  const row = await getRequestOr404(db, c.req.param('id'));
  return c.json(serializeRequest(row));
});

requests.put('/:id/resolution', async (c) => {
  const { worker_id, ...input } = parseOrThrow(putResolutionSchema, await c.req.json());
  const db = c.env.DB;
  const row = await getRequestOr404(db, c.req.param('id'));
  await putResolution(db, row, input, worker_id);
  const current = await getRequestOr404(db, row.id);
  return c.json({ id: current.id, short_id: current.short_id, status: current.status, jobs: await buildRequestJobs(db, current.id) });
});

requests.put('/:id/timings', async (c) => {
  const body = parseOrThrow(putTimingsSchema, await c.req.json());
  await putRequestTimings(c.env.DB, c.req.param('id'), body);
  return c.json({ ok: true });
});

requests.post('/:id/jobs', async (c) => {
  const body = parseOrThrow(createJobSchema, await c.req.json());
  const db = c.env.DB;
  const row = await getRequestOr404(db, c.req.param('id'));
  const { status, job } = await createRequestJob(db, row, body);
  return c.json(job, status);
});

requests.patch('/:id', async (c) => {
  const body = parseOrThrow(updateRequestSchema, await c.req.json());
  const db = c.env.DB;
  const row = await getRequestOr404(db, c.req.param('id'));
  const updated = await updateRequest(db, row, body);
  await deleteSettledReferenceImages(c.env.IMAGES, [updated]);
  if (updated.status === 'done' || updated.status === 'failed' || updated.status === 'cancelled') {
    runInBackground(c, notifyHub(c.env, 'status', updated));
  }
  return c.json(serializeRequest(updated));
});

/** worker が参考画像を読む。kind reference 以外と、画像が無い（消した・置く前）ときは 404。 */
requests.get('/:id/reference-image', async (c) => {
  const row = await getRequestOr404(c.env.DB, c.req.param('id'));
  if (row.kind !== 'reference') throw notFound('reference image');
  const object = await c.env.IMAGES.get(referenceImageKey(row.id));
  if (!object) throw notFound('reference image');
  return c.body(object.body, 200, { 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream' });
});

/** worker が使い終えた参考画像を消す。冪等で、画像が無くても 204。 */
requests.delete('/:id/reference-image', async (c) => {
  const row = await getRequestOr404(c.env.DB, c.req.param('id'));
  if (row.kind !== 'reference') throw notFound('reference image');
  await c.env.IMAGES.delete(referenceImageKey(row.id));
  return c.body(null, 204);
});
