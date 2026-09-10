import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';

async function createFinalizeLikeRequest(
  generationId: string,
  kind: 'finalize' | 'repair' | 'masked_redraw' = 'finalize',
): Promise<string> {
  const payload =
    kind === 'masked_redraw'
      ? { generation_id: generationId, options: { regions: [[0.1, 0.1, 0.5, 0.5]], prompt_patch: 'x', denoise: 0.5 } }
      : kind === 'repair'
        ? { generation_id: generationId, options: { parts: ['hands'] } }
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

  it('includes the finalize badge when a request targets the generation', async () => {
    const { generation } = await createGeneration();
    const requestId = await createFinalizeLikeRequest(generation.id, 'finalize');
    const res = await req(`/g/${generation.short_id}?partial=card`);
    const card = cardHtml(await res.text(), generation.short_id);
    expect(card).toContain('card-finalize-badge');
    expect(card).toContain(`data-request-id="${requestId}"`);
    expect(card).toContain('finalize · queued');
  });
});

describe('GenerationCard finalize badge (docs/ui.md「Gallery」進捗ピル)', () => {
  it('renders queued / running / done (→ result short_id) / failed as the request transitions', async () => {
    const { generation } = await createGeneration();
    const { batch: resultBatch, generation: resultGen } = await createGeneration();
    const requestId = await createFinalizeLikeRequest(generation.id, 'repair');

    let card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('repair · queued');

    await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('running', requestId).run();
    card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('repair · running');

    await env.DB.prepare('UPDATE requests SET status = ?, result_json = ? WHERE id = ?')
      .bind('done', JSON.stringify({ batch_id: resultBatch.id, generation_ids: [resultGen.id] }), requestId)
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
    await createFinalizeLikeRequest(generation.id, 'masked_redraw');
    const card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).toContain('masked redraw · queued');
  });

  it('omits the badge entirely when no finalize/repair/masked_redraw request targets the generation', async () => {
    const { generation } = await createGeneration();
    const card = cardHtml((await (await req('/gallery?limit=200')).text()), generation.short_id);
    expect(card).not.toContain('card-finalize-badge');
  });
});
