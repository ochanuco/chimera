import { Hono } from 'hono';
import { ZodError } from 'zod';
import { createMcpHandler } from 'agents/mcp/server';
import { ApiError } from './lib/errors';
import { batches } from './routes/batches';
import { jobs } from './routes/jobs';
import { generations } from './routes/generations';
import { stories } from './routes/stories';
import { experiments, experimentRuns, promotions } from './routes/experiments';
import { requests } from './routes/requests';
import { catalogs } from './routes/catalogs';
import { presets } from './routes/presets';
import { observations } from './routes/observations';
import { publications } from './routes/publications';
import { workerWs } from './routes/worker-hub';
import { characters } from './routes/characters';
import { tags } from './routes/tags';
import { graph } from './routes/graph';
import { images } from './routes/images';
import { assets } from './routes/assets';
import { styleCheck } from './routes/style-check';
import { pages } from './routes/pages';
import { createChimeraMcpServer } from './mcp';
import type { Waitable } from './lib/hub-notify';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.route('/api/v1/batches', batches);
app.route('/api/v1/jobs', jobs);
app.route('/api/v1/generations', generations);
app.route('/api/v1/stories', stories);
app.route('/api/v1/experiments', experiments);
app.route('/api/v1/experiment-runs', experimentRuns);
app.route('/api/v1/promotions', promotions);
app.route('/api/v1/requests', requests);
app.route('/api/v1/catalogs', catalogs);
app.route('/api/v1/presets', presets);
app.route('/api/v1/observations', observations);
app.route('/api/v1/publications', publications);
app.get('/api/v1/worker/ws', workerWs);
app.route('/api/v1/characters', characters);
app.route('/api/v1/tags', tags);
app.route('/api/v1/graph', graph);
app.route('/api/v1/style-check', styleCheck);
app.route('/g', images);
app.route('/assets', assets);

// stateless MCP エンドポイント。McpServerFactory は env を受け取らないので、tool が
// 必要とする c.env の D1/R2 を毎リクエストのクロージャで束縛する。c.executionCtx は
// テストハーネスの app.request(url, init, env) では未設定になるためガードする。
app.all('/mcp', (c) => {
  const origin = new URL(c.req.url).origin;
  let executionCtx: unknown;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }
  const handler = createMcpHandler(() => createChimeraMcpServer(c.env, origin, executionCtx as Waitable | undefined));
  return handler(c.req.raw, c.env, executionCtx as Parameters<typeof handler>[2]);
});

app.route('/', pages);

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toJSON(), err.status as 400 | 404 | 409 | 410);
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return c.json({ error: { code: 'validation_error', message } }, 400);
  }
  console.error(err);
  return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404));
