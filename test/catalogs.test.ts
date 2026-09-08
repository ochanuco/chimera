import { describe, expect, it } from 'vitest';
import { getJson, mcpToolCall, postJson } from './helpers';

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

function sampleCatalog(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: 'yukari',
        poses: [
          { name: 'lounge', prompt: 'reclining on a beanbag, warm light' },
          { name: 'seated', prompt: 'seated, hands on knees' },
        ],
        costumes: ['default', 'roomwear'],
        parameters: { count: 9, width: 1024 },
      },
    ],
    patches: { pose: { op: 'set' }, costume: { op: 'set' } },
    git_commit: 'abc1234',
    git_branch: 'main',
    generated_at: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

interface CatalogSummary {
  recipe_ref: string;
  recipes: { name: string; poses: string[]; costumes?: string[]; parameters?: unknown }[];
  patches: Record<string, unknown>;
  git_commit: string | null;
  git_branch: string | null;
}

describe('Recipe Catalog REST', () => {
  it('PUT publishes a catalog and returns the summary (no prompt bodies)', async () => {
    const recipeRef = uniqueRecipeRef();
    const res = await postJson<CatalogSummary>(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');
    expect(res.status).toBe(200);
    expect(res.body.recipe_ref).toBe(recipeRef);
    expect(res.body.recipes).toEqual([
      { name: 'yukari', poses: ['lounge', 'seated'], costumes: ['default', 'roomwear'], parameters: { count: 9, width: 1024 } },
    ]);
    expect(res.body.git_commit).toBe('abc1234');
    expect(res.body.git_branch).toBe('main');
    expect(JSON.stringify(res.body)).not.toContain('reclining on a beanbag');
  });

  it('GET list surfaces recipe names and pose counts without the catalog body', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');

    const list = await getJson<{ items: { recipe_ref: string; recipes: { name: string; pose_count: number }[] }[] }>(
      '/api/v1/catalogs',
    );
    expect(list.status).toBe(200);
    const item = list.body.items.find((i) => i.recipe_ref === recipeRef);
    expect(item).toBeTruthy();
    expect(item?.recipes).toEqual([{ name: 'yukari', pose_count: 2 }]);
    expect(JSON.stringify(item)).not.toContain('reclining on a beanbag');
  });

  it('GET by recipe_ref returns the full document, prompt bodies included', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');

    const got = await getJson<{ recipes: { name: string; poses: { name: string; prompt: string }[] }[] }>(
      `/api/v1/catalogs/${recipeRef}`,
    );
    expect(got.status).toBe(200);
    expect(got.body.recipes[0]?.poses[0]).toEqual({ name: 'lounge', prompt: 'reclining on a beanbag, warm light' });
  });

  it('404s GET by recipe_ref when nothing has been published', async () => {
    const res = await getJson(`/api/v1/catalogs/${uniqueRecipeRef()}`);
    expect(res.status).toBe(404);
  });

  it('PUT replaces the previous document for the same recipe_ref', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog({ git_commit: 'def5678' }), 'PUT');

    const got = await getJson<{ git_commit: string }>(`/api/v1/catalogs/${recipeRef}`);
    expect(got.body.git_commit).toBe('def5678');
  });
});

describe('MCP list_catalog / get_catalog_pose', () => {
  it('list_catalog returns the same summary shape as the PUT/GET REST routes', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');

    const tool = await mcpToolCall<CatalogSummary>('list_catalog', { recipe_ref: recipeRef });
    expect(tool.isError).toBe(false);
    expect(tool.data?.recipes).toEqual([
      { name: 'yukari', poses: ['lounge', 'seated'], costumes: ['default', 'roomwear'], parameters: { count: 9, width: 1024 } },
    ]);
    expect(tool.data?.git_commit).toBe('abc1234');
  });

  it('list_catalog 404s as a tool error when recipe_ref has nothing published', async () => {
    const tool = await mcpToolCall('list_catalog', { recipe_ref: uniqueRecipeRef() });
    expect(tool.isError).toBe(true);
  });

  it('get_catalog_pose returns the full pose record', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');

    const tool = await mcpToolCall<{ name: string; prompt: string }>('get_catalog_pose', {
      recipe: 'yukari',
      pose: 'seated',
      recipe_ref: recipeRef,
    });
    expect(tool.isError).toBe(false);
    expect(tool.data).toEqual({ name: 'seated', prompt: 'seated, hands on knees' });
  });

  it('get_catalog_pose 404s as a tool error for an unknown recipe', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');

    const tool = await mcpToolCall('get_catalog_pose', { recipe: 'nonexistent', pose: 'lounge', recipe_ref: recipeRef });
    expect(tool.isError).toBe(true);
  });

  it('get_catalog_pose 404s as a tool error for an unknown pose', async () => {
    const recipeRef = uniqueRecipeRef();
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(), 'PUT');

    const tool = await mcpToolCall('get_catalog_pose', { recipe: 'yukari', pose: 'nonexistent', recipe_ref: recipeRef });
    expect(tool.isError).toBe(true);
  });
});
