import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';

/** Whether the `<details>` whose `<summary>` is exactly `summaryText` renders with the `open` attribute. */
function detailsOpenFor(html: string, summaryText: string): boolean {
  const idx = html.indexOf(`<summary>${summaryText}</summary>`);
  if (idx === -1) throw new Error(`section "${summaryText}" not found`);
  const tagStart = html.lastIndexOf('<details', idx);
  const tagEnd = html.indexOf('>', tagStart);
  return html.slice(tagStart, tagEnd).includes(' open');
}

async function createRefinedGeneration(sourceBatchId: string, sourceGenerationId: string) {
  return createGeneration({
    batchOverrides: {
      refinement: { source_batch_id: sourceBatchId, actor: 'claude', reason: 'finalize' },
      references: [{ source_generation_id: sourceGenerationId, purpose: 'rebuild' }],
    },
  });
}

describe('GET /g/:short_id?partial=lightbox', () => {
  it('returns a fragment (no <html) with the sections in order', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}?partial=lightbox`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).not.toContain('<html');
    expect(html).toContain(`data-short-id="${generation.short_id}"`);

    const idxHeader = html.indexOf('lightbox-header');
    const idxShortId = html.indexOf('lightbox-short-id');
    const idxMeta = html.indexOf('lightbox-meta-row');
    const idxRating = html.indexOf('rating-group-lg');
    const idxPublication = html.indexOf('publication-section');
    const idxTags = html.indexOf('tag-add-form');
    const idxFinalize = html.indexOf('finalize-form');
    const idxNote = html.indexOf('<summary>Note</summary>');

    expect(idxHeader).toBeGreaterThanOrEqual(0);
    expect(idxShortId).toBeGreaterThan(idxHeader);
    expect(idxMeta).toBeGreaterThan(idxShortId);
    expect(idxRating).toBeGreaterThan(idxMeta);
    expect(idxPublication).toBeGreaterThan(idxRating);
    expect(idxTags).toBeGreaterThan(idxPublication);
    expect(idxFinalize).toBeGreaterThan(idxTags);
    expect(idxNote).toBeGreaterThan(idxFinalize);

    // Finalize is open, Note is collapsed (docs/ui.md「Lightbox」) -- the reverse of the full page.
    expect(detailsOpenFor(html, 'Finalize')).toBe(true);
    expect(detailsOpenFor(html, 'Note')).toBe(false);
  });

  it('includes a from-row link only for a refined output', async () => {
    const { generation: raw } = await createGeneration();
    const rawRes = await req(`/g/${raw.short_id}?partial=lightbox`);
    const rawHtml = await rawRes.text();
    expect(rawHtml).not.toContain('card-from-badge');

    const { batch: sourceBatch, generation: sourceGen } = await createGeneration();
    const refined = await createRefinedGeneration(sourceBatch.id, sourceGen.id);
    const refinedRes = await req(`/g/${refined.generation.short_id}?partial=lightbox`);
    const refinedHtml = await refinedRes.text();
    expect(refinedHtml).toContain(`from <span class="card-from-badge-id">${sourceGen.short_id}</span>`);
    expect(refinedHtml).toContain(`href="/g/${sourceGen.short_id}"`);
  });

  it('reflects rating, bookmark and publications like the full page', async () => {
    const { generation } = await createGeneration();
    await req(`/api/v1/generations/${generation.short_id}/rating`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 'good' }) });
    await req(`/api/v1/generations/${generation.short_id}/bookmark`, { method: 'PUT' });
    await postJson(`/api/v1/generations/${generation.id}/publications`, { url: 'https://x.com/example/status/1' });

    const res = await req(`/g/${generation.short_id}?partial=lightbox`);
    const html = await res.text();
    expect(html).toContain('data-current="good"');
    expect(html).toContain('data-bookmarked="true"');
    expect(html).toContain('公開済み（1）');
    expect(html).toContain('href="https://x.com/example/status/1"');
  });

  it('404s for an unknown short_id', async () => {
    const res = await req('/g/doesnotexist?partial=lightbox');
    expect(res.status).toBe(404);
  });
});

describe('GET /g/:short_id?partial=lightbox: 基準 row (docs/domain-model.md「基準 render の pin」)', () => {
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

  it('shows the pin button before, and the 基準 pill (no button) after pinning', async () => {
    const recipe = uniqueRecipe();
    await publishAndImport(recipe);
    const { generation } = await createGeneration({ batchOverrides: { recipe, parameters: { pose: 'lounge' } } });

    const before = await (await req(`/g/${generation.short_id}?partial=lightbox`)).text();
    expect(before).toContain('pose-reference-btn');
    expect(before).not.toContain('card-reference-pill');

    await postJson(`/api/v1/generations/${generation.id}/rating`, { rating: 'good' }, 'PUT');
    const pin = await postJson(`/api/v1/generations/${generation.id}/pose-reference`, {});
    expect(pin.status).toBe(201);

    const after = await (await req(`/g/${generation.short_id}?partial=lightbox`)).text();
    expect(after).toContain('card-reference-pill');
    expect(after).toContain('基準 lounge');
    expect(after).not.toContain('pose-reference-btn');
  });
});

describe('GET /g/:short_id (full page)', () => {
  it('still renders the full Generation Detail page, unaffected by the Lightbox refactor', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html');
    expect(html).toContain('Finalize');
    expect(html).toContain('公開');
    expect(html).toContain('Note');
    expect(detailsOpenFor(html, 'Note')).toBe(true);
  });
});
