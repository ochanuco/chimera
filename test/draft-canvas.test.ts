import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { draftSize } from '../src/lib/draft-canvas';
import { createGeneration, mcpToolCall, postJson } from './helpers';

type Patch = { target: string; op: string; value?: unknown; reason?: string };
type DerivePayload = { payload: { generation: { patches?: Patch[] }; semantic: { attributes?: Record<string, unknown> } } };

const DRAFT_896x1440 = [
  { target: 'render.width', op: 'set', value: 896, reason: 'draft: about 1.3 MP at the 1280x2048 aspect ratio' },
  { target: 'render.height', op: 'set', value: 1440, reason: 'draft: about 1.3 MP at the 1280x2048 aspect ratio' },
];

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

async function publish(recipeRef: string): Promise<void> {
  const res = await postJson(
    `/api/v1/catalogs/${recipeRef}`,
    {
      schema_version: 3,
      recipes: [{ name: 'yukari', poses: [{ name: 'bust', canvas: [1280, 2048] }, { name: 'gao', canvas: [1024, 1280] }] }],
      patches: {},
    },
    'PUT',
  );
  expect(res.status).toBe(200);
}

afterEach(async () => {
  await env.DB.prepare('DELETE FROM recipe_catalogs').run();
});

const size = (width: number, height: number) => [
  { target: 'render.width', op: 'set', value: width, reason: 'r' },
  { target: 'render.height', op: 'set', value: height, reason: 'r' },
];

describe('draftSize', () => {
  it('keeps the aspect ratio at about 1.3 MP, sides a multiple of 8', () => {
    expect(draftSize(1280, 2048)).toEqual([896, 1440]);
    expect(draftSize(1024, 1640)).toEqual([896, 1440]);
  });
});

describe('MCP derive_request draft canvas', () => {
  const parent = (patches: Patch[] = []) =>
    createGeneration({ requestOverrides: { recipe: 'yukari', parameters: { pose: 'bust' }, patches } });

  const derive = (generationId: string, ref: string, extra: Record<string, unknown> = {}) =>
    mcpToolCall<DerivePayload>('derive_request', {
      from_generation_id: generationId,
      instruction: 'variant',
      count: 1,
      semantic: { summary: 'variant' },
      recipe_ref: ref,
      idempotency_key: crypto.randomUUID(),
      ...extra,
    });

  it('appends draft patches when the default canvas is larger than a draft', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await parent();
    const call = await derive(generation.id, ref);
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation.patches).toEqual(DRAFT_896x1440);
  });

  it('shrinks a larger size carried from the parent', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await parent(size(1280, 2048));
    const call = await derive(generation.id, ref);
    expect(call.data?.payload.generation.patches?.slice(2)).toEqual(DRAFT_896x1440);
  });

  it('leaves a draft-sized request alone, whatever its aspect ratio', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await parent();
    const call = await derive(generation.id, ref, { patches: size(1472, 896) });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation.patches).toEqual(size(1472, 896));
  });

  it('rejects a larger size patched in the request itself', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await parent();
    const call = await derive(generation.id, ref, { patches: size(1280, 2048) });
    expect(call.isError).toBe(true);
    expect(call.text).toContain('give the reason for this size in canvas_override');
  });

  it('renders any size with canvas_override and records the reason', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await parent();
    const call = await derive(generation.id, ref, { patches: size(1280, 2048), canvas_override: 'match the parent pixel grid' });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation.patches).toEqual(size(1280, 2048));
    expect(call.data?.payload.semantic.attributes?.canvas_override).toBe('match the parent pixel grid');
  });

  it('does nothing for a pose without a published canvas', async () => {
    const { generation } = await parent();
    const call = await derive(generation.id, uniqueRecipeRef());
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation.patches).toBeUndefined();
  });
});

describe('MCP create_request draft canvas', () => {
  const create = (ref: string, generation: Record<string, unknown>) =>
    mcpToolCall<{ request: { payload: DerivePayload['payload'] } }>('create_request', {
      kind: 'generate',
      payload: { schema_version: 1, request: { instruction: 'i', count: 1 }, generation, semantic: { summary: 's' } },
      recipe_ref: ref,
      idempotency_key: crypto.randomUUID(),
    });

  it('appends draft patches to a generate request without a size', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const call = await create(ref, { recipe: 'yukari', parameters: { pose: 'bust' } });
    expect(call.isError).toBe(false);
    expect(call.data?.request.payload.generation.patches).toEqual(DRAFT_896x1440);
  });

  it('keeps a pose whose default canvas is already a draft', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const call = await create(ref, { recipe: 'yukari', parameters: { pose: 'gao' } });
    expect(call.data?.request.payload.generation.patches).toBeUndefined();
  });

  it('rejects a larger size unless generation.canvas_override gives the reason', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const rejected = await create(ref, { recipe: 'yukari', parameters: { pose: 'bust' }, patches: size(1280, 2048) });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain('generation.canvas_override');

    const accepted = await create(ref, {
      recipe: 'yukari',
      parameters: { pose: 'bust' },
      patches: size(1280, 2048),
      canvas_override: 'full-size check',
    });
    expect(accepted.isError).toBe(false);
    expect(accepted.data?.request.payload.semantic.attributes?.canvas_override).toBe('full-size check');
  });
});
