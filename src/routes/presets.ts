import { Hono } from 'hono';
import { presetImportRequestSchema, presetKindSchema, presetPromoteRequestSchema } from '../schemas/presets';
import { badRequest, notFound } from '../lib/errors';
import { getPresetRow, importFromCatalog, listPresets, listPresetVersions, resolvePreset, serializeResolvedPreset } from '../lib/presets';
import { promoteGenerationToPreset } from '../lib/promote';
import type { AppEnv, PresetKind } from '../types';

export const presets = new Hono<AppEnv>();

function requireKind(raw: string): PresetKind {
  const parsed = presetKindSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(`invalid kind '${raw}'`);
  return parsed.data;
}

function requireVersion(raw: string): number {
  const version = Number(raw);
  if (!Number.isInteger(version) || version <= 0) throw badRequest(`invalid version '${raw}'`);
  return version;
}

function isIncludeDeprecated(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true';
}

// Hono マッチ順: /import, /promote は :recipe/:kind/:name より先に登録する。
presets.post('/import', async (c) => {
  const { recipe_ref } = presetImportRequestSchema.parse(await c.req.json());
  const result = await importFromCatalog(c.env.DB, recipe_ref);
  return c.json(result);
});

presets.post('/promote', async (c) => {
  const body = presetPromoteRequestSchema.parse(await c.req.json());
  const result = await promoteGenerationToPreset(c.env.DB, { ...body, created_by: 'gui' });
  return c.json(result);
});

presets.get('/', async (c) => {
  const kindRaw = c.req.query('kind');
  const items = await listPresets(c.env.DB, {
    recipe: c.req.query('recipe'),
    kind: kindRaw ? requireKind(kindRaw) : undefined,
    includeDeprecated: isIncludeDeprecated(c.req.query('include_deprecated')),
  });
  return c.json({ items });
});

presets.get('/:recipe/:kind/:name', async (c) => {
  const recipe = c.req.param('recipe');
  const kind = requireKind(c.req.param('kind'));
  const name = c.req.param('name');
  const items = await listPresetVersions(c.env.DB, recipe, kind, name, isIncludeDeprecated(c.req.query('include_deprecated')));
  if (items.length === 0) throw notFound('preset');
  return c.json({ items });
});

presets.get('/:recipe/:kind/:name/:version', async (c) => {
  const recipe = c.req.param('recipe');
  const kind = requireKind(c.req.param('kind'));
  const name = c.req.param('name');
  const version = requireVersion(c.req.param('version'));

  const row = await getPresetRow(c.env.DB, recipe, kind, name, version);
  if (!row) throw notFound('preset');
  const resolved = await resolvePreset(c.env.DB, row);
  return c.json(serializeResolvedPreset(row, resolved));
});
