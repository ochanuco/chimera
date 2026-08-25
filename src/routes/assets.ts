import { Hono } from 'hono';
import { appJs, styleCss } from '../ui/static';
import type { AppEnv } from '../types';

export const assets = new Hono<AppEnv>();

assets.get('/style.css', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(styleCss, 200, { 'Content-Type': 'text/css; charset=utf-8' });
});

assets.get('/app.js', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(appJs, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
});
