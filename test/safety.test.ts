import { describe, expect, it } from 'vitest';
import { computeSafetyVerdict } from '../src/lib/safety';
import { createGeneration, getJson, mcpToolCall, postJson } from './helpers';

const rating = (sensitive: number, questionable: number) => ({ general: 0.1, sensitive, questionable, explicit: 0 });

interface Safety {
  model: string;
  rating: { general: number; sensitive: number; questionable: number; explicit: number };
  verdict: string;
  reasons: string[];
  rated_at: string;
  tags?: Record<string, number>;
}

const body = (r: ReturnType<typeof rating>, tags: Record<string, number> = {}) => ({ model: 'wd-test@abc', rating: r, tags });

describe('computeSafetyVerdict', () => {
  it('blocks on an exposure tag >= 0.15', () => {
    const v = computeSafetyVerdict(rating(0.3, 0.1), { pussy: 0.3 });
    expect(v).toEqual({ verdict: 'block', reasons: ['pussy 0.30'] });
  });

  it('block wins over sensitive', () => {
    expect(computeSafetyVerdict(rating(0, 0.9), { nipples: 0.15 }).verdict).toBe('block');
  });

  it('flags questionable 0.49 as sensitive', () => {
    expect(computeSafetyVerdict(rating(0.4, 0.49), {})).toEqual({ verdict: 'sensitive', reasons: ['questionable 0.49'] });
  });

  it('leaves sensitive 0.73 with questionable 0.0 alone', () => {
    expect(computeSafetyVerdict(rating(0.73, 0), { breasts: 0.9 })).toEqual({ verdict: 'none', reasons: [] });
  });

  it('leaves sensitive 0.975 alone when only legwear and feet show', () => {
    expect(computeSafetyVerdict(rating(0.975, 0.007), { pantyhose: 0.99, feet: 0.9, soles: 0.8 })).toEqual({ verdict: 'none', reasons: [] });
  });

  it('cautions on a butt/underwear tag from 0.5', () => {
    expect(computeSafetyVerdict(rating(0.5, 0.007), { ass: 0.6, panties: 0.7, cleavage: 0.4 })).toEqual({
      verdict: 'caution',
      reasons: ['panties 0.70', 'ass 0.60'],
    });
    expect(computeSafetyVerdict(rating(0.5, 0.007), { ass: 0.49 }).verdict).toBe('none');
  });

  it('flags a chest/crotch tag from 0.35 as sensitive', () => {
    expect(computeSafetyVerdict(rating(0.5, 0.007), { cameltoe: 0.4, ass: 0.9 })).toEqual({
      verdict: 'sensitive',
      reasons: ['cameltoe 0.40'],
    });
    expect(computeSafetyVerdict(rating(0.5, 0.007), { cameltoe: 0.3 }).verdict).toBe('none');
  });

  it('flags questionable 0.2 as sensitive', () => {
    expect(computeSafetyVerdict(rating(0.5, 0.2), {}).verdict).toBe('sensitive');
  });

  it('ignores exposure tags below the threshold', () => {
    expect(computeSafetyVerdict(rating(0, 0), { pussy: 0.149 }).verdict).toBe('none');
  });
});

describe('PUT /api/v1/generations/{id}/safety', () => {
  it('stores scores, overwrites on repeat, and surfaces the verdict on get/list', async () => {
    const { generation } = await createGeneration();
    const put = await postJson<Safety>(`/api/v1/generations/${generation.short_id}/safety`, body(rating(0.2, 0.49), { shirt: 0.9 }), 'PUT');
    expect(put.status).toBe(200);
    expect(put.body.verdict).toBe('sensitive');

    const again = await postJson<Safety>(`/api/v1/generations/${generation.id}/safety`, body(rating(0.2, 0), { pussy: 0.3 }), 'PUT');
    expect(again.body.verdict).toBe('block');

    const detail = await getJson<{ safety: Safety }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.safety.verdict).toBe('block');
    expect(detail.body.safety.reasons).toEqual(['pussy 0.30']);
    expect(detail.body.safety.tags).toEqual({ pussy: 0.3 });

    const list = await getJson<{ items: { id: string; safety: Safety | null }[] }>('/api/v1/generations?limit=200');
    const item = list.body.items.find((i) => i.id === generation.id);
    expect(item?.safety?.verdict).toBe('block');
    expect(item?.safety?.tags).toBeUndefined();

    const mcp = await mcpToolCall<{ safety: Safety }>('get_generation', { generation_id: generation.short_id });
    expect(mcp.data?.safety.verdict).toBe('block');
  });

  it('is null before rating', async () => {
    const { generation } = await createGeneration();
    const detail = await getJson<{ safety: Safety | null }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.safety).toBeNull();
  });

  it('rejects bad input with 400 and unknown generations with 404', async () => {
    const { generation } = await createGeneration();
    const url = `/api/v1/generations/${generation.id}/safety`;
    expect((await postJson(url, { model: 'm', rating: { general: 1 }, tags: {} }, 'PUT')).status).toBe(400);
    expect((await postJson(url, body(rating(1.5, 0)), 'PUT')).status).toBe(400);
    expect((await postJson(url, { ...body(rating(0, 0)), tags: { a: 'x' } }, 'PUT')).status).toBe(400);
    expect((await postJson(url, { rating: rating(0, 0), tags: {} }, 'PUT')).status).toBe(400);
    expect((await postJson('/api/v1/generations/nope0000/safety', body(rating(0, 0)), 'PUT')).status).toBe(404);
  });
});

describe('publish warning', () => {
  interface Pub {
    id: string;
    warning: { verdict: string; reasons: string[]; message: string } | null;
  }

  it('warns on block and sensitive without rejecting, and stays null otherwise', async () => {
    const { generation } = await createGeneration();
    const url = `/api/v1/generations/${generation.id}/publications`;

    const unrated = await postJson<Pub>(url, {});
    expect(unrated.status).toBe(201);
    expect(unrated.body.warning).toBeNull();

    await postJson(`/api/v1/generations/${generation.id}/safety`, body(rating(0.2, 0.49)), 'PUT');
    const sensitive = await postJson<Pub>(url, {});
    expect(sensitive.status).toBe(201);
    expect(sensitive.body.warning?.verdict).toBe('sensitive');

    await postJson(`/api/v1/generations/${generation.id}/safety`, body(rating(0.2, 0), { pussy: 0.3 }), 'PUT');
    const mcp = await mcpToolCall<Pub>('record_publication', { generation_id: generation.short_id });
    expect(mcp.isError).toBe(false);
    expect(mcp.data?.warning?.verdict).toBe('block');
    expect(mcp.data?.warning?.reasons).toEqual(['pussy 0.30']);

    await postJson(`/api/v1/generations/${generation.id}/safety`, body(rating(0.73, 0)), 'PUT');
    const fine = await postJson<Pub>(url, {});
    expect(fine.body.warning).toBeNull();
  });
});
