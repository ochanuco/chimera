import { Hono } from 'hono';
import { updatePublicationSchema } from '../schemas/publications';
import { deletePublication, getPublicationOr404, serializePublication, updatePublicationUrl } from '../lib/publications';
import type { AppEnv } from '../types';

export const publications = new Hono<AppEnv>();

publications.patch('/:id', async (c) => {
  const body = updatePublicationSchema.parse(await c.req.json());
  const db = c.env.DB;
  await getPublicationOr404(db, c.req.param('id'));
  const updated = await updatePublicationUrl(db, c.req.param('id'), body.url);
  return c.json(serializePublication(updated));
});

publications.delete('/:id', async (c) => {
  const db = c.env.DB;
  await getPublicationOr404(db, c.req.param('id'));
  await deletePublication(db, c.req.param('id'));
  return c.body(null, 204);
});
