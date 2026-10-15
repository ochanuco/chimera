import { Hono } from 'hono';
import { putWorkbenchSchema } from '../schemas/workbenches';
import { getWorkbench, putWorkbench } from '../lib/workbench';
import { parseOrThrow } from '../lib/validate';
import type { AppEnv } from '../types';

export const workbenches = new Hono<AppEnv>();

workbenches.get('/:rootId', async (c) => c.json(await getWorkbench(c.env.DB, c.req.param('rootId'))));

workbenches.put('/:rootId', async (c) => {
  const body = parseOrThrow(putWorkbenchSchema, await c.req.json());
  return c.json(await putWorkbench(c.env.DB, c.req.param('rootId'), body.picks));
});
