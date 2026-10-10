import { Hono } from 'hono';
import { renderStyleCheck } from '../lib/style-check';
import { notifyHub, runInBackground } from '../lib/hub-notify';
import type { AppEnv } from '../types';

export const styleCheck = new Hono<AppEnv>();

// 絵柄チェックの唯一の書き込み窓口。何を描くかは STYLE_CHECK_POSES の固定リストと pin だけで決まる
// — GUI は prompt を書かない(docs/worker-protocol.md「GUI」の不変条件)。
styleCheck.post('/:recipe', async (c) => {
  const recipe = c.req.param('recipe');
  const { results, createdRequests } = await renderStyleCheck(c.env.DB, c.env, recipe);
  for (const row of createdRequests) runInBackground(c, notifyHub(c.env, 'queued', row));
  return c.json({
    results: results.map((r) => ({
      framing: r.framing,
      pose: r.pose,
      skipped: r.skipped ?? null,
      created: r.created ?? null,
      request_id: r.request_id ?? null,
      status: r.status ?? null,
    })),
  });
});
