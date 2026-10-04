import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, postJson, req, clearRequests } from './helpers';

interface RequestBody {
  id: string;
  short_id: string;
  kind: string;
  status: string;
  created_by: string;
  payload: {
    generation: { recipe: string; parameters: Record<string, unknown>; patches?: unknown[]; presets?: unknown[] };
    request: { count: number; seeds?: number[]; instruction: string };
  };
}

const PARENT_PATCHES = [{ target: 'pose', op: 'set', value: 'lounge', reason: 'base' }];

async function createSource(overrides: { recipe?: string | null; seed?: number } = {}) {
  const requestOverrides: Record<string, unknown> = { parameters: { pose: 'lounge' } };
  if (overrides.recipe !== null) {
    requestOverrides.recipe = overrides.recipe ?? 'yukari';
    requestOverrides.patches = PARENT_PATCHES;
    requestOverrides.pose_fingerprint = 'sha256:fixture';
    requestOverrides.preset_versions = [{ kind: 'pose', name: 'lounge', version: 1 }];
  }
  return createGeneration({ requestOverrides, metadata: { seed: overrides.seed ?? 4242 } });
}

describe('POST /api/v1/generations/{id}/hires', () => {
  beforeEach(clearRequests);

  it('queues a same-seed generate request with parameters.hires and a trailing hires.denoise patch', async () => {
    const { generation } = await createSource();
    const res = await postJson<RequestBody>(`/api/v1/generations/${generation.id}/hires`, { denoise: 0.45 });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('generate');
    expect(res.body.created_by).toBe('gui');
    const { generation: gen, request } = res.body.payload;
    expect(gen.recipe).toBe('yukari');
    expect(gen.parameters.hires).toBe(2048);
    expect(gen.patches).toEqual([...PARENT_PATCHES, { target: 'hires.denoise', op: 'set', value: 0.45 }]);
    expect(gen.presets).toEqual([{ kind: 'pose', name: 'lounge', version: 1 }]);
    expect(request.count).toBe(1);
    expect(request.seeds).toEqual([4242]);
    expect(request.instruction).toContain('hires 2048 (denoise 0.45)');
  });

  it('resolves a finalized generation back to its raw source', async () => {
    const raw = await createSource({ seed: 777 });
    const finalized = await createGeneration({
      requestOverrides: { kind: 'finalize', parameters: { kind: 'hires-chain', base_generation: raw.generation.id } },
      jobOverrides: { source_generation_id: raw.generation.id },
    });
    const res = await postJson<RequestBody>(`/api/v1/generations/${finalized.generation.id}/hires`, { denoise: 0.35 });
    expect(res.status).toBe(201);
    expect(res.body.payload.generation.recipe).toBe('yukari');
    expect(res.body.payload.generation.parameters.pose).toBe('lounge');
    expect(res.body.payload.request.seeds).toEqual([777]);
    expect(res.body.payload.request.instruction).toContain(raw.generation.short_id);
  });

  it('replays the same idempotency_key as 200 with the same row', async () => {
    const { generation } = await createSource();
    const body = { denoise: 0.35, idempotency_key: `gui:hires:${generation.short_id}:${crypto.randomUUID()}` };
    const first = await postJson<RequestBody>(`/api/v1/generations/${generation.id}/hires`, body);
    const second = await postJson<RequestBody>(`/api/v1/generations/${generation.id}/hires`, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects a denoise outside 0.35 / 0.45 with 400', async () => {
    const { generation } = await createSource();
    for (const denoise of [0.5, 0, '0.35', undefined]) {
      const res = await postJson(`/api/v1/generations/${generation.id}/hires`, { denoise });
      expect(res.status, String(denoise)).toBe(400);
    }
  });

  it('409s for a graph-mode source', async () => {
    const { generation } = await createSource({ recipe: null });
    const res = await postJson(`/api/v1/generations/${generation.id}/hires`, { denoise: 0.35 });
    expect(res.status).toBe(409);
  });
});

describe('Generation Detail hires rerender row', () => {
  beforeEach(clearRequests);

  it('renders the button for a recipe-mode generation', async () => {
    const { generation } = await createSource();
    const html = await (await req(`/g/${generation.short_id}`)).text();
    expect(html).toContain('class="hires-rerender-btn"');
    expect(html).toContain(`data-generation-short-id="${generation.short_id}"`);
  });

  it('omits the button for a graph-mode generation', async () => {
    const { generation } = await createSource({ recipe: null });
    const html = await (await req(`/g/${generation.short_id}`)).text();
    expect(html).not.toContain('hires-rerender-btn');
  });
});
