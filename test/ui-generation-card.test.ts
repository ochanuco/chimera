import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';

/**
 * Slices out one card's markup (`<div class="card">...</div></div>`) so assertions don't leak
 * into sibling cards or, when a card is the only one in its grid (e.g. Batch Detail), into the
 * unrelated sections that follow it on the page.
 */
function cardHtml(html: string, shortId: string): string {
  const marker = html.indexOf(`data-short-id="${shortId}"`);
  if (marker === -1) throw new Error(`card for ${shortId} not found in: ${html}`);
  const cardStart = html.lastIndexOf('<div class="card">', marker);
  if (cardStart === -1) throw new Error(`no enclosing .card for ${shortId}`);
  const bookmarkIdx = html.indexOf('card-bookmark-btn', cardStart);
  if (bookmarkIdx === -1) throw new Error(`no card-bookmark-btn after .card for ${shortId}`);
  const closeMarker = '</div></div>';
  const closeIdx = html.indexOf(closeMarker, bookmarkIdx);
  if (closeIdx === -1) throw new Error(`no closing ${closeMarker} after card-bookmark-btn for ${shortId}`);
  return html.slice(cardStart, closeIdx + closeMarker.length);
}

/** Creates a Generation whose Batch refines `sourceGen` (batches.refines_generation_id, src/lib/batch-refinement.ts). */
async function createRefinedGeneration(sourceBatchId: string, sourceGenerationId: string) {
  return createGeneration({
    batchOverrides: {
      refinement: { source_batch_id: sourceBatchId, actor: 'claude', reason: 'finalize' },
      references: [{ source_generation_id: sourceGenerationId, purpose: 'rebuild' }],
    },
  });
}

describe('GenerationCard: simplified card contents (docs/ui.md「Gallery」)', () => {
  it('Gallery card has rating + bookmark and omits tag form / compare checkbox / short_id link text', async () => {
    const { generation } = await createGeneration();
    const res = await req('/gallery?limit=200');
    const html = await res.text();
    const card = cardHtml(html, generation.short_id);

    expect(card).toContain(`data-generation-id="${generation.id}"`);
    expect(card).toContain('rating-group');
    expect(card).toContain('bookmark-btn');
    expect(card).not.toContain('tag-add-form');
    expect(card).not.toContain('tag-chip');
    expect(card).not.toContain('compare-check');
    expect(card).not.toContain('short-id-link');
    expect(card).not.toContain('image-meta');
    // the thumbnail link still carries the short_id (href / data attribute / alt), just no
    // visible short_id text link or copy button next to it
    expect(card).not.toContain('copy-id-btn');
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
    const { batch: sourceBatch, generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceBatch.id, sourceGen.id);
    await postJson(`/api/v1/generations/${refined.generation.id}/publications`, {});

    const res = await req('/gallery?view=all&limit=200');
    const html = await res.text();
    const card = cardHtml(html, refined.generation.short_id);

    expect(card).toContain(`from <span class="card-from-badge-id">${sourceGen.short_id}</span>`);
    expect(card).toContain('公開済み');
  });

  it('Batch Detail generation cards carry the same from-badge and 公開済み pill', async () => {
    const { batch: sourceBatch, generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceBatch.id, sourceGen.id);
    await postJson(`/api/v1/generations/${refined.generation.id}/publications`, {});

    const res = await req(`/b/${refined.batch.short_id}`);
    const html = await res.text();
    const card = cardHtml(html, refined.generation.short_id);

    expect(card).toContain(`from <span class="card-from-badge-id">${sourceGen.short_id}</span>`);
    expect(card).toContain('公開済み');
    expect(card).not.toContain('tag-add-form');
    expect(card).not.toContain('compare-check');
  });

  it('Bookmarks generation cards carry the same from-badge and 公開済み pill', async () => {
    const { batch: sourceBatch, generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceBatch.id, sourceGen.id);
    await postJson(`/api/v1/generations/${refined.generation.id}/publications`, {});
    await req(`/api/v1/generations/${refined.generation.short_id}/bookmark`, { method: 'PUT' });

    const res = await req('/bookmarks?view=all');
    const html = await res.text();
    const card = cardHtml(html, refined.generation.short_id);

    expect(card).toContain(`from <span class="card-from-badge-id">${sourceGen.short_id}</span>`);
    expect(card).toContain('公開済み');
    expect(card).not.toContain('tag-add-form');
    expect(card).not.toContain('compare-check');
  });
});
