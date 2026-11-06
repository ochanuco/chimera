import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_FRAME } from '../src/lib/request-rules';
import { createGeneration, mcpToolCall, postJson } from './helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SHARED = ['stripes', 'dots', 'checks'];
const OWN = ['sakura', 'waves'];

async function putCatalog(recipeRef: string) {
  const res = await postJson(
    `/api/v1/catalogs/${recipeRef}`,
    {
      schema_version: 1,
      recipes: [
        { name: 'akari', poses: [], deliver: { backdrops: OWN.map((name) => ({ name, label: name, thumbnail: PNG })) } },
        { name: 'plain', poses: [] },
      ],
      patches: {},
      backdrops: SHARED.map((name) => ({ name, label: name, thumbnail: PNG })),
    },
    'PUT',
  );
  expect(res.status).toBe(200);
}

type Payload = { generation_id: string; options: Record<string, unknown> };

async function post(kind: 'stage' | 'deliver', generationId: string, options: unknown, recipeRef: string, key = crypto.randomUUID()) {
  return postJson<{ id: string; payload: Payload }>('/api/v1/requests', {
    kind,
    payload: { generation_id: generationId, options },
    recipe_ref: recipeRef,
    idempotency_key: key,
    created_by: 'gui',
  });
}

describe('backdrop "random" and frame "default"', () => {
  it('picks a pattern of the recipe for stage and deliver, the same one for the same key', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    await putCatalog(recipeRef);
    const { generation } = await createGeneration({ requestOverrides: { recipe: 'akari' } });

    const key = crypto.randomUUID();
    const first = await post('stage', generation.id, { backdrop: 'random' }, recipeRef, key);
    expect(first.status).toBe(201);
    expect(OWN).toContain(first.body.payload.options.backdrop);

    const again = await post('stage', generation.id, { backdrop: 'random' }, recipeRef, key);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);

    const deliver = await post('deliver', generation.id, { backdrop: 'random', transparent: false }, recipeRef);
    expect(deliver.status).toBe(201);
    expect(OWN).toContain(deliver.body.payload.options.backdrop);
    expect(deliver.body.payload.options.transparent).toBe(false);
  });

  it('reads the recipe of the raw picture a delivered one refines', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    await putCatalog(recipeRef);
    const { generation: raw } = await createGeneration({ requestOverrides: { recipe: 'akari' } });
    const { generation: child } = await createGeneration({ jobOverrides: { source_generation_id: raw.id } });
    const row = await env.DB.prepare('SELECT refines_generation_id FROM generations WHERE id = ?').bind(child.id).first<{ refines_generation_id: string }>();
    expect(row?.refines_generation_id).toBe(raw.id);
    const res = await post('stage', child.id, { backdrop: 'random', frame: 'default' }, recipeRef);
    expect(res.status).toBe(201);
    expect(OWN).toContain(res.body.payload.options.backdrop);
  });

  it('spreads its picks over the patterns across keys', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    await putCatalog(recipeRef);
    const { generation } = await createGeneration({ requestOverrides: { recipe: 'plain' } });
    const picked = new Set<unknown>();
    for (let i = 0; i < 12; i += 1) {
      const res = await post('stage', generation.id, { backdrop: 'random' }, recipeRef);
      expect(res.status).toBe(201);
      picked.add(res.body.payload.options.backdrop);
    }
    for (const name of picked) expect(SHARED).toContain(name);
    expect(picked.size).toBeGreaterThan(1);
  }, 20000);

  it('rejects "random" when the catalog publishes no patterns', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    const { generation } = await createGeneration();
    const res = await post('stage', generation.id, { backdrop: 'random' }, recipeRef);
    expect(res.status).toBe(400);
  });

  it('expands frame "default" to the workbench frame, and leaves other values alone', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    const { generation } = await createGeneration();
    const res = await post('stage', generation.id, { backdrop: 'dots', frame: 'default' }, recipeRef);
    expect(res.status).toBe(201);
    expect(res.body.payload.options).toEqual({ backdrop: 'dots', frame: DEFAULT_STAGE_FRAME });

    const mcp = await mcpToolCall<{ request: { payload: Payload } }>('stage_generation', {
      generation_id: generation.id,
      backdrop: '#ffeeaa',
      frame: 'default',
      idempotency_key: crypto.randomUUID(),
    });
    expect(mcp.isError).toBe(false);
    expect(mcp.data?.request.payload.options).toEqual({ backdrop: '#ffeeaa', frame: DEFAULT_STAGE_FRAME });
  });

  it('rejects frame "default" with a photo and an unknown frame word', async () => {
    const recipeRef = `test-${crypto.randomUUID()}`;
    const { generation } = await createGeneration();
    expect((await post('stage', generation.id, { photo: 'p', frame: 'default' }, recipeRef)).status).toBe(400);
    expect((await post('stage', generation.id, { frame: 'wide' }, recipeRef)).status).toBe(400);
  });
});
