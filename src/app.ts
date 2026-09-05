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
import { workerWs } from './routes/worker-hub';
import { characters } from './routes/characters';
import { tags } from './routes/tags';
import { graph } from './routes/graph';
import { images } from './routes/images';
import { assets } from './routes/assets';
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
app.get('/api/v1/worker/ws', workerWs);
app.route('/api/v1/characters', characters);
app.route('/api/v1/tags', tags);
app.route('/api/v1/graph', graph);
app.route('/g', images);
app.route('/assets', assets);

// Cloudflare OS 上の Agent 用の stateless MCP エンドポイント (docs/experiment-agent.md)。
// Durable Object もセッションも持たない — createMcpHandler 自体が
// agents パッケージの stateless 実装 (createStatelessMcpHandler)。tool は
// c.env の D1 / R2 を必要とするため、factory を毎リクエスト c.env に
// クロージャで束縛する（McpServerFactory 自体は env を受け取らない）。
// c.executionCtx は Worker 本番では常に存在するが、テストハーネスの
// app.request(url, init, env) は ExecutionContext を渡さないため未設定
// でも動くようガードする（createMcpHandler は ctx が undefined でも動作する）。
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
    return c.json(err.toJSON(), err.status as 400 | 404 | 409);
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return c.json({ error: { code: 'validation_error', message } }, 400);
  }
  console.error(err);
  return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404));
