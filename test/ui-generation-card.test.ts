import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';

async function createRefinementRequest(
  generationId: string,
  kind: 'redraw' | 'deliver' | 'repair' | 'masked_redraw' = 'deliver',
): Promise<string> {
  const payload =
    kind === 'masked_redraw'
      ? { generation_id: generationId, options: { regions: [[0.1, 0.1, 0.5, 0.5]], prompt_patch: 'x', denoise: 0.5 } }
      : kind === 'repair'
        ? { generation_id: generationId, options: { parts: ['hands'] } }
        : kind === 'redraw'
          ? { generation_id: generationId, options: { method: 'canvas' } }
          : { generation_id: generationId, options: { repin: true } };
  const created = await postJson<{ id: string; status: string }>('/api/v1/requests', {
    kind,
    payload,
    idempotency_key: crypto.randomUUID(),
    created_by: 'gui',
  });
  return created.body.id;
}

/**
 * Slices out one card's markup so assertions don't leak into sibling cards or, when a card is
 * the only one in its grid (e.g. a Generation detail page), into the unrelated sections that follow it.
 */
function cardHtml(html: string, shortId: string): string {
  const marker = html.indexOf(`data-short-id="${shortId}"`);
  if (marker === -1) throw new Error(`card for ${shortId} not found in: ${html}`);
  const cardStart = html.lastIndexOf('<div class="card"', marker);
  if (cardStart === -1) throw new Error(`no enclosing .card for ${shortId}`);
  const bookmarkIdx = html.indexOf('card-bookmark-btn', cardStart);
  if (bookmarkIdx === -1) throw new Error(`no card-bookmark-btn after .card for ${shortId}`);
  const closeMarker = '</div></div>';
  const closeIdx = html.indexOf(closeMarker, bookmarkIdx);
  if (closeIdx === -1) throw new Error(`no closing ${closeMarker} after card-bookmark-btn for ${shortId}`);
  return html.slice(cardStart, closeIdx + closeMarker.length);
}

/** Creates a Generation refined from `sourceGenerationId` (its Job's source_generation_id feeds generations.refines_generation_id). */
async function createRefinedGeneration(sourceGenerationId: string) {
  return createGeneration({
    requestOverrides: { kind: 'finalize' },
    jobOverrides: { source_generation_id: sourceGenerationId },
  });
}

describe('GenerationCard: simplified card contents (docs/ui.md「Gallery」)', () => {
  it('Gallery card has the click-to-copy short_id + rating + bookmark and omits tag form / compare checkbox / image meta', async () => {
    const { generation } = await createGeneration();
    const res = await req('/gallery?limit=200');
    const html = await res.text();
    expect(html).toContain('class="grid grid-gallery"');
    const card = cardHtml(html, generation.short_id);

    expect(card).toContain(`data-generation-id="${generation.id}"`);
    expect(card).toContain(`class="copy-id-btn copy-id-text card-id" data-copy-id="${generation.short_id}"`);
    expect(card).toContain('rating-group');
    expect(card).toContain('bookmark-btn');
    expect(card).not.toContain('tag-add-form');
    expect(card).not.toContain('tag-chip');
    expect(card).not.toContain('compare-check');
    expect(card).not.toContain('short-id-link');
    expect(card).not.toContain('image-meta');
  });

  it('a raw, unpublished card shows neither the from-badge nor the 公開済み pill', async () => {
    const { generation } = await createGeneration();
    const res = await req('/gallery?limit=200');
    const html = await res.text();
    const card = cardHtml(html, generation.short_id);
    expect(card).not.toContain('card-from-badge');
    expect(card).not.toContain('card-published-pill');
    expect(card).not.toContain('公開済み');
  });

  it('Gallery card shows the from-badge for a refined output and the 公開済み pill once published', async () => {
    const { generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceGen.id);
    await postJson(`/api/v1/generations/${refined.generation.id}/publications`, {});

    const res = await req('/gallery?view=all&limit=200');
    const html = await res.text();
    const card = cardHtml(html, refined.generation.short_id);

    expect(card).toContain(`元 <span class="card-from-badge-id">${sourceGen.short_id}</span>`);
    expect(card).toContain('公開済み');
  });

  it('the from-badge copies the source short_id without being a nested button', async () => {
    const { generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceGen.id);

    const html = await (await req('/gallery?view=all&limit=200')).text();
    const card = cardHtml(html, refined.generation.short_id);

    expect(card).toContain(
      `<span class="card-from-badge copy-id-btn copy-id-text" role="button" tabindex="0" data-copy-id="${sourceGen.short_id}"`,
    );
  });

  it('Bookmarks generation cards carry the same from-badge and 公開済み pill', async () => {
    const { generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceGen.id);
    await postJson(`/api/v1/generations/${refined.generation.id}/publications`, {});
    await req(`/api/v1/generations/${refined.generation.short_id}/bookmark`, { method: 'PUT' });

    const res = await req('/bookmarks?view=all');
    const html = await res.text();
    const card = cardHtml(html, refined.generation.short_id);

    expect(card).toContain(`元 <span class="card-from-badge-id">${sourceGen.short_id}</span>`);
    expect(card).toContain('公開済み');
    expect(card).not.toContain('tag-add-form');
    expect(card).not.toContain('compare-check');
  });
});

