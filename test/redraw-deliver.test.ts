import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRequests, createGeneration, createRequest, getJson, mcpToolCall, postJson, req, TINY_PNG } from './helpers';

beforeEach(async () => {
  await clearRequests();
});

interface RequestBody {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
}

function create(kind: string, payload: unknown) {
  return postJson<RequestBody & { error?: unknown }>('/api/v1/requests', {
    kind,
    payload,
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
  });
}

describe('redraw request', () => {
  it.each([
    ['canvas', { method: 'canvas', denoise: 'light', size: 2048, route: 'latent', finalizer: 'x', upscale: 'lanczos', keep_regions: [[0.1, 0.1, 0.5, 0.5]], keep_strength: 0.4 }],
    ['canvas with numeric denoise and nulls', { method: 'canvas', denoise: 0.5, size: null, route: null }],
    ['hires', { method: 'hires', hires: 3072, denoise: 0.45 }],
    ['light', { method: 'light', scene: 'sunset', from: 'ne' }],
  ])('accepts method %s', async (_name, options) => {
    const { generation } = await createGeneration();
    const res = await create('redraw', { generation_id: generation.short_id, options });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('redraw');
    expect(res.body.status).toBe('queued');
    expect(res.body.payload).toEqual({ generation_id: generation.short_id, options });
  });

  it('rejects a missing method, a missing options and an unknown method', async () => {
    const { generation } = await createGeneration();
    expect((await create('redraw', { generation_id: generation.id, options: { denoise: 0.5 } })).status).toBe(400);
    expect((await create('redraw', { generation_id: generation.id })).status).toBe(400);
    expect((await create('redraw', { generation_id: generation.id, options: { method: 'repin' } })).status).toBe(400);
  });

  it('rejects unknown keys and options of another method', async () => {
    const { generation } = await createGeneration();
    expect((await create('redraw', { generation_id: generation.id, options: { method: 'canvas', bogus: 1 } })).status).toBe(400);
    expect((await create('redraw', { generation_id: generation.id, options: { method: 'canvas', hires: 3072 } })).status).toBe(400);
    expect((await create('redraw', { generation_id: generation.id, options: { method: 'hires', denoise: 'light' } })).status).toBe(400);
    expect((await create('redraw', { generation_id: generation.id, options: { method: 'light', scene: 'noon' } })).status).toBe(400);
    expect((await create('redraw', { generation_id: generation.id, options: { method: 'light' }, profile: { name: 'x' } })).status).toBe(400);
  });
});

describe('deliver request', () => {
  it('accepts every option and no options at all', async () => {
    const { generation } = await createGeneration();
    const options = {
      repin: true,
      recolor: false,
      skin: true,
      keep_legwear: 0.5,
      keep_scene: true,
      transparent: true,
      backdrop: 'dots',
      stroke_light: 'n',
      deliver_size: 1536,
      dof: { focus: [0.5, 0.3], f_number: 2.8, scope: 'figure', viewfinder: 'both' },
      light: { scene: 'moon', from: 'w' },
    };
    const full = await create('deliver', { generation_id: generation.id, options });
    expect(full.status).toBe(201);
    expect(full.body.kind).toBe('deliver');
    expect(full.body.payload).toEqual({ generation_id: generation.id, options });
    expect((await create('deliver', { generation_id: generation.id })).status).toBe(201);
  });

  it('rejects unknown keys, including finalize-only and redraw-only options', async () => {
    const { generation } = await createGeneration();
    for (const options of [{ bogus: true }, { denoise: 0.5 }, { method: 'canvas' }, { deliver_only: true }, { repair: ['hands'] }, { hires: 3072 }]) {
      expect((await create('deliver', { generation_id: generation.id, options })).status).toBe(400);
    }
  });
});

describe('claim', () => {
  it('claims redraw and deliver by kinds filter and leaves other kinds queued', async () => {
    const { generation } = await createGeneration();
    const finalize = await create('finalize', { generation_id: generation.id, options: { repin: true } });
    const redraw = await create('redraw', { generation_id: generation.id, options: { method: 'hires' } });
    const deliver = await create('deliver', { generation_id: generation.id });

    const claim = async (kinds: string[]) => {
      const res = await req('/api/v1/requests/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'w', kinds }),
      });
      return res.status === 204 ? null : ((await res.json()) as RequestBody);
    };
    expect((await claim(['redraw', 'deliver']))?.id).toBe(redraw.body.id);
    expect((await claim(['redraw', 'deliver']))?.id).toBe(deliver.body.id);
    expect(await claim(['redraw', 'deliver'])).toBeNull();
    const stillQueued = await getJson<RequestBody>(`/api/v1/requests/${finalize.body.id}`);
    expect(stillQueued.body.status).toBe('queued');
  });
});

