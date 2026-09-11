import { describe, expect, it } from 'vitest';
import { createGeneration, mcpToolCall, postJson } from './helpers';

interface ListItem {
  short_id: string;
  canonical_url: string;
  tags: string[];
  image_url?: string;
  character: { id: string; name: string | null } | null;
  reference?: { recipe: string; pose: string } | null;
}

interface ListResult {
  items: ListItem[];
  total: number;
}

function uniqueRecipe(): string {
  return `pose-ref-${crypto.randomUUID()}`;
}

function sampleCatalog(recipe: string) {
  return {
    schema_version: 1,
    recipes: [
      {
        name: recipe,
        poses: [{ name: 'lounge', prompt: 'reclining on a beanbag, warm light', costume: 'default' }],
        costumes: [{ name: 'default', prompt: 'plain roomwear' }],
        expressions: [{ name: 'smile', prompt: 'a gentle smile' }],
      },
    ],
    patches: {},
    git_commit: 'abc1234',
    git_branch: 'main',
    generated_at: '2026-09-08T00:00:00.000Z',
  };
}

async function publishAndImport(recipe: string): Promise<void> {
  const recipeRef = `test-${crypto.randomUUID()}`;
  await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(recipe), 'PUT');
  const res = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: recipeRef });
  expect(res.status).toBe(200);
}

describe('MCP list_generations', () => {
  it('filters by tag and returns gallery fields without image fields', async () => {
    const { generation } = await createGeneration();
    const tag = `outfit-good-${crypto.randomUUID().slice(0, 8)}`;
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: tag });

    const call = await mcpToolCall<ListResult>('list_generations', { tag });
    expect(call.isError).toBe(false);
    expect(call.data?.items.map((item) => item.short_id)).toEqual([generation.short_id]);
    expect(call.data?.total).toBe(1);

    const item = call.data?.items[0];
    expect(item?.short_id).toBe(generation.short_id);
    expect(item?.canonical_url).toContain(generation.short_id);
    expect(item?.tags).toContain(tag);
    expect(item?.image_url).toBeUndefined();
  });

  it('returns the character as an object', async () => {
    const character = await postJson<{ id: string; name: string }>('/api/v1/characters', {
      name: `yukari-${crypto.randomUUID().slice(0, 8)}`,
    });
    const { generation } = await createGeneration({ metadata: { character_id: character.body.id } });
    const tag = `char-${crypto.randomUUID().slice(0, 8)}`;
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: tag });

    const call = await mcpToolCall<ListResult>('list_generations', { tag });
    expect(call.isError).toBe(false);
    expect(call.data?.items[0]?.character).toEqual({ id: character.body.id, name: character.body.name });
  });

  it('filters by reference (pose basis-render pin)', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation: pinned } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });
    const { generation: other } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });
    await postJson(`/api/v1/generations/${pinned.id}/rating`, { rating: 'good' }, 'PUT');
    const pin = await postJson<{ name: string }>(`/api/v1/generations/${pinned.id}/pose-reference`, {});
    expect(pin.status).toBe(201);

    const call = await mcpToolCall<ListResult>('list_generations', { reference: true });
    expect(call.isError).toBe(false);
    const shortIds = call.data?.items.map((i) => i.short_id) ?? [];
    expect(shortIds).toContain(pinned.short_id);
    expect(shortIds).not.toContain(other.short_id);
    expect(call.data?.items.find((i) => i.short_id === pinned.short_id)?.reference).toEqual({ recipe, pose: 'lounge' });
  });

  it('get_generation returns pose_reference', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });
    await postJson(`/api/v1/generations/${generation.id}/rating`, { rating: 'good' }, 'PUT');
    const pin = await postJson(`/api/v1/generations/${generation.id}/pose-reference`, {});
    expect(pin.status).toBe(201);

    const call = await mcpToolCall<{ pose_reference?: { recipe: string; pose: string } | null }>('get_generation', {
      generation_id: generation.short_id,
    });
    expect(call.isError).toBe(false);
    expect(call.data?.pose_reference).toEqual({ recipe, pose: 'lounge' });
  });
});
