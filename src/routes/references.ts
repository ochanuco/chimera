import { Hono } from 'hono';
import { createRequest, defaultRecipeRef } from '../lib/requests';
import { payloadEnvelopeIssues } from '../lib/request-payload';
import { MAX_REFERENCE_IMAGE_BYTES, referenceImageKey, sniffReferenceImageType } from '../lib/reference-images';
import { notifyHub, runInBackground } from '../lib/hub-notify';
import { serializeRequest } from '../lib/serialize';
import { badRequest } from '../lib/errors';
import { ValidationError } from '../lib/validate';
import type { AppEnv } from '../types';

/** 参考画像から描く Request の作成口 (docs/worker-protocol.md「reference」)。Generation は作らない。 */
export const references = new Hono<AppEnv>();

const REFERENCE_RECIPE = 'yukari';

references.post('/', async (c) => {
  const form = await c.req.parseBody();
  const image = form['image'];
  const idempotencyKey = form['idempotency_key'];
  const seedRaw = form['seed'];

  if (!(image instanceof File)) throw badRequest('image field is required and must be binary');
  if (typeof idempotencyKey !== 'string' || idempotencyKey === '') throw badRequest('idempotency_key is required');
  if (seedRaw !== undefined && typeof seedRaw !== 'string') throw badRequest('seed must be a string field');
  if (image.size > MAX_REFERENCE_IMAGE_BYTES) throw badRequest(`image is over ${MAX_REFERENCE_IMAGE_BYTES} bytes`);

  const bytes = new Uint8Array(await image.arrayBuffer());
  const contentType = sniffReferenceImageType(bytes);
  if (!contentType) throw badRequest('image must be png, jpeg or webp');

  const seedText = seedRaw?.trim() ?? '';
  const payload: Record<string, unknown> = { recipe: REFERENCE_RECIPE };
  if (seedText !== '') {
    if (!/^\d+$/.test(seedText)) throw badRequest('seed must be a non-negative integer');
    payload.seed = Number(seedText);
  }
  const issues = payloadEnvelopeIssues('reference', payload);
  if (issues.length > 0) throw new ValidationError(issues);

  const db = c.env.DB;
  const { row, created } = await createRequest(
    db,
    { kind: 'reference', payload, idempotency_key: idempotencyKey, created_by: 'gui' },
    { defaultRecipeRef: defaultRecipeRef(c.env) },
  );

  // 行が key を確定してから置く。再送は、行を作った後に PUT が落ちた分だけ置き直す（終端の行は消した画像を戻さない）。
  const key = referenceImageKey(row.id);
  const settled = row.status === 'done' || row.status === 'failed' || row.status === 'cancelled';
  if (created || (!settled && !(await c.env.IMAGES.head(key)))) {
    await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
  }

  if (created) runInBackground(c, notifyHub(c.env, 'queued', row));
  return c.json(serializeRequest(row), created ? 201 : 200);
});