describe('GET /g/:short_id?partial=card (docs/ui.md「Gallery」live insertion)', () => {
  it('returns the same card fragment the Gallery list renders', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}?partial=card`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const card = cardHtml(html, generation.short_id);
    expect(card).toContain(`data-generation-id="${generation.id}"`);
    expect(card).toContain('rating-group');
    expect(card).toContain('bookmark-btn');
  });

  it('accepts a UUID as well as a short_id', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.id}?partial=card`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`data-short-id="${generation.short_id}"`);
  });

  it('404s for an unknown short_id', async () => {
    const res = await req('/g/zzzzzz?partial=card');
    expect(res.status).toBe(404);
  });

  it('includes the request badge when a request targets the generation', async () => {
    const { generation } = await createGeneration();
    const requestId = await createRefinementRequest(generation.id, 'deliver');
    const res = await req(`/g/${generation.short_id}?partial=card`);
    const card = cardHtml(await res.text(), generation.short_id);
    expect(card).toContain('card-request-badge');
    expect(card).toContain(`data-request-id="${requestId}"`);
    expect(card).toContain('納品 · queued');
  });
});

describe('GenerationCard 基準 pill (docs/domain-model.md「基準 render の pin」)', () => {
  function uniqueRecipe(): string {
    return `pose-ref-${crypto.randomUUID()}`;
  }

  function sampleCatalog(recipe: string) {
    return {
      schema_version: 1,
      recipes: [
        {
          name: recipe,
          poses: [{ name: 'lounge', prompt: 'reclining on a beanbag, warm light', costume: 'default' }],
          costumes: [{ name: 'default', prompt: 'plain roomwear' }],
          expressions: [{ name: 'smile', prompt: 'a gentle smile' }],
        },
      ],
      patches: {},
      git_commit: 'abc1234',
      git_branch: 'main',
      generated_at: '2026-09-08T00:00:00.000Z',
    };
  }

  async function publishAndImport(recipe: string): Promise<void> {
    const recipeRef = `test-${crypto.randomUUID()}`;
    await postJson(`/api/v1/catalogs/${recipeRef}`, sampleCatalog(recipe), 'PUT');
    const res = await postJson<{ imported: unknown[] }>('/api/v1/presets/import', { recipe_ref: recipeRef });
    expect(res.status).toBe(200);
  }

  it('shows the pill only once the render is pinned as the pose basis render', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await createGeneration({ requestOverrides: { recipe, parameters: { pose: 'lounge' } } });

    const before = cardHtml(await (await req('/gallery?limit=200')).text(), generation.short_id);
    expect(before).not.toContain('card-reference-pill');

    await postJson(`/api/v1/generations/${generation.id}/rating`, { rating: 'good' }, 'PUT');
    const pin = await postJson(`/api/v1/generations/${generation.id}/pose-reference`, {});
    expect(pin.status).toBe(201);

    const after = cardHtml(await (await req('/gallery?limit=200')).text(), generation.short_id);
    expect(after).toContain('card-reference-pill');
    expect(after).toContain('基準 lounge');
  });
});

describe('GenerationCard request badge (docs/ui.md「Gallery」進捗ピル)', () => {
  it('renders queued / running / done (→ result short_id) / failed as the request transitions', async () => {
    const { generation } = await createGeneration();
    const { generation: resultGen } = await createGeneration();
    const requestId = await createRefinementRequest(generation.id, 'repair');

    let card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('repair · queued');

    await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('running', requestId).run();
    card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('repair · running');

    await env.DB.prepare('UPDATE requests SET status = ?, result_json = ? WHERE id = ?')
      .bind('done', JSON.stringify({ generation_ids: [resultGen.id] }), requestId)
      .run();
    card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('repair · done → ');
    expect(card).toContain(resultGen.short_id);

    await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('failed', requestId).run();
    card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('repair · failed');
  });

  it('labels a masked_redraw request "masked redraw"', async () => {
    const { generation } = await createGeneration();
    await createRefinementRequest(generation.id, 'masked_redraw');
    const card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('masked redraw · queued');
  });

  it('labels a redraw request 描き直し and a deliver request 納品', async () => {
    const { generation: redrawSource } = await createGeneration();
    await createRefinementRequest(redrawSource.id, 'redraw');
    expect(cardHtml(await (await req('/gallery?limit=200')).text(), redrawSource.short_id)).toContain('描き直し · queued');

    const { generation: deliverSource } = await createGeneration();
    await createRefinementRequest(deliverSource.id, 'deliver');
    expect(cardHtml(await (await req('/gallery?limit=200')).text(), deliverSource.short_id)).toContain('納品 · queued');
  });

  it('omits the badge entirely when no redraw/deliver/repair/masked_redraw request targets the generation', async () => {
    const { generation } = await createGeneration();
    const card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).not.toContain('card-request-badge');
  });
});
