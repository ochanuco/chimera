import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';

describe('Generation Detail: 公開 section', () => {
  it('shows 未公開 for a Generation with no Publication', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}`);
    const html = await res.text();
    expect(html).toContain('未公開');
    expect(html).not.toContain('公開済み');
    expect(html).toContain('投稿 URL（空でも記録できる）');
    expect(html).toContain('公開を記録');
  });

  it('shows 公開済み（N） with the url as a link, or "URL なし" plus a fill-in input, per record', async () => {
    const { generation } = await createGeneration();
    await postJson(`/api/v1/generations/${generation.id}/publications`, { url: 'https://x.com/example/status/42' });
    await postJson(`/api/v1/generations/${generation.id}/publications`, {});

    const res = await req(`/g/${generation.short_id}`);
    const html = await res.text();
    expect(html).toContain('公開済み（2）');
    expect(html).toContain('href="https://x.com/example/status/42"');
    expect(html).toContain('URL なし');
    expect(html).toContain('publication-url-input');
    expect(html).toContain('publication-remove-btn');
  });
});

describe('Gallery: 公開済みのみ checkbox', () => {
  it('is unchecked by default and checked when ?published=true, opening the filter panel', async () => {
    const plain = await req('/gallery?limit=1');
    const plainHtml = await plain.text();
    expect(plainHtml).toContain('name="published"');
    expect(plainHtml).not.toMatch(/name="published"[^>]*checked/);
    expect(plainHtml).toContain('公開済みのみ');
    expect(plainHtml).not.toMatch(/<details class="filter-panel" open/);

    const filtered = await req('/gallery?published=true&limit=1');
    const filteredHtml = await filtered.text();
    expect(filteredHtml).toMatch(/name="published"[^>]*checked/);
    expect(filteredHtml).toMatch(/<details class="filter-panel" open/);
  });

  it('only returns published Generations, and preserves published= across the bad-toggle link', async () => {
    const { generation: published } = await createGeneration();
    const { generation: unpublished } = await createGeneration();
    await postJson(`/api/v1/generations/${published.id}/publications`, {});

    const res = await req('/gallery?published=true&limit=200');
    const html = await res.text();
    expect(html).toContain(published.short_id);
    expect(html).not.toContain(unpublished.short_id);
    expect(html).toContain('published=true');
  });
});
