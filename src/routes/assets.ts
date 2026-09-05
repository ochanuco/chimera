import { Hono } from 'hono';
import { appJs, styleCss } from '../ui/static';
import { telemetryDisabledJs, telemetryJs } from '../ui/telemetry';
import type { AppEnv } from '../types';

export const assets = new Hono<AppEnv>();

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

// api_host には識別子付きのイベントが飛ぶので https 以外は既定に落とす。
function telemetryHost(raw: string | undefined): string {
  if (!raw) return DEFAULT_POSTHOG_HOST;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.origin : DEFAULT_POSTHOG_HOST;
  } catch {
    return DEFAULT_POSTHOG_HOST;
  }
}

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
  // identify にユーザのメールを埋めるので、同一ブラウザでのユーザ切替を跨いで再利用させない。
  c.header('Cache-Control', 'no-store');
  const js = key
    ? telemetryJs({
        key,
        host: telemetryHost(c.env.POSTHOG_HOST),
        distinctId: c.req.header('Cf-Access-Authenticated-User-Email') ?? null,
      })
    : telemetryDisabledJs;
  return c.body(js, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
});
