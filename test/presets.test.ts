import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getJson, mcpToolCall, postJson } from './helpers';

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

// presets は recipe_ref ではなく (recipe, kind, name, version) で一意なので、recipe
// 名自体をテストごとにユニークにしておかないと import の冪等スキップが別テストの
// 行と衝突する。
function uniqueRecipe(): string {
  return `yukari-${crypto.randomUUID()}`;
}

function sampleCatalog(recipe: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag, warm light' }, 'seated'],
        costumes: [{ name: 'default', prompt: 'plain roomwear' }, 'swimsuit'],
        expressions: [{ name: 'smile', prompt: 'a gentle smile' }, 'neutral'],
        parameters: { count: 9, width: 1024 },
      },
    ],
    patches: { pose: { op: 'set' } },
    git_commit: 'abc1234',
    git_branch: 'main',
    generated_at: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

interface PresetSummary {
  id: string;
  recipe: string;
  kind: string;
  name: string;
  version: number;
  status: string;
  source: string;
  source_generation_id: string | null;
  note: string | null;
  created_at: string;
}

interface ImportResult {
  imported: PresetSummary[];
  skipped: { recipe: string; kind: string; name: string }[];
}

async function publishAndImport(recipeRef: string, recipe: string): Promise<ImportResult> {
  await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(recipe), 'PUT');
  const res = await postJson<ImportResult>('/api/v1/presets/import', { recipe_ref: recipeRef });
  expect(res.status).toBe(200);
  return res.body;
}

/** Inserts a { base, patches } promote-shaped row directly, bypassing promote (段階 B, not implemented). */
async function insertPromoteRow(row: {
  recipe: string;
  kind: string;
  name: string;
  version: number;
  base: { recipe: string; kind: string; name: string; version: number };
  patches: unknown[];
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 'promote', NULL, NULL, 'gui', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      row.recipe,
      row.kind,
      row.name,
      row.version,
      JSON.stringify({ base: row.base, patches: row.patches }),
      new Date().toISOString(),
    )
    .run();
}

