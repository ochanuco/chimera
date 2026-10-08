import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, postJson, req, getJson } from './helpers';

beforeEach(async () => {
  await clearGenerationData();
});

const SOURCE_PAYLOAD = {
  schema_version: 1,
  request: { instruction: 'a look', count: 2, seeds: [11, 22] },
  generation: { recipe: 'yukari-anima', parameters: { pose: 'sit' } },
  semantic: { summary: 'a look' },
  experiment: { experiment_id: 'e', run_id: 'r' },
};

async function rawSource() {
  const { generation } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima', payload: SOURCE_PAYLOAD } });
  return generation;
}

interface RerollBody {
  root: { id: string; short_id: string };
  recipe: string | null;
  rounds: {
    request: { id: string; status: string };
    generations: { id: string; short_id: string; rating: string | null; bookmark: boolean }[];
  }[];
}

async function finish(requestId: string) {
  await env.DB.prepare("UPDATE requests SET status = 'done' WHERE id = ?").bind(requestId).run();
}

async function rerollRows() {
  const { results } = await env.DB.prepare('SELECT * FROM requests WHERE reroll_of_generation_id IS NOT NULL').all<{
    id: string;
    kind: string;
    status: string;
    payload_json: string;
    created_by: string;
    idempotency_key: string;
    reroll_of_generation_id: string;
  }>();
  return results;
}

describe('POST /api/v1/generations/{id}/reroll', () => {
  it('queues one generate request with the same payload minus seeds, four images, and a link to the original', async () => {
    const source = await rawSource();
    const res = await postJson<RerollBody>(`/api/v1/generations/${source.short_id}/reroll`, {});
    expect(res.status).toBe(201);
    expect(res.body.root.id).toBe(source.id);
    expect(res.body.rounds).toHaveLength(1);
    expect(res.body.rounds[0]!.request.status).toBe('queued');

    const rows = await rerollRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('generate');
    expect(row.created_by).toBe('gui');
    expect(row.reroll_of_generation_id).toBe(source.id);
    expect(row.idempotency_key).toBe(`reroll:${source.id}:1`);
    expect(JSON.parse(row.payload_json)).toEqual({
      schema_version: 1,
      request: { instruction: 'a look', count: 4 },
      generation: SOURCE_PAYLOAD.generation,
      semantic: SOURCE_PAYLOAD.semantic,
    });
  });

  it('returns the in-flight round on a second call instead of queueing another', async () => {
    const source = await rawSource();
    const first = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    const second = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    expect(second.status).toBe(200);
    expect(second.body.rounds.map((r) => r.request.id)).toEqual([first.body.rounds[0]!.request.id]);
    expect(await rerollRows()).toHaveLength(1);
  });

  it('queues a new round under its own idempotency key once the latest one has finished', async () => {
    const source = await rawSource();
    const first = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    await finish(first.body.rounds[0]!.request.id);
    const second = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    expect(second.status).toBe(201);
    expect(second.body.rounds).toHaveLength(2);
    const rows = await rerollRows();
    expect(rows.map((r) => r.idempotency_key).sort()).toEqual([`reroll:${source.id}:1`, `reroll:${source.id}:2`]);
    expect(new Set(rows.map((r) => r.reroll_of_generation_id))).toEqual(new Set([source.id]));
  });

  it('resolves a refined Generation to its raw source', async () => {
    const source = await rawSource();
    const { generation: refined } = await createGeneration({
      requestOverrides: { kind: 'redraw', status: 'done', payload: { generation_id: source.short_id, options: { method: 'hires' } } },
      jobOverrides: { source_generation_id: source.id },
    });
    const res = await postJson<RerollBody>(`/api/v1/generations/${refined.short_id}/reroll`, {});
    expect(res.status).toBe(201);
    expect(res.body.root.id).toBe(source.id);
    expect((await rerollRows())[0]!.reroll_of_generation_id).toBe(source.id);
  });

  it('refuses a Generation that did not come from a recipe-driven generate request', async () => {
    const { generation } = await createGeneration({ requestOverrides: { payload: { schema_version: 1, request: { instruction: 'x' } } } });
    const res = await postJson<{ error: { code: string } }>(`/api/v1/generations/${generation.id}/reroll`, {});
    expect(res.status).toBe(409);
    expect(await rerollRows()).toHaveLength(0);
  });
});

