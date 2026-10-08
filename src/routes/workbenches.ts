import { Hono } from 'hono';
import { putWorkbenchSchema } from '../schemas/workbenches';
import { getWorkbench, putWorkbench } from '../lib/workbench';
import type { AppEnv } from '../types';

export const workbenches = new Hono<AppEnv>();

workbenches.get('/:rootId', async (c) => c.json(await getWorkbench(c.env.DB, c.req.param('rootId'))));

workbenches.put('/:rootId', async (c) => {
  const body = putWorkbenchSchema.parse(await c.req.json());
  return c.json(await putWorkbench(c.env.DB, c.req.param('rootId'), body.picks));
});