describe('jobs and ingest', () => {
  it.each(['redraw', 'deliver'] as const)('%s job requires source_generation_id and its output refines the source', async (kind) => {
    const source = await createGeneration();
    const request = await createRequest({ kind, status: 'running' });

    const missing = await postJson(`/api/v1/requests/${request.body.id}/jobs`, { idempotency_key: crypto.randomUUID(), seed: 1, index: 0 });
    expect(missing.status).toBe(400);

    const job = await postJson<{ id: string }>(`/api/v1/requests/${request.body.id}/jobs`, {
      idempotency_key: crypto.randomUUID(),
      seed: 1,
      index: 0,
      source_generation_id: source.generation.short_id,
    });
    expect(job.status).toBe(201);

    const form = new FormData();
    form.set('metadata', JSON.stringify({ seed: 1, original_filename: 'out.png', comfy_output_index: 0 }));
    form.set('image', new File([TINY_PNG], 'out.png', { type: 'image/png' }));
    const ingested = await req(`/api/v1/jobs/${job.body.id}/generations`, { method: 'POST', body: form });
    expect(ingested.status).toBe(201);
    const out = (await ingested.json()) as { id: string };
    const row = await env.DB.prepare('SELECT refines_generation_id FROM generations WHERE id = ?')
      .bind(out.id)
      .first<{ refines_generation_id: string }>();
    expect(row?.refines_generation_id).toBe(source.generation.id);
  });
});

describe('derive_request through a redraw -> deliver chain', () => {
  it('resolves to the generate Generation across several hops', async () => {
    const raw = await createGeneration({ requestOverrides: { recipe: 'yukari', parameters: { pose: 'lounge' } } });
    const redrawn = await createGeneration({
      requestOverrides: { kind: 'redraw', parameters: { kind: 'redraw' } },
      jobOverrides: { source_generation_id: raw.generation.id },
    });
    const delivered = await createGeneration({
      requestOverrides: { kind: 'deliver', parameters: { kind: 'deliver' } },
      jobOverrides: { source_generation_id: redrawn.generation.id },
    });

    const call = await mcpToolCall<{ payload: { generation: Record<string, unknown>; references: Record<string, unknown>[] } }>('derive_request', {
      from_generation_id: delivered.generation.id,
      instruction: 'again',
      count: 1,
      semantic: { summary: 'x' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation).toMatchObject({ recipe: 'yukari', parameters: { pose: 'lounge' } });
    expect(call.data?.payload.references[0]).toMatchObject({ generation_id: raw.generation.id });
  });
});

describe('MCP create_request', () => {
  it('queues redraw and deliver and enforces the same payload schema', async () => {
    const { generation } = await createGeneration();
    const redraw = await mcpToolCall<{ created: boolean; request: { kind: string } }>('create_request', {
      kind: 'redraw',
      payload: { generation_id: generation.id, options: { method: 'light', scene: 'moon' } },
      idempotency_key: crypto.randomUUID(),
    });
    expect(redraw.isError).toBe(false);
    expect(redraw.data?.request.kind).toBe('redraw');

    const deliver = await mcpToolCall<{ created: boolean; request: { kind: string } }>('create_request', {
      kind: 'deliver',
      payload: { generation_id: generation.id, options: { repin: true } },
      idempotency_key: crypto.randomUUID(),
    });
    expect(deliver.isError).toBe(false);
    expect(deliver.data?.request.kind).toBe('deliver');

    const bad = await mcpToolCall('create_request', {
      kind: 'redraw',
      payload: { generation_id: generation.id, options: { denoise: 0.5 } },
      idempotency_key: crypto.randomUUID(),
    });
    expect(bad.isError).toBe(true);
  });
});

describe('worker asset read', () => {
  it('serves an asset at /g/{uuid}/assets/{role} with its content type', async () => {
    const { generation } = await createGeneration();
    const form = new FormData();
    form.set('metadata', JSON.stringify({ role: 'alpha' }));
    form.set('file', new File([TINY_PNG], 'alpha.png', { type: 'image/png' }));
    const put = await req(`/api/v1/generations/${generation.id}/assets`, { method: 'POST', body: form });
    expect(put.status).toBe(201);

    const res = await req(`/g/${generation.id}/assets/alpha`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TINY_PNG);

    const json = new File([JSON.stringify({ model: 'm' })], 'cut.json', { type: 'application/json' });
    const form2 = new FormData();
    form2.set('metadata', JSON.stringify({ role: 'cut' }));
    form2.set('file', json);
    expect((await req(`/api/v1/generations/${generation.id}/assets`, { method: 'POST', body: form2 })).status).toBe(201);
    const cut = await req(`/g/${generation.id}/assets/cut`);
    expect(cut.status).toBe(200);
    expect(cut.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('requests table rebuild', () => {
  it('accepts the new kinds in the CHECK and keeps the indexes', async () => {
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all<{ name: string }>();
    const names = indexes.results.map((r) => r.name);
    for (const name of ['idx_requests_status_created_at', 'idx_requests_run_id', 'idx_requests_worker_id', 'idx_requests_short_id']) {
      expect(names).toContain(name);
    }
    for (const kind of ['redraw', 'deliver']) {
      expect((await createRequest({ kind: kind as 'redraw' | 'deliver' })).status).toBe(201);
    }
    await expect(env.DB.prepare("UPDATE requests SET kind = 'bogus' WHERE id = (SELECT id FROM requests LIMIT 1)").run()).rejects.toThrow();
  });
});
