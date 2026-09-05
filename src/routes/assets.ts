import { Hono } from 'hono';
import { appJs, styleCss } from '../ui/static';
import { telemetryDisabledJs, telemetryJs } from '../ui/telemetry';
import type { AppEnv } from '../types';

export const assets = new Hono<AppEnv>();

assets.get('/style.css', (c) => {
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(styleCss, 200, { 'Content-Type': 'text/css; charset=utf-8' });
});

assets.get('/app.js', (c) => {
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(appJs, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
});

assets.get('/telemetry.js', (c) => {
  const key = c.env.POSTHOG_KEY;
  // ユーザ依存の内容 (identify) を含むので immutable キャッシュにはしない。
  c.header('Cache-Control', 'private, max-age=300');
  const js = key
    ? telemetryJs({
        key,
        host: c.env.POSTHOG_HOST || 'https://us.i.posthog.com',
        distinctId: c.req.header('Cf-Access-Authenticated-User-Email') ?? null,
      })
    : telemetryDisabledJs;
  return c.body(js, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
});
