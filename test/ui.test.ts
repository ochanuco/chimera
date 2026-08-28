import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, createJob, ingestGeneration, postJson, req } from './helpers';
import { representativeGeneration, type GraphNodeData } from '../src/ui/pages/Graph';

describe('Web GUI pages', () => {
  it('GET / redirects to /gallery', async () => {
    const res = await req('/', { redirect: 'manual' });
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get('location')).toContain('/gallery');
  });

  it('GET /assets/style.css returns CSS with correct Content-Type', async () => {
    const res = await req('/assets/style.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /assets/app.js returns JavaScript with correct Content-Type', async () => {
    const res = await req('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });

  it('gallery card image URLs keep the request origin (not localhost)', async () => {
    const { generation } = await createGeneration();
    const res = await req('/gallery?limit=200');
    const html = await res.text();
    expect(html).toContain(`https://chimera.test/g/${generation.short_id}/image`);
    expect(html).not.toContain('http://localhost');
  });

  it('GET /gallery returns 200 HTML including a registered generation short_id', async () => {
    const { generation } = await createGeneration();
    const res = await req('/gallery?limit=200');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain(generation.short_id);
  });

  it('GET /gallery?original_filename= finds a generation by exact original filename', async () => {
    const { generation } = await createGeneration({ metadata: { original_filename: 'yk-lineT3_00001_.png' } });
    const res = await req('/gallery?original_filename=yk-lineT3_00001_.png');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(generation.short_id);
  });

  it('GET /gallery?original_filename= excludes generations with a non-matching filename', async () => {
    const { generation } = await createGeneration({ metadata: { original_filename: 'yk-lineT3_00002_.png' } });
    const res = await req('/gallery?original_filename=does-not-exist.png');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(generation.short_id);
  });

  it('GET /gallery?comfy_prompt_id= finds a generation by exact ComfyUI job id', async () => {
    const { job, generation } = await createGeneration();
    await postJson(`/api/v1/jobs/${job.id}`, { comfy_prompt_id: 'a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df' }, 'PATCH');
    const res = await req('/gallery?comfy_prompt_id=a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(generation.short_id);
  });

  it('GET /g/{short_id} returns 200 HTML including the image URL', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`/g/${generation.short_id}/image`);
  });

  it('GET /g/{short_id} shows the image resolution and formatted file size read from R2', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x02, 0x80, // width = 640
      0x00, 0x00, 0x01, 0xe0, // height = 480
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
      0x00, 0x00, 0x00, 0x00, // CRC (unchecked)
    ]);
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const ingest = await ingestGeneration(
      job.body.id,
      { seed: 1, original_filename: 'sized.png', comfy_output_index: 0 },
      png,
    );
    expect(ingest.status).toBe(201);

    const res = await req(`/g/${ingest.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('640×480');
    expect(html).toContain(`${png.byteLength} B`);
  });

  it('GET /g/{short_id} shows the resolution from D1 columns even when the R2 object is gone', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x01, 0x00, // width = 256
      0x00, 0x00, 0x00, 0x80, // height = 128
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
      0x00, 0x00, 0x00, 0x00, // CRC (unchecked)
    ]);
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const ingest = await ingestGeneration(
      job.body.id,
      { seed: 1, original_filename: 'no-r2-fallback.png', comfy_output_index: 0 },
      png,
    );
    expect(ingest.status).toBe(201);

    // Proves the meta banner comes from the persisted D1 columns, not a fresh
    // R2 ranged get: getImageMeta would return null width/height (or fail
    // entirely) once the object is gone.
    await env.IMAGES.delete(ingest.body.r2_object_key);

    const res = await req(`/g/${ingest.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('256×128');
    expect(html).toContain(`${png.byteLength} B`);
  });

  it('GET /g/{short_id} falls back to an R2 read when the D1 image_size column is NULL (pre-backfill row)', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x00, 0x64, // width = 100
      0x00, 0x00, 0x00, 0x32, // height = 50
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
      0x00, 0x00, 0x00, 0x00, // CRC (unchecked)
    ]);
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const ingest = await ingestGeneration(
      job.body.id,
      { seed: 1, original_filename: 'legacy-row.png', comfy_output_index: 0 },
      png,
    );
    expect(ingest.status).toBe(201);

    await env.DB.prepare('UPDATE generations SET image_width = NULL, image_height = NULL, image_size = NULL WHERE id = ?')
      .bind(ingest.body.id)
      .run();

    const res = await req(`/g/${ingest.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('100×50');
    expect(html).toContain(`${png.byteLength} B`);
  });

  it('GET /gallery shows the resolution and formatted file size in the card', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x03, 0x00, // width = 768
      0x00, 0x00, 0x03, 0x00, // height = 768
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
      0x00, 0x00, 0x00, 0x00, // CRC (unchecked)
    ]);
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const ingest = await ingestGeneration(
      job.body.id,
      { seed: 1, original_filename: 'gallery-card-meta.png', comfy_output_index: 0 },
      png,
    );
    expect(ingest.status).toBe(201);

    const res = await req('/gallery?limit=200');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('768×768');
    expect(html).toContain(`${png.byteLength} B`);
  });

  it('GET /g/xxxxxx 404s for an unknown short_id', async () => {
    const res = await req('/g/xxxxxx');
    expect(res.status).toBe(404);
  });

  it('GET /b/{short_id} returns 200 HTML', async () => {
    const batch = await createBatch({ raw_instruction: 'test instruction' });
    const res = await req(`/b/${batch.body.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(batch.body.short_id);
  });

  it('GET /b/{short_id} 404s for an unknown batch', async () => {
    const res = await req('/b/xxxxxx');
    expect(res.status).toBe(404);
  });

  it('GET /stories/{id} includes the relation label', async () => {
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: `ui-story-${crypto.randomUUID().slice(0, 8)}` });
    const b1 = await createBatch();
    const b2 = await createBatch();
    await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
      label: 'move to the beach',
    });

    const res = await req(`/stories/${story.body.id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('move to the beach');
  });

  it('GET /stories/{id} 404s for an unknown story', async () => {
    const res = await req('/stories/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('GET /bookmarks returns 200', async () => {
    const res = await req('/bookmarks');
    expect(res.status).toBe(200);
  });

  it('GET /batches returns 200 HTML', async () => {
    await createBatch();
    const res = await req('/batches');
    expect(res.status).toBe(200);
  });

  it('GET /compare?ids= returns 200', async () => {
    const res = await req('/compare?ids=');
    expect(res.status).toBe(200);
  });

  it('GET /b/{short_id} and /g/{short_id} show reference short_ids, not raw UUIDs', async () => {
    const { generation: sourceGen } = await createGeneration();
    const refBatch = await createBatch({
      references: [{ source_generation_id: sourceGen.id, purpose: 'style' }],
    });

    const batchRes = await req(`/b/${refBatch.body.short_id}`);
    expect(batchRes.status).toBe(200);
    const batchHtml = await batchRes.text();
    expect(batchHtml).toContain(sourceGen.short_id);
    expect(batchHtml).not.toContain(sourceGen.id);

    const genRes = await req(`/g/${sourceGen.short_id}`);
    expect(genRes.status).toBe(200);
    const genHtml = await genRes.text();
    expect(genHtml).toContain(refBatch.body.short_id);
    expect(genHtml).not.toContain(refBatch.body.id);
  });

  it('GET /b/{short_id} shows 親/子/兄弟 sections with type badges', async () => {
    const { generation: sourceGen } = await createGeneration();
    const refBatch = await createBatch({
      references: [{ source_generation_id: sourceGen.id, purpose: 'style' }],
    });

    const res = await req(`/b/${refBatch.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('親 (1)');
    expect(html).toContain('子 (0)');
    expect(html).toContain('兄弟 (0)');
    expect(html).toContain('rel-badge rel-reference');
  });

  it('GET /g/{short_id} shows 親 (own Batch material) and 子 (downstream usage) separately', async () => {
    const { generation: material } = await createGeneration();
    const { generation: middleGen } = await createGeneration({
      batchOverrides: { references: [{ source_generation_id: material.id, purpose: 'composition' }] },
    });
    const consumer = await createBatch();
    await postJson(`/api/v1/batches/${consumer.body.id}/references`, {
      source_generation_id: middleGen.id,
      purpose: 'outfit',
    });

    const res = await req(`/g/${middleGen.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // 親 shows the material this Generation's own Batch referenced.
    expect(html).toContain(material.short_id);
    // 子 shows the Batch that used this Generation as material.
    expect(html).toContain(consumer.body.short_id);
  });

  it('GET /compare?ids=a,b renders both generations', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(g1.short_id);
    expect(body).toContain(g2.short_id);
  });

  it('GET /compare shows a semantic diff table with per-row highlighting for differing values', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();

    await postJson(
      `/api/v1/generations/${g1.id}/semantic`,
      {
        schema_version: 1,
        summary: 'a girl standing',
        core: { pose: 'standing', style: 'anime' },
        strengths: ['clean lines'],
        defects: [],
      },
      'PUT',
    );
    await postJson(
      `/api/v1/generations/${g2.id}/semantic`,
      {
        schema_version: 1,
        summary: 'a girl sitting',
        core: { pose: 'sitting', style: 'anime' },
        strengths: [],
        defects: ['blurry hands'],
      },
      'PUT',
    );

    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain(g1.short_id);
    expect(body).toContain(g2.short_id);
    expect(body).toContain('standing');
    expect(body).toContain('sitting');
    expect(body).toContain('class="diff"');
  });

  it('GET /graph returns 200 HTML with both batch short_ids, the legend, and all three edge types', async () => {
    const { generation, batch: sourceBatch } = await createGeneration();
    const targetBatch = await createBatch({
      references: [{ source_generation_id: generation.id, purpose: 'composition', aspect: 'pose' }],
      refinement: { source_batch_id: sourceBatch.id, actor: 'human', reason: 'retry' },
    });

    const story = await postJson<{ id: string }>('/api/v1/stories', {
      name: `graph-ui-story-${crypto.randomUUID().slice(0, 8)}`,
    });
    await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: sourceBatch.id,
      target_batch_id: targetBatch.body.id,
      label: 'continues the scene',
    });

    const res = await req('/graph');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();

    expect(body).toContain(sourceBatch.short_id);
    expect(body).toContain(targetBatch.body.short_id);
    expect(body).toContain('graph-legend');
    expect(body).toContain('legend-reference');
    expect(body).toContain('legend-relation');
    expect(body).toContain('legend-story');
    expect(body).toContain('edge-reference');
    expect(body).toContain('edge-relation');
    expect(body).toContain('edge-story');
    expect(body).toContain(`data-gen-short-id="${generation.short_id}"`);
    expect(body).toContain(`data-batch-short-id="${sourceBatch.short_id}"`);
    expect(body).toContain(`data-batch-short-id="${targetBatch.body.short_id}"`);
    expect(body).toContain('id="graph-context-menu"');
  });

  it('GET /graph with no query params still renders the pan/zoom SVG container', async () => {
    await createBatch();
    const res = await req('/graph');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="graph-svg"');
    expect(body).toContain('graph-viewport');
  });

  it('GET /graph?story= shows only the Batches connected to that Story', async () => {
    const b1 = await createBatch();
    const b2 = await createBatch();
    const other = await createBatch();
    const story = await postJson<{ id: string }>('/api/v1/stories', {
      name: `graph-scope-story-${crypto.randomUUID().slice(0, 8)}`,
    });
    await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
      label: 'continues',
    });

    const res = await req(`/graph?story=${story.body.id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(b1.body.short_id);
    expect(body).toContain(b2.body.short_id);
    expect(body).not.toContain(other.body.short_id);
  });

  it('GET /graph?root= shows only the ancestor/descendant subgraph of that Batch', async () => {
    const a = await createBatch();
    const b = await createBatch({ refinement: { source_batch_id: a.body.id, actor: 'human', reason: 'retry' } });
    const c = await createBatch({ refinement: { source_batch_id: b.body.id, actor: 'human', reason: 'retry' } });
    const unrelated = await createBatch();

    const res = await req(`/graph?root=${b.body.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(a.body.short_id);
    expect(body).toContain(b.body.short_id);
    expect(body).toContain(c.body.short_id);
    expect(body).not.toContain(unrelated.body.short_id);
  });

  it('GET /graph?root= with an unknown Batch shows a "Batch not found" message', async () => {
    await createBatch();
    const res = await req('/graph?root=doesnotexist');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Batch not found: doesnotexist');
  });

  it('GET /graph?all=1 shows every Batch regardless of connectivity', async () => {
    const isolatedOld = await createBatch();
    const isolatedNew = await createBatch();

    const res = await req('/graph?all=1');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(isolatedOld.body.short_id);
    expect(body).toContain(isolatedNew.body.short_id);
  });

  it('GET /graph with no query params defaults to Recent (distance-limited from the newest Batch)', async () => {
    const isolatedOld = await createBatch();
    const isolatedNew = await createBatch();

    const res = await req('/graph');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(isolatedNew.body.short_id);
    expect(body).not.toContain(isolatedOld.body.short_id);
  });

  it('GET /graph?active=1 shows the whole connected component regardless of distance', async () => {
    const isolated = await createBatch();
    const b0 = await createBatch();
    const b1 = await createBatch({ refinement: { source_batch_id: b0.body.id, actor: 'human', reason: 'retry' } });
    const b2 = await createBatch({ refinement: { source_batch_id: b1.body.id, actor: 'human', reason: 'retry' } });
    const b3 = await createBatch({ refinement: { source_batch_id: b2.body.id, actor: 'human', reason: 'retry' } });
    const b4 = await createBatch({ refinement: { source_batch_id: b3.body.id, actor: 'human', reason: 'retry' } });

    const res = await req('/graph?active=1');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(b0.body.short_id);
    expect(body).toContain(b4.body.short_id);
    expect(body).not.toContain(isolated.body.short_id);
  });

  it('GET /graph with no query params limits to distance 3 and stubs the boundary Batch', async () => {
    const b0 = await createBatch();
    const b1 = await createBatch({ refinement: { source_batch_id: b0.body.id, actor: 'human', reason: 'retry' } });
    const b2 = await createBatch({ refinement: { source_batch_id: b1.body.id, actor: 'human', reason: 'retry' } });
    const b3 = await createBatch({ refinement: { source_batch_id: b2.body.id, actor: 'human', reason: 'retry' } });
    const b4 = await createBatch({ refinement: { source_batch_id: b3.body.id, actor: 'human', reason: 'retry' } });

    const res = await req('/graph');
    expect(res.status).toBe(200);
    const body = await res.text();
    // b0 is 4 hops from the newest Batch (b4) -- outside the default depth-3 window.
    expect(body).not.toContain(b0.body.short_id);
    expect(body).toContain(b1.body.short_id);
    expect(body).toContain(b2.body.short_id);
    expect(body).toContain(b3.body.short_id);
    expect(body).toContain(b4.body.short_id);
    // b1 sits at the boundary and has one hidden neighbor (b0) -> drill-down stub.
    expect(body).toContain('graph-node-stub');
    expect(body).toContain('⋯ +1');
  });

  it('GET /graph?root=X&depth=1 limits to immediate neighbors of X only', async () => {
    const a = await createBatch();
    const b = await createBatch({ refinement: { source_batch_id: a.body.id, actor: 'human', reason: 'retry' } });
    const c = await createBatch({ refinement: { source_batch_id: b.body.id, actor: 'human', reason: 'retry' } });
    const d = await createBatch({ refinement: { source_batch_id: c.body.id, actor: 'human', reason: 'retry' } });

    const res = await req(`/graph?root=${c.body.short_id}&depth=1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(a.body.short_id);
    expect(body).toContain(b.body.short_id);
    expect(body).toContain(c.body.short_id);
    expect(body).toContain(d.body.short_id);
  });

  it('GET /graph renders at most one <image> per Batch card even with many Generations', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    await ingestGeneration(job.body.id, { seed: 1, original_filename: 'multi-a.png', comfy_output_index: 0 });
    await ingestGeneration(job.body.id, { seed: 2, original_filename: 'multi-b.png', comfy_output_index: 1 });
    await ingestGeneration(job.body.id, { seed: 3, original_filename: 'multi-c.png', comfy_output_index: 2 });

    const res = await req(`/graph?root=${batch.body.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    const imageCount = (body.match(/<image /g) ?? []).length;
    expect(imageCount).toBe(1);
  });
});

describe('representativeGeneration (Graph View thumbnail selection)', () => {
  function makeNode(overrides: Partial<GraphNodeData> = {}): GraphNodeData {
    return {
      id: 'batch-1',
      short_id: 'b1',
      raw_instruction: null,
      status: 'completed',
      created_at: '2024-01-01T00:00:00Z',
      generation_count: 0,
      generations: [],
      thumbnail_generation_short_id: null,
      hidden_neighbor_count: 0,
      ...overrides,
    };
  }

  it('returns null when the Batch has no Generations', () => {
    expect(representativeGeneration(makeNode())).toBeNull();
  });

  it('① picks the Generation matching thumbnail_generation_short_id first', () => {
    const g1 = { short_id: 'g1', rating: null, bookmark: false } as const;
    const g2 = { short_id: 'g2', rating: 'good', bookmark: false } as const;
    const node = makeNode({ generations: [g1, g2], thumbnail_generation_short_id: 'g1' });
    expect(representativeGeneration(node)?.short_id).toBe('g1');
  });

  it('② falls back to the first "good"-rated Generation when there is no thumbnail match', () => {
    const g1 = { short_id: 'g1', rating: null, bookmark: false } as const;
    const g2 = { short_id: 'g2', rating: 'good', bookmark: false } as const;
    const g3 = { short_id: 'g3', rating: 'good', bookmark: false } as const;
    const node = makeNode({ generations: [g1, g2, g3], thumbnail_generation_short_id: 'does-not-exist' });
    expect(representativeGeneration(node)?.short_id).toBe('g2');
  });

  it('③ falls back to the first Generation when neither a thumbnail match nor a "good" rating exists', () => {
    const g1 = { short_id: 'g1', rating: 'bad', bookmark: false } as const;
    const g2 = { short_id: 'g2', rating: 'neutral', bookmark: false } as const;
    const node = makeNode({ generations: [g1, g2], thumbnail_generation_short_id: null });
    expect(representativeGeneration(node)?.short_id).toBe('g1');
  });
});
