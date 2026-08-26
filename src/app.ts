import { Hono } from 'hono';
import { ZodError } from 'zod';
import { ApiError } from './lib/errors';
import { batches } from './routes/batches';
import { jobs } from './routes/jobs';
import { generations } from './routes/generations';
import { stories } from './routes/stories';
import { experiments } from './routes/experiments';
import { characters } from './routes/characters';
import { tags } from './routes/tags';
import { graph } from './routes/graph';
import { images } from './routes/images';
import { assets } from './routes/assets';
import { pages } from './routes/pages';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.route('/api/v1/batches', batches);
app.route('/api/v1/jobs', jobs);
app.route('/api/v1/generations', generations);
app.route('/api/v1/stories', stories);
app.route('/api/v1/experiments', experiments);
app.route('/api/v1/characters', characters);
app.route('/api/v1/tags', tags);
app.route('/api/v1/graph', graph);
app.route('/g', images);
app.route('/assets', assets);
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
