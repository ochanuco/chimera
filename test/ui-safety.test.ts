import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';

const rating = (sensitive: number, questionable = 0.001) => ({ general: 0.05, sensitive, questionable, explicit: 0.0002 });

async function rated(r: ReturnType<typeof rating>, tags: Record<string, number> = {}) {
  const { generation } = await createGeneration();
  const put = await postJson(`/api/v1/generations/${generation.id}/safety`, { model: 'wd-test@abc', rating: r, tags }, 'PUT');
  expect(put.status).toBe(200);
  return generation as { id: string; short_id: string };
}

describe('detail page 安全性 section', () => {
  it('shows the bar, gauges and risky tags without folding', async () => {
    const g = await rated(rating(0.931), { pantyhose: 0.96, sitting: 0.82, feet: 0.3, ass: 0.2, yokozuwari: 0.1, shirt: 0.9 });
    const html = await (await req(`/g/${g.short_id}`)).text();
    expect(html).not.toContain('<details class="safety-row"');
    expect(html).toContain('rating-bar-stack');
    expect(html).toContain('問題なし');
    expect(html).toContain('あと 1.9pt で注意');
    expect(html).toContain('safety-gap near');
    expect(html).toContain('あと 14.9pt でセンシティブ');
    expect(html).toContain('効いていそうなタグ');
    expect(html).toMatch(/safety-tag axis-sensitive hot">pantyhose/);
    expect(html).toMatch(/safety-tag axis-sensitive">feet/);
    expect(html).toMatch(/safety-tag axis-questionable">ass/);
    expect(html).toMatch(/safety-tag axis-neutral">yokozuwari/);
    expect(html).toContain('axis-key axis-questionable');
    expect(html).not.toContain('>shirt<');
    expect(html.indexOf('pantyhose')).toBeLessThan(html.indexOf('sitting'));
  });

  it('reports the threshold overshoot and keeps the exposure reason for block', async () => {
    const g = await rated(rating(0.975), { nipples: 0.3 });
    const html = await (await req(`/g/${g.short_id}`)).text();
    expect(html).toContain('注意の閾値を 2.5pt 超過');
    expect(html).toContain('露出タグ nipples 30%');
    expect(html).toMatch(/safety-tag axis-exposure">nipples/);
  });
});

describe('gallery card', () => {
  it('draws the strip and the hover percentage for a none verdict', async () => {
    const g = await rated(rating(0.931));
    const html = await (await req(`/g/${g.short_id}?partial=card`)).text();
    expect(html).toContain('rating-bar-strip');
    expect(html).toContain('際 93.1%');
  });

  it('draws the strip without the percentage when a badge shows', async () => {
    const g = await rated(rating(0.975));
    const html = await (await req(`/g/${g.short_id}?partial=card`)).text();
    expect(html).toContain('rating-bar-strip');
    expect(html).toContain('safety-badge-caution');
    expect(html).not.toContain('card-safety-pct');
  });

  it('omits the strip when unrated', async () => {
    const { generation } = await createGeneration();
    const html = await (await req(`/g/${generation.short_id}?partial=card`)).text();
    expect(html).not.toContain('rating-bar-strip');
  });
});

describe('compare page', () => {
  it('shows the 少し際どい delta against the first image', async () => {
    const a = await rated(rating(0.975));
    const b = await rated(rating(0.931));
    const html = await (await req(`/compare?ids=${a.short_id},${b.short_id}`)).text();
    expect(html.match(/class="rating-bar rating-bar-mini"/g)).toHaveLength(2);
    expect(html).toContain('97.5%');
    expect(html).toContain('safety-delta down">-4.4pt');
    expect(html).toContain('safety-delta">—');
  });
});
