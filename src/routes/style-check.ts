import { Hono } from 'hono';
import { styleCheckRenderSchema } from '../schemas/style-check';
import { renderStyleCheck } from '../lib/style-check';
import { notifyHub, runInBackground } from '../lib/hub-notify';
import { parseOrThrow } from '../lib/validate';
import type { AppEnv } from '../types';

export const styleCheck = new Hono<AppEnv>();

// 絵柄チェックの唯一の書き込み窓口。何を描くかは pin と recipe 既定だけで決まる
// — GUI は prompt を書かない(docs/worker-protocol.md「GUI」の不変条件)。
styleCheck.post('/:recipe', async (c) => {
  const recipe = c.req.param('recipe');
  const body = parseOrThrow(styleCheckRenderSchema, await c.req.json().catch(() => ({})));
  const variant = body.angle ? { angle: body.angle } : body.framing ? { framing: body.framing } : undefined;
  const { results, createdRequests } = await renderStyleCheck(c.env.DB, c.env, recipe, { pose: body.pose, variant });
  for (const row of createdRequests) runInBackground(c, notifyHub(c.env, 'queued', row));
  return c.json({
    results: results.map((r) => ({
      pose: r.pose,
      skipped: r.skipped ?? null,
      created: r.created ?? null,
      request_id: r.request_id ?? null,
      status: r.status ?? null,
    })),
  });
});
