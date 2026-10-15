import { Hono } from 'hono';
import { importComfyHistory } from '../lib/timings';
import { getStats } from '../lib/stats';
import { statsColdSchema, statsPeriodSchema } from '../schemas/timings';
import { badRequest } from '../lib/errors';
import { parseOrThrow } from '../lib/validate';
import type { AppEnv } from '../types';

export const timings = new Hono<AppEnv>();

timings.post('/import-comfy-history', async (c) => {
  const body: unknown = await c.req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('body must be a ComfyUI /history object');
  return c.json(await importComfyHistory(c.env.DB, body as Record<string, unknown>));
});

export const stats = new Hono<AppEnv>();

stats.get('/', async (c) => {
  const period = parseOrThrow(statsPeriodSchema, c.req.query('period') || undefined);
  const cold = parseOrThrow(statsColdSchema, c.req.query('cold') || undefined);
  return c.json(await getStats(c.env.DB, period, cold));
});
