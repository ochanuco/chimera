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
  it('shows the four cells, threshold tick and risky tags without folding', async () => {
    const g = await rated(rating(0.975), { pantyhose: 0.96, sitting: 0.82, feet: 0.3, ass: 0.2, cameltoe: 0.2, shirt: 0.9 });
    const html = await (await req(`/g/${g.short_id}`)).text();
    expect(html).not.toContain('<details class="safety-row"');
    expect(html.match(/class="safety-cell[ "]/g)).toHaveLength(4);
    for (const label of ['全年齢', '少し際どい', 'かなり際どい', '成人向け']) expect(html).toContain(`>${label}<`);
    expect(html).toContain('97.5%');
    expect(html.match(/class="safety-cell-tick"/g)).toHaveLength(1);
    expect(html).toContain('left:15%');
    expect(html).toContain('/ 15%');
    expect(html).not.toContain('safety-cell over');
    expect(html).toContain('問題なし');
    expect(html).toContain('少し際どい');
    expect(html).not.toContain('で注意');
    expect(html).not.toContain('rating-bar-stack');
    expect(html).not.toContain('safety-gauge');
    expect(html).not.toContain('あと ');
    expect(html).not.toContain('超過');
    expect(html).not.toContain('効いていそうなタグ');
    expect(html).toMatch(/safety-tag risk-certain">cameltoe/);
    expect(html).toMatch(/safety-tag risk-suspect">ass/);
    expect(html).toMatch(/safety-tag risk-safe hot">pantyhose/);
    expect(html).toMatch(/safety-tag risk-safe">feet/);
    expect(html).not.toContain('>shirt<');
    expect(html.indexOf('cameltoe')).toBeLessThan(html.indexOf('>ass<'));
    expect(html.indexOf('>ass<')).toBeLessThan(html.indexOf('pantyhose'));
    expect(html.indexOf('pantyhose')).toBeLessThan(html.indexOf('sitting'));
  });

  it('marks the かなり際どい cell over once it reaches the threshold', async () => {
    const g = await rated(rating(0.5, 0.27));
    const html = await (await req(`/g/${g.short_id}`)).text();
    expect(html.match(/class="safety-cell over"/g)).toHaveLength(1);
    expect(html).toMatch(/safety-cell over"[^>]*--p:27%/);
    expect(html).toContain('27.0%');
  });

  it('explains a caution from the butt tag', async () => {
    const g = await rated(rating(0.5), { ass: 0.6 });
    const html = await (await req(`/g/${g.short_id}`)).text();
    expect(html).toContain('ass 60%');
    expect(html).toContain('尻・下着のタグ 50% 以上で注意');
  });

  it('explains a sensitive verdict from a chest/crotch tag or questionable', async () => {
    const a = await rated(rating(0.5), { cameltoe: 0.4 });
    expect(await (await req(`/g/${a.short_id}`)).text()).toContain('cameltoe 40%');
    const b = await rated(rating(0.5, 0.2));
    expect(await (await req(`/g/${b.short_id}`)).text()).toContain('かなり際どい 20%');
  });

  it('keeps the exposure reason for block', async () => {
    const g = await rated(rating(0.975), { nipples: 0.3 });
    const html = await (await req(`/g/${g.short_id}`)).text();
    expect(html).toContain('露出タグ nipples 30%');
    expect(html).toMatch(/safety-tag risk-exposure">nipples/);
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
    const g = await rated(rating(0.975), { ass: 0.6 });
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
