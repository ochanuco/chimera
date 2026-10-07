import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, getJson, postJson, req } from './helpers';
import { slotEndIso, slotKeyOf } from '../src/lib/timeline';

interface Timeline {
  slots: { slot: string; count: number }[];
}

async function makeGeneration(createdAt: string, opts: { rating?: 'bad'; tag?: string } = {}) {
  const { generation } = await createGeneration();
  await env.DB.prepare('UPDATE generations SET created_at = ? WHERE id = ?').bind(createdAt, generation.id).run();
  if (opts.rating) {
    await req(`/api/v1/generations/${generation.short_id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: opts.rating }),
    });
  }
  if (opts.tag) await postJson(`/api/v1/generations/${generation.id}/tags`, { name: opts.tag });
  return generation as { id: string; short_id: string };
}

const shortIds = (html: string): string[] => [...html.matchAll(/data-short-id="([^"]+)"/g)].map((m) => m[1]!);
const uniq = (xs: string[]) => [...new Set(xs)];
const hrefOf = (html: string, cls: string): string | null => {
  const m = html.match(new RegExp(`class="${cls}" href="([^"]+)"`));
  return m ? m[1]!.replace(/&amp;/g, '&') : null;
};

describe('slot helpers', () => {
  it('floors created_at to the JST 15-minute slot', () => {
    expect(slotKeyOf('2026-10-06T12:44:59.000Z')).toBe('2026-10-06T21:30');
    expect(slotKeyOf('2026-10-06T12:45:00.000Z')).toBe('2026-10-06T21:45');
    expect(slotKeyOf('2026-10-06T15:10:00.000Z')).toBe('2026-10-07T00:00');
  });

  it('returns the UTC end of a slot and rejects malformed keys', () => {
    expect(slotEndIso('2026-10-06T21:45')).toBe('2026-10-06T13:00:00.000Z');
    expect(slotEndIso('2026-10-06T21:40')).toBeNull();
    expect(slotEndIso('nope')).toBeNull();
  });
});

describe('GET /api/v1/generations/timeline', () => {
  beforeEach(async () => {
    await clearGenerationData();
  });

  it('counts per JST 15-minute slot, newest first', async () => {
    await makeGeneration('2026-10-06T12:44:00.000Z');
    await makeGeneration('2026-10-06T12:46:00.000Z');
    await makeGeneration('2026-10-06T12:50:00.000Z');
    await makeGeneration('2026-10-05T15:20:00.000Z');
    const { status, body } = await getJson<Timeline>('/api/v1/generations/timeline');
    expect(status).toBe(200);
    expect(body.slots).toEqual([
      { slot: '2026-10-06T21:45', count: 2 },
      { slot: '2026-10-06T21:30', count: 1 },
      { slot: '2026-10-06T00:15', count: 1 },
    ]);
  });

  it('applies the same filters as the generation list', async () => {
    const tag = `tl-${crypto.randomUUID().slice(0, 8)}`;
    await makeGeneration('2026-10-06T12:46:00.000Z', { tag });
    await makeGeneration('2026-10-06T12:47:00.000Z', { tag, rating: 'bad' });
    await makeGeneration('2026-10-06T12:30:00.000Z');

    const tagged = await getJson<Timeline>(`/api/v1/generations/timeline?tag=${tag}`);
    expect(tagged.body.slots).toEqual([{ slot: '2026-10-06T21:45', count: 2 }]);

    const hidden = await getJson<Timeline>(`/api/v1/generations/timeline?tag=${tag}&exclude_rating=bad`);
    expect(hidden.body.slots).toEqual([{ slot: '2026-10-06T21:45', count: 1 }]);

    const list = await getJson<{ total: number }>(`/api/v1/generations?tag=${tag}&exclude_rating=bad`);
    expect(hidden.body.slots.reduce((n, s) => n + s.count, 0)).toBe(list.body.total);
  });
});

