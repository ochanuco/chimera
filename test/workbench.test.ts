import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, createRequest, getJson, req } from './helpers';

beforeEach(async () => {
  await clearGenerationData();
});

type Kind = 'redraw' | 'repair' | 'masked_redraw' | 'deliver' | 'dof';

async function derive(source: { id: string; short_id: string }, kind: Kind, options?: Record<string, unknown>) {
  const { generation } = await createGeneration({
    requestOverrides: { kind, status: 'done', payload: { generation_id: source.short_id, ...(options ? { options } : {}) } },
    jobOverrides: { source_generation_id: source.id },
  });
  return generation as { id: string; short_id: string };
}

interface Tree {
  root_id: string;
  nodes: {
    id: string;
    short_id: string;
    refines_generation_id: string | null;
    kind: string;
    method: string | null;
    phase: number | null;
    options: Record<string, unknown> | null;
    rating: string | null;
    delivered: boolean;
    created_at: string;
  }[];
  pending: {
    request_id: string;
    kind: string;
    method: string | null;
    phase: number | null;
    options: Record<string, unknown> | null;
    source_generation_id: string;
    status: string;
    created_at: string;
  }[];
}

function put(rootId: string, body: unknown) {
  return req(`/api/v1/workbenches/${rootId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('GET /api/v1/generations/:id/tree', () => {
  it('returns the whole subtree from any node, with kind, method, phase, options and delivered', async () => {
    const { generation: root } = await createGeneration();
    const hires = await derive(root, 'redraw', { method: 'hires', hires: 3072 });
    const light = await derive(hires, 'redraw', { method: 'light', scene: 'sunset' });
    const canvas = await derive(root, 'redraw', { method: 'canvas', denoise: 0.5 });
    const repair = await derive(light, 'repair', { parts: ['hands'] });
    const masked = await derive(light, 'masked_redraw', { regions: [[0, 0, 0.5, 0.5]], prompt_patch: 'x' });
    const deliver = await derive(repair, 'deliver', { backdrop: null });
    const dof = await derive(deliver, 'dof', { focus: [0.5, 0.5] });
    const other = await createGeneration();
    await derive(other.generation, 'redraw', { method: 'hires' });

    const fromLeaf = await getJson<Tree>(`/api/v1/generations/${dof.short_id}/tree`);
    expect(fromLeaf.status).toBe(200);
    expect(fromLeaf.body.root_id).toBe(root.id);
    const byId = new Map(fromLeaf.body.nodes.map((n) => [n.id, n]));
    expect(byId.size).toBe(8);
    expect(byId.has(other.generation.id)).toBe(false);

    const expected: [{ id: string }, string, string | null, number | null, boolean][] = [
      [root, 'generate', null, null, false],
      [hires, 'redraw', 'hires', 1, false],
      [light, 'redraw', 'light', 2, false],
      [canvas, 'redraw', 'canvas', 1, false],
      [repair, 'repair', null, 3, false],
      [masked, 'masked_redraw', null, 3, false],
      [deliver, 'deliver', null, 4, true],
      [dof, 'dof', null, 5, true],
    ];
    for (const [g, kind, method, phase, delivered] of expected) {
      expect(byId.get(g.id), kind).toMatchObject({ kind, method, phase, delivered });
    }
    expect(byId.get(hires.id)?.options).toEqual({ method: 'hires', hires: 3072 });
    expect(byId.get(hires.id)?.refines_generation_id).toBe(root.id);
    expect(byId.get(root.id)?.options).toBeNull();
    expect(byId.get(root.id)?.refines_generation_id).toBeNull();

    const fromRoot = await getJson<Tree>(`/api/v1/generations/${root.id}/tree`);
    expect(fromRoot.body.nodes.map((n) => n.id).sort()).toEqual(fromLeaf.body.nodes.map((n) => n.id).sort());
  });

  it('carries the rating', async () => {
    const { generation: root } = await createGeneration();
    await req(`/api/v1/generations/${root.id}/rating`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 'good' }) });
    const tree = await getJson<Tree>(`/api/v1/generations/${root.short_id}/tree`);
    expect(tree.body.nodes[0]?.rating).toBe('good');
  });

  it('lists queued and running requests targeting the subtree as pending, not finished or foreign ones', async () => {
    const { generation: root } = await createGeneration();
    const child = await derive(root, 'redraw', { method: 'hires' });
    const other = await createGeneration();
    const queued = await createRequest({ kind: 'redraw', status: 'queued', payload: { generation_id: root.short_id, options: { method: 'canvas' } } });
    const running = await createRequest({ kind: 'deliver', status: 'running', payload: { generation_id: child.id } });
    await createRequest({ kind: 'redraw', status: 'failed', payload: { generation_id: root.id, options: { method: 'hires' } } });
    await createRequest({ kind: 'redraw', status: 'done', payload: { generation_id: root.id, options: { method: 'hires' } } });
    await createRequest({ kind: 'redraw', status: 'queued', payload: { generation_id: other.generation.id, options: { method: 'hires' } } });

    const tree = await getJson<Tree>(`/api/v1/generations/${child.short_id}/tree`);
    expect(tree.body.pending.map((p) => p.request_id).sort()).toEqual([queued.body.id, running.body.id].sort());
    const byId = new Map(tree.body.pending.map((p) => [p.request_id, p]));
    expect(byId.get(queued.body.id)).toMatchObject({ kind: 'redraw', method: 'canvas', phase: 1, source_generation_id: root.id, status: 'queued' });
    expect(byId.get(running.body.id)).toMatchObject({ kind: 'deliver', method: null, phase: 4, source_generation_id: child.id, status: 'running' });
  });

  it('404s for an unknown generation', async () => {
    expect((await getJson('/api/v1/generations/nope00/tree')).status).toBe(404);
  });
});

describe('/api/v1/workbenches/:rootId', () => {
  it('returns empty picks before any save', async () => {
    const { generation: root } = await createGeneration();
    const res = await getJson<{ root_generation_id: string; picks: unknown; updated_at: string | null }>(`/api/v1/workbenches/${root.short_id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ root_generation_id: root.id, picks: {}, updated_at: null });
  });

  it('replaces picks as a whole, storing ids for short_ids and keeping skips', async () => {
    const { generation: root } = await createGeneration();
    const child = await derive(root, 'redraw', { method: 'hires' });
    const grand = await derive(child, 'redraw', { method: 'light', scene: 'moon' });

    const first = await put(root.short_id, { picks: { '1': { generation_id: child.short_id }, '2': { skip: true } } });
    expect(first.status).toBe(200);
    const saved = (await first.json()) as { root_generation_id: string; picks: unknown; updated_at: string };
    expect(saved.root_generation_id).toBe(root.id);
    expect(saved.picks).toEqual({ '1': { generation_id: child.id }, '2': { skip: true } });

    const second = await put(root.id, { picks: { '2': { generation_id: grand.id } } });
    expect(second.status).toBe(200);
    const read = await getJson<{ picks: unknown; updated_at: string }>(`/api/v1/workbenches/${root.id}`);
    expect(read.body.picks).toEqual({ '2': { generation_id: grand.id } });
    expect(read.body.updated_at >= saved.updated_at).toBe(true);

    const cleared = await put(root.id, { picks: {} });
    expect(cleared.status).toBe(200);
    expect((await getJson<{ picks: unknown }>(`/api/v1/workbenches/${root.id}`)).body.picks).toEqual({});
  });

  it.each([
    ['a phase key outside 1..5', { '6': { skip: true } }],
    ['phase 0', { '0': { skip: true } }],
    ['skip false', { '1': { skip: false } }],
    ['an empty pick', { '1': {} }],
    ['an unknown pick key', { '1': { generation_id: 'x', skip: true } }],
  ])('rejects %s', async (_label, picks) => {
    const { generation: root } = await createGeneration();
    expect((await put(root.id, { picks })).status).toBe(400);
  });

  it('rejects a body without picks and an extra key', async () => {
    const { generation: root } = await createGeneration();
    expect((await put(root.id, {})).status).toBe(400);
    expect((await put(root.id, { picks: {}, extra: 1 })).status).toBe(400);
  });

  it('rejects a pick outside the root subtree', async () => {
    const { generation: root } = await createGeneration();
    const other = await createGeneration();
    const res = await put(root.id, { picks: { '1': { generation_id: other.generation.id } } });
    expect(res.status).toBe(400);
    expect((await getJson<{ picks: unknown }>(`/api/v1/workbenches/${root.id}`)).body.picks).toEqual({});
  });

  it('rejects a non-root generation and 404s an unknown one', async () => {
    const { generation: root } = await createGeneration();
    const child = await derive(root, 'redraw', { method: 'hires' });
    expect((await getJson(`/api/v1/workbenches/${child.id}`)).status).toBe(400);
    expect((await put(child.id, { picks: {} })).status).toBe(400);
    expect((await getJson('/api/v1/workbenches/nope00')).status).toBe(404);
    expect((await put('nope00', { picks: {} })).status).toBe(404);
  });
});