describe('GET /api/v1/generations/{id}/reroll', () => {
  it('reports no rounds before a reroll and the rounds oldest first after', async () => {
    const source = await rawSource();
    const before = await getJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`);
    expect(before.body.rounds).toEqual([]);
    expect(before.body.recipe).toBe('yukari-anima');

    const created = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    const firstId = created.body.rounds[0]!.request.id;
    await finish(firstId);
    const { generation } = await createGeneration({ requestId: firstId });
    const next = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    const secondId = next.body.rounds[1]!.request.id;

    const after = await getJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`);
    expect(after.body.rounds.map((r) => r.request.id)).toEqual([firstId, secondId]);
    expect(after.body.rounds[0]!.request.status).toBe('done');
    expect(after.body.rounds[0]!.generations.map((g) => g.id)).toEqual([generation.id]);
    expect(after.body.rounds[1]!.request.status).toBe('queued');
    expect(after.body.rounds[1]!.generations).toEqual([]);
  });
});

describe('GET /reroll/{short_id}', () => {
  it('renders the original, four tiles, the shared caption actions and the run button before any reroll', async () => {
    const source = await rawSource();
    const html = await (await req(`/reroll/${source.short_id}`)).text();
    expect(html).toContain('data-reroll');
    expect(html).toContain('data-wb-input-pane');
    for (let i = 0; i < 4; i++) {
      expect(html).toContain(`data-rr-pane="${i}"`);
      expect(html).toContain(`data-wb-cap-actions="r${i}"`);
    }
    expect(html).toContain('data-wb-cap-actions="input"');
    expect(html).toContain('copy-id-btn copy-id-text');
    expect(html).toContain('data-wb-cap-work');
    expect(html).toContain('data-wb-bookmark');
    expect(html).toContain('data-wb-loupe-toggle');
    expect(html).toContain('4 枚振る');
    expect(html).not.toContain('もう 4 枚振る');
    expect(html).not.toMatch(/data-rr-run[^>]*hidden/);
    expect(html).toContain(`href="/g/${source.short_id}"`);
    expect(html).toContain('yukari-anima');
  });

  it('shows a tab per round and a disabled busy button while the latest round is in flight', async () => {
    const source = await rawSource();
    const first = await postJson<RerollBody>(`/api/v1/generations/${source.id}/reroll`, {});
    const busy = await (await req(`/reroll/${source.short_id}`)).text();
    expect(busy).toContain('data-rr-round="0"');
    expect(busy).toContain('1 回目');
    expect(busy).toMatch(/data-rr-run[^>]*disabled/);
    expect(busy).toContain('処理中…');

    await finish(first.body.rounds[0]!.request.id);
    await postJson(`/api/v1/generations/${source.id}/reroll`, {});
    await env.DB.prepare("UPDATE requests SET status = 'done' WHERE reroll_of_generation_id = ?").bind(source.id).run();
    const html = await (await req(`/reroll/${source.short_id}`)).text();
    expect(html).toContain('data-rr-round="1"');
    expect(html).toContain('2 回目');
    expect(html).toContain('もう 4 枚振る');
    expect(html).not.toMatch(/data-rr-run[^>]*(hidden|disabled)/);
  });

  it('redirects a refined Generation to its raw source and 404s an unknown id', async () => {
    const source = await rawSource();
    const { generation: refined } = await createGeneration({
      requestOverrides: { kind: 'redraw', status: 'done', payload: { generation_id: source.short_id } },
      jobOverrides: { source_generation_id: source.id },
    });
    const res = await req(`/reroll/${refined.short_id}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/reroll/${source.short_id}`);
    expect((await req('/reroll/nope')).status).toBe(404);
  });
});

describe('reroll entry points', () => {
  it('links to /reroll from /g/{id} when the original can be rerolled and not otherwise', async () => {
    const source = await rawSource();
    const html = await (await req(`/g/${source.short_id}`)).text();
    expect(html).toContain(`href="/reroll/${source.short_id}"`);

    const { generation: plain } = await createGeneration({ requestOverrides: { payload: { schema_version: 1, request: { instruction: 'x' } } } });
    expect(await (await req(`/g/${plain.short_id}`)).text()).not.toContain(`href="/reroll/${plain.short_id}"`);
  });

  it('puts a reroll link on gallery cards of raw Generations only', async () => {
    const source = await rawSource();
    const { generation: refined } = await createGeneration({
      requestOverrides: { kind: 'redraw', status: 'done', payload: { generation_id: source.short_id } },
      jobOverrides: { source_generation_id: source.id },
    });
    const html = await (await req('/gallery')).text();
    expect(html).toContain(`href="/reroll/${source.short_id}"`);
    expect(html).not.toContain(`href="/reroll/${refined.short_id}"`);
  });
});