describe('GET /gallery timeline rendering', () => {
  beforeEach(async () => {
    await clearGenerationData();
  });

  it('puts data-slot on every card, including the live card fragment', async () => {
    const g = await makeGeneration('2026-10-06T12:46:00.000Z');
    const page = await (await req('/gallery?limit=200')).text();
    expect(page).toMatch(/<div class="card" data-slot="2026-10-06T21:45"/);
    const partial = await (await req('/gallery?partial=1&limit=200')).text();
    expect(partial).toContain('data-slot="2026-10-06T21:45"');
    const card = await (await req(`/g/${g.short_id}?partial=card`)).text();
    expect(card).toContain('data-slot="2026-10-06T21:45"');
  });

  it('renders a date header on a date change and a slot header on a slot change', async () => {
    await makeGeneration('2026-10-06T12:50:00.000Z');
    await makeGeneration('2026-10-06T12:46:00.000Z');
    await makeGeneration('2026-10-06T12:30:00.000Z');
    await makeGeneration('2026-10-05T12:30:00.000Z');
    const html = await (await req('/gallery?limit=200')).text();
    expect([...html.matchAll(/data-date-header="([^"]+)"/g)].map((m) => m[1])).toEqual(['2026-10-06', '2026-10-05']);
    expect([...html.matchAll(/data-slot-header="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '2026-10-06T21:45',
      '2026-10-06T21:30',
      '2026-10-05T21:30',
    ]);
    expect(html).toContain('10月6日（火）');
    expect(html).toContain('21:45–22:00');
    expect(html).toContain('data-timeline-query=');
  });

  it('at= starts at the newest item before the end of that slot and renders load-newer', async () => {
    const newest = await makeGeneration('2026-10-06T13:10:00.000Z');
    const inSlot2 = await makeGeneration('2026-10-06T12:50:00.000Z');
    const inSlot1 = await makeGeneration('2026-10-06T12:46:00.000Z');
    const older = await makeGeneration('2026-10-06T12:30:00.000Z');

    const html = await (await req('/gallery?at=2026-10-06T21:45&limit=200')).text();
    expect(uniq(shortIds(html))).toEqual([inSlot2.short_id, inSlot1.short_id, older.short_id]);
    expect(uniq(shortIds(html))).not.toContain(newest.short_id);
    expect(html).toContain('data-gallery-at="2026-10-06T21:45"');
    const newerHref = hrefOf(html, 'load-newer');
    expect(newerHref).toContain('after=');
    const newerHtml = await (await req(`${newerHref}&partial=1`)).text();
    expect(uniq(shortIds(newerHtml))).toEqual([newest.short_id]);
    expect(newerHtml).not.toContain('class="load-newer"');

    const atNewest = await (await req('/gallery?at=2026-10-07T22:00&limit=200')).text();
    expect(uniq(shortIds(atNewest))).toHaveLength(4);
    expect(atNewest).not.toContain('class="load-newer"');
  });

  it('after= returns the next newer items in descending order with a continuing load-newer', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await makeGeneration(`2026-10-06T12:0${i}:00.000Z`)).short_id);
    }
    const afterOldest = await req(`/gallery?partial=1&limit=2&after=${encodeURIComponent(await cursorOfItem(ids[0]!))}`);
    const html = await afterOldest.text();
    expect(uniq(shortIds(html))).toEqual([ids[2], ids[1]]);
    const next = hrefOf(html, 'load-newer');
    expect(next).not.toBeNull();
    const html2 = await (await req(next!.replace('/gallery?', '/gallery?partial=1&'))).text();
    expect(uniq(shortIds(html2))).toEqual([ids[4], ids[3]]);
    expect(html2).not.toContain('class="load-newer"');
    expect(html2).not.toContain('class="load-more"');
  });
});

async function cursorOfItem(shortId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id, created_at FROM generations WHERE short_id = ?')
    .bind(shortId)
    .first<{ id: string; created_at: string }>();
  const bytes = new TextEncoder().encode(`${row!.created_at}|${row!.id}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
