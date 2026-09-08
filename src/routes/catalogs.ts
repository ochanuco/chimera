import { Hono } from 'hono';
import { recipeCatalogEnvelopeSchema } from '../schemas/catalogs';
import { RECIPE_REF_RE } from '../schemas/requests';
import { getCatalog, listCatalogs, putCatalog, summarizeCatalog } from '../lib/catalogs';
import { badRequest, notFound } from '../lib/errors';
import type { AppEnv } from '../types';

export const catalogs = new Hono<AppEnv>();

function requireRecipeRef(raw: string): string {
  if (!RECIPE_REF_RE.test(raw)) throw badRequest(`invalid recipe_ref '${raw}'`);
  return raw;
}

catalogs.get('/', async (c) => {
  const items = await listCatalogs(c.env.DB);
  return c.json({ items });
});

catalogs.put('/:recipe_ref', async (c) => {
  const recipeRef = requireRecipeRef(c.req.param('recipe_ref'));
  const doc = recipeCatalogEnvelopeSchema.parse(await c.req.json());
  const row = await putCatalog(c.env.DB, recipeRef, doc);
  return c.json({
    recipe_ref: row.recipe_ref,
    published_at: row.published_at,
    updated_at: row.updated_at,
    ...summarizeCatalog(doc),
  });
});

catalogs.get('/:recipe_ref', async (c) => {
  const recipeRef = requireRecipeRef(c.req.param('recipe_ref'));
  const found = await getCatalog(c.env.DB, recipeRef);
  if (!found) throw notFound('recipe catalog');
  return c.json({
    recipe_ref: found.row.recipe_ref,
    published_at: found.row.published_at,
    updated_at: found.row.updated_at,
    worker_id: found.row.worker_id,
    ...found.doc,
  });
});