describe('Preset import', () => {
  it('imports only catalog poses as version 1 (string and object entries); costume/expression are not imported', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    const { imported, skipped } = await publishAndImport(recipeRef, recipe);

    expect(skipped).toEqual([]);
    expect(imported).toHaveLength(2);

    const byKindName = new Map(imported.map((p) => [`${p.kind}/${p.name}`, p]));
    for (const key of ['pose/lounge', 'pose/seated']) {
      const p = byKindName.get(key);
      expect(p, key).toBeTruthy();
      expect(p?.version).toBe(1);
      expect(p?.status).toBe('active');
      expect(p?.source).toBe('import');
      expect(p?.recipe).toBe(recipe);
      expect(p?.source_generation_id).toBeNull();
    }

    const costumes = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets?recipe=${recipe}&kind=costume`);
    expect(costumes.body.items).toEqual([]);
    const expressions = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets?recipe=${recipe}&kind=expression`);
    expect(expressions.body.items).toEqual([]);
  });

  it('is idempotent: a second import of the same recipe_ref skips everything and adds no rows', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    const first = await publishAndImport(recipeRef, recipe);
    expect(first.imported).toHaveLength(2);

    const second = await postJson<ImportResult>('/api/v1/presets/import', { recipe_ref: recipeRef });
    expect(second.status).toBe(200);
    expect(second.body.imported).toEqual([]);
    expect(second.body.skipped).toHaveLength(2);

    const versions = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets/${recipe}/pose/lounge`);
    expect(versions.body.items).toHaveLength(1);
  });

  it('404s importing a recipe_ref with no published catalog', async () => {
    const res = await postJson('/api/v1/presets/import', { recipe_ref: uniqueRecipeRef() });
    expect(res.status).toBe(404);
  });
});

describe('Preset REST reads', () => {
  it('GET / returns each name at its latest version, with no record body', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await publishAndImport(recipeRef, recipe);

    const list = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets?recipe=${recipe}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain('reclining on a beanbag');
    expect(JSON.stringify(list.body)).not.toContain('gentle smile');
  });

  it('GET /{recipe}/{kind}/{name}/{version} resolves the record', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await publishAndImport(recipeRef, recipe);

    const got = await getJson<{ record: { recipe_pose: string }; patches: unknown[] }>(
      `/api/v1/presets/${recipe}/pose/lounge/1`,
    );
    expect(got.status).toBe(200);
    expect(got.body.record).toEqual({ recipe_pose: 'lounge' });
    expect(got.body.patches).toEqual([]);
  });

  it('404s an unknown version, 400s an invalid kind, 400s an invalid version', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await publishAndImport(recipeRef, recipe);

    const missingVersion = await getJson(`/api/v1/presets/${recipe}/pose/lounge/999`);
    expect(missingVersion.status).toBe(404);

    const badKind = await getJson(`/api/v1/presets/${recipe}/hairstyle/lounge/1`);
    expect(badKind.status).toBe(400);

    const badVersion = await getJson(`/api/v1/presets/${recipe}/pose/lounge/not-a-number`);
    expect(badVersion.status).toBe(400);
  });

  it('resolves a base chain to the root record plus patches flattened oldest-first', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await publishAndImport(recipeRef, recipe);

    await insertPromoteRow({
      recipe,
      kind: 'pose',
      name: 'lounge',
      version: 2,
      base: { recipe, kind: 'pose', name: 'lounge', version: 1 },
      patches: [{ target: 'pose', op: 'append', reason: 'v2', value: 'a bit more relaxed' }],
    });
    await insertPromoteRow({
      recipe,
      kind: 'pose',
      name: 'lounge',
      version: 3,
      base: { recipe, kind: 'pose', name: 'lounge', version: 2 },
      patches: [{ target: 'pose', op: 'append', reason: 'v3', value: 'holding a drink' }],
    });

    const got = await getJson<{ record: unknown; patches: { reason: string }[] }>(`/api/v1/presets/${recipe}/pose/lounge/3`);
    expect(got.status).toBe(200);
    expect(got.body.record).toEqual({ recipe_pose: 'lounge' });
    expect(got.body.patches.map((p) => p.reason)).toEqual(['v2', 'v3']);

    const list = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets/${recipe}/pose/lounge`);
    expect(list.body.items.map((p) => p.version)).toEqual([3, 2, 1]);

    const latest = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets?recipe=${recipe}&kind=pose`);
    const lounge = latest.body.items.find((p) => p.name === 'lounge');
    expect(lounge?.version).toBe(3);
  });
});

describe('MCP list_presets / get_preset', () => {
  it('list_presets returns the same summaries as GET /api/v1/presets', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await publishAndImport(recipeRef, recipe);

    const rest = await getJson<{ items: PresetSummary[] }>(`/api/v1/presets?recipe=${recipe}`);
    const tool = await mcpToolCall<{ items: PresetSummary[] }>('list_presets', { recipe });
    expect(tool.isError).toBe(false);
    expect(tool.data?.items.map((p) => [p.kind, p.name, p.version]).sort()).toEqual(
      rest.body.items.map((p) => [p.kind, p.name, p.version]).sort(),
    );
  });

  it('get_preset returns the same resolved body as GET /{recipe}/{kind}/{name}/{version}', async () => {
    const recipeRef = uniqueRecipeRef();
    const recipe = uniqueRecipe();
    await publishAndImport(recipeRef, recipe);

    const rest = await getJson<{ record: unknown; patches: unknown[] }>(`/api/v1/presets/${recipe}/pose/lounge/1`);
    const tool = await mcpToolCall<{ record: unknown; patches: unknown[] }>('get_preset', {
      recipe,
      kind: 'pose',
      name: 'lounge',
      version: 1,
    });
    expect(tool.isError).toBe(false);
    expect(tool.data?.record).toEqual(rest.body.record);
    expect(tool.data?.patches).toEqual(rest.body.patches);
  });

  it('get_preset 404s as a tool error for an unknown name', async () => {
    const recipe = uniqueRecipe();
    const tool = await mcpToolCall('get_preset', { recipe, kind: 'pose', name: 'nonexistent' });
    expect(tool.isError).toBe(true);
  });
});
