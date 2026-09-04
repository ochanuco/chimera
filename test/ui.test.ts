import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, createJob, getJson, ingestGeneration, postJson, req, setJobGraph } from './helpers';
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

  it('GET /g/{short_id} shows the Workflow section with the checkpoint, Pass 1, positive chips, and Raw graph', async () => {
    const { generation, job } = await createGeneration();
    const graph = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 123,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a test prompt', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['4', 1] } },
    };
    await postJson(`/api/v1/jobs/${job.id}`, { graph }, 'PATCH');

    const res = await req(`/g/${generation.short_id}`);
    const html = await res.text();
    expect(html).toContain('Workflow');
    expect(html).toContain('Pass 1');
    expect(html).toContain('model.safetensors');
    expect(html).toContain('class="prompt-chip"');
    expect(html).toContain('a test prompt');
    expect(html).toContain('Raw graph');
  });

  it('GET /g/{short_id} shows "(no graph)" and the request prompt chips for a Generation whose Job never got a graph', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}`);
    const html = await res.text();
    expect(html).toContain('Workflow');
    expect(html).toContain('(no graph)');
    expect(html).toContain('class="prompt-chip"');
  });

  it('GET /g/{short_id} shows Pass 2 and "continues pass 1" for a chain (hires-fix) graph', async () => {
    const { generation, job } = await createGeneration();
    const graph = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 1234,
          steps: 28,
          cfg: 5.5,
          sampler_name: 'euler_ancestral',
          scheduler: 'karras',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-v3' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['4', 1] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '10': { class_type: 'ImageScale', inputs: { image: ['8', 0], upscale_method: 'lanczos', width: 1248, height: 1824, crop: 'disabled' } },
      '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['20', 2] } },
      '12': {
        class_type: 'KSampler',
        inputs: {
          seed: 1234,
          steps: 20,
          cfg: 4,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 0.45,
          model: ['20', 0],
          positive: ['6b', 0],
          negative: ['7', 0],
          latent_image: ['11', 0],
        },
      },
      '6b': { class_type: 'CLIPTextEncode', inputs: { text: 'a, hires detail', clip: ['20', 1] } },
      '20': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-finalize' } },
    };
    await postJson(`/api/v1/jobs/${job.id}`, { graph }, 'PATCH');

    const res = await req(`/g/${generation.short_id}`);
    const html = await res.text();
    expect(html).toContain('Pass 2');
    expect(html).toContain('continues pass 1');
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

  it('GET /b/{short_id} shows prompt tokens as chips, including weight and lora badges', async () => {
    const batch = await createBatch({ prompt: '1girl, (masterpiece:1.3), <lora:add_detail:0.8>' });

    const res = await req(`/b/${batch.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('prompt-chip');
    expect(html).toContain('w-badge');
    expect(html).toContain('chip-lora');
    expect(html).not.toContain('prompt-raw');
  });

  it('GET /b/{short_id} shows a comma-less long prompt as raw text, not chips', async () => {
    const longSentence = 'a'.repeat(90);
    const batch = await createBatch({ prompt: longSentence });

    const res = await req(`/b/${batch.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('prompt-raw');
    expect(html).not.toContain('prompt-chip');
  });

  it('GET /b/{short_id} highlights added/removed/weight-changed prompt tokens against the retry parent', async () => {
    const parent = await createBatch({ prompt: '1girl, (outdoors:1.2), old_tag' });
    const child = await createBatch({
      prompt: '1girl, (outdoors:1.5), new_tag',
      refinement: { source_batch_id: parent.body.id, actor: 'human', reason: 'retry' },
    });

    const res = await req(`/b/${child.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`diff base: `);
    expect(html).toContain(parent.body.short_id);
    expect(html).toContain('diff-added');
    expect(html).toContain('diff-removed');
    expect(html).toContain('diff-weight');
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
    // Compare images opt into the shared hover preview via .thumb-link / .thumb-fg.
    expect(body).toContain('class="thumb-link"');
    expect(body).toContain('class="thumb-fg"');
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
    expect(body).toContain('class="diff"');
    // With only 2 real-value lanes, the consensus 3-step degenerates to same/uniq (no partial):
    // g1's "standing" matches no other lane, g2's "sitting" matches no other lane, so both render
    // as tok-uniq — each cell shows only its own text, never the other lane's. (The legend itself
    // carries a sample tok-partial span, so scope the "no partial" check to the table body.)
    const tableBody = body.slice(body.indexOf('<tbody>'));
    expect(tableBody).toContain('class="tok-uniq"');
    expect(tableBody).not.toContain('class="tok-partial"');
    expect(body).toMatch(/<span class="tok-uniq">[^<]*standing[^<]*<\/span>/);
    expect(body).toMatch(/<span class="tok-uniq">[^<]*sitting[^<]*<\/span>/);
    expect(body).toContain('class="compare-legend"');

    // Locate the pose row and check each cell's own <td>...</td> in isolation: g1's cell must not
    // contain "sitting", and g2's cell must not contain "standing".
    const poseRowMatch = body.match(/<tr><td>pose<\/td>(.*?)<\/tr>/s);
    expect(poseRowMatch).not.toBeNull();
    const poseCells = [...poseRowMatch![1]!.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]!);
    expect(poseCells).toHaveLength(2);
    expect(poseCells[0]).toContain('standing');
    expect(poseCells[0]).not.toContain('sitting');
    expect(poseCells[1]).toContain('sitting');
    expect(poseCells[1]).not.toContain('standing');
  });

  it('GET /compare shows a 3-way consensus diff table: shared parts plain, majority-shared parts partial, lane-unique parts uniq', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const { generation: g3 } = await createGeneration();

    await postJson(
      `/api/v1/generations/${g1.id}/semantic`,
      { schema_version: 1, core: { pose: 'standing on grass' }, strengths: [], defects: [] },
      'PUT',
    );
    await postJson(
      `/api/v1/generations/${g2.id}/semantic`,
      { schema_version: 1, core: { pose: 'sitting on grass' }, strengths: [], defects: [] },
      'PUT',
    );
    await postJson(
      `/api/v1/generations/${g3.id}/semantic`,
      { schema_version: 1, core: { pose: 'sitting on sand' }, strengths: [], defects: [] },
      'PUT',
    );

    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id},${g3.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    const poseRowMatch = body.match(/<tr><td>pose<\/td>(.*?)<\/tr>/s);
    expect(poseRowMatch).not.toBeNull();
    const poseCells = [...poseRowMatch![1]!.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]!);
    expect(poseCells).toHaveLength(3);

    // g1 "standing on grass": "standing" matches neither other lane (uniq); " on " matches both
    // (plain, no span); "grass" matches g2 only, not g3 (partial). Never shows "sitting"/"sand".
    expect(poseCells[0]).toBe('<span class="tok-uniq">standing</span> on <span class="tok-partial">grass</span>');

    // g2 "sitting on grass": "sitting" matches g3 only (partial); " on " matches both (plain);
    // "grass" matches g1 only (partial). Nothing in this row is g2-unique.
    expect(poseCells[1]).toBe('<span class="tok-partial">sitting</span> on <span class="tok-partial">grass</span>');
    expect(poseCells[1]).not.toContain('tok-uniq');

    // g3 "sitting on sand": "sitting" matches g2 only (partial); " on " matches both (plain);
    // "sand" matches neither other lane (uniq).
    expect(poseCells[2]).toBe('<span class="tok-partial">sitting</span> on <span class="tok-uniq">sand</span>');
  });

  it('GET /compare token-diffs a long summary line, highlighting each lane-unique word as tok-uniq', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();

    await postJson(
      `/api/v1/generations/${g1.id}/semantic`,
      { schema_version: 1, summary: 'a cat sitting on a chair', core: {}, strengths: [], defects: [] },
      'PUT',
    );
    await postJson(
      `/api/v1/generations/${g2.id}/semantic`,
      { schema_version: 1, summary: 'a cat sleeping on a sofa', core: {}, strengths: [], defects: [] },
      'PUT',
    );

    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    // With only 2 real-value lanes, consensus degenerates to same/uniq (no partial). (The legend
    // carries a sample tok-partial span, so scope the "no partial" check to the table body.)
    const tableBody = body.slice(body.indexOf('<tbody>'));
    expect(tableBody).toContain('class="tok-uniq"');
    expect(tableBody).not.toContain('class="tok-partial"');
    expect(body).toMatch(/<span class="tok-uniq">[^<]*sleeping[^<]*<\/span>/);
    expect(body).toMatch(/<span class="tok-uniq">[^<]*sitting[^<]*<\/span>/);

    // Each lane shows only its own text: g1's summary cell never shows "sleeping"/"sofa", and
    // g2's cell never shows "sitting"/"chair".
    const summaryRowMatch = body.match(/<tr><td>summary<\/td>(.*?)<\/tr>/s);
    expect(summaryRowMatch).not.toBeNull();
    const summaryCells = [...summaryRowMatch![1]!.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]!);
    expect(summaryCells).toHaveLength(2);
    expect(summaryCells[0]).toContain('sitting');
    expect(summaryCells[0]).toContain('chair');
    expect(summaryCells[0]).not.toContain('sleeping');
    expect(summaryCells[0]).not.toContain('sofa');
    expect(summaryCells[1]).toContain('sleeping');
    expect(summaryCells[1]).toContain('sofa');
    expect(summaryCells[1]).not.toContain('sitting');
    expect(summaryCells[1]).not.toContain('chair');
  });

  it('GET /compare shows a render.checkpoint row with class="diff" when the two Jobs used different checkpoints', async () => {
    const { generation: g1, job: job1 } = await createGeneration();
    const { generation: g2, job: job2 } = await createGeneration();
    await postJson(`/api/v1/jobs/${job1.id}`, { graph: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } } } }, 'PATCH');
    await postJson(`/api/v1/jobs/${job2.id}`, { graph: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'b.safetensors' } } } }, 'PATCH');

    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('render.checkpoint');

    const rowMatch = body.match(/<tr><td>render\.checkpoint<\/td>(.*?)<\/tr>/s);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('class="diff"');
    const cells = [...rowMatch![1]!.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]!);
    expect(cells).toHaveLength(2);
    expect(cells[0]!.replace(/<[^>]+>/g, '')).toBe('a.safetensors');
    expect(cells[1]!.replace(/<[^>]+>/g, '')).toBe('b.safetensors');
  });

  it('GET /compare shows "(no graph)" for a render.* column when a Generation\'s Job has no graph at all', async () => {
    const { generation: g1, job: job1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    await postJson(`/api/v1/jobs/${job1.id}`, { graph: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } } } }, 'PATCH');

    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    const body = await res.text();
    const rowMatch = body.match(/<tr><td>render\.checkpoint<\/td>(.*?)<\/tr>/s);
    expect(rowMatch).not.toBeNull();
    const cells = [...rowMatch![1]!.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]!);
    expect(cells[1]).toContain('(no graph)');
  });

  it('GET /compare shows a render.positive row built from each Job\'s pass-1 positive prompt', async () => {
    const { generation: g1, job: job1 } = await createGeneration();
    const { generation: g2, job: job2 } = await createGeneration();
    const graphFor = (text: string) => ({
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['4', 1] } },
    });
    await postJson(`/api/v1/jobs/${job1.id}`, { graph: graphFor('1girl, outdoors') }, 'PATCH');
    await postJson(`/api/v1/jobs/${job2.id}`, { graph: graphFor('1girl, indoors') }, 'PATCH');

    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('render.positive');
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

    // sourceBatch/targetBatch form a size-2 retry chain (the refinement relation edge), which
    // collapses by default -- expand it so both Batches and the relation edge itself render.
    const res = await req(`/graph?expand=${targetBatch.body.short_id}`);
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

    // b0..b4 form one size-5 retry chain; expand it so this test still exercises
    // per-Batch reachability rather than the (separately tested) chain collapse.
    const res = await req(`/graph?active=1&expand=${b4.body.short_id}`);
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

    // b0..b4 form one size-5 retry chain; expand it so depth-limiting is exercised
    // per-Batch rather than collapsing the whole chain to a single node.
    const res = await req(`/graph?expand=${b4.body.short_id}`);
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

describe('Graph View retry-chain collapse', () => {
  /** Builds a size-3 relation chain b0 -> b1 -> b2 (each a refinement retry of the previous). */
  async function createChain() {
    const b0 = await createBatch();
    const b1 = await createBatch({ refinement: { source_batch_id: b0.body.id, actor: 'human', reason: 'retry' } });
    const b2 = await createBatch({ refinement: { source_batch_id: b1.body.id, actor: 'human', reason: 'retry' } });
    return { b0, b1, b2 };
  }

  it('collapses a 3-Batch relation chain into its representative, with a ⟳3 badge', async () => {
    const { b0, b1, b2 } = await createChain();

    // active=1 isolates this test's own connected component (rooted at the newest Batch,
    // b2) from unrelated Batches left behind by other tests sharing the same D1 instance.
    const res = await req('/graph?active=1');
    expect(res.status).toBe(200);
    const body = await res.text();

    // b2 is the most recently created member, so it is the chain's representative.
    expect(body).toContain(b2.body.short_id);
    expect(body).not.toContain(b0.body.short_id);
    expect(body).not.toContain(b1.body.short_id);
    expect(body).toContain('graph-node-chain');
    expect(body).toContain('⟳3');
  });

  it('?expand=<representative short_id> shows all 3 chain members', async () => {
    const { b0, b1, b2 } = await createChain();

    const res = await req(`/graph?active=1&expand=${b2.body.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain(b0.body.short_id);
    expect(body).toContain(b1.body.short_id);
    expect(body).toContain(b2.body.short_id);
    expect(body).not.toContain('⟳3');
    expect(body).toContain('graph-node-recollapse');
  });

  it('?root=<middle chain member> auto-expands the chain so the root stays visible', async () => {
    const { b0, b1, b2 } = await createChain();

    const res = await req(`/graph?root=${b1.body.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain(b0.body.short_id);
    expect(body).toContain(b1.body.short_id);
    expect(body).toContain(b2.body.short_id);
  });

  it('redirects a reference edge from outside the chain, into a middle member, onto the representative', async () => {
    const { generation: extGeneration } = await createGeneration();
    const b0 = await createBatch();
    const b1 = await createBatch({
      refinement: { source_batch_id: b0.body.id, actor: 'human', reason: 'retry' },
      references: [{ source_generation_id: extGeneration.id, purpose: 'composition', aspect: 'pose' }],
    });
    const b2 = await createBatch({ refinement: { source_batch_id: b1.body.id, actor: 'human', reason: 'retry' } });

    // active=1 isolates this test's own connected component from unrelated Batches left
    // behind by other tests sharing the same D1 instance.
    const res = await req('/graph?active=1');
    expect(res.status).toBe(200);
    const body = await res.text();

    // b1 (the reference edge's original target) is collapsed away -- if the edge still pointed
    // at it, the SSR layout would drop the edge entirely rather than render it dangling.
    expect(body).not.toContain(b1.body.short_id);
    const referenceEdgeCount = (body.match(/class="graph-edge edge-reference"/g) ?? []).length;
    expect(referenceEdgeCount).toBe(1);
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

describe('Family panel (親/子/兄弟 thumbnail cards)', () => {
  it('GET /g/{short_id} shows parent material and child used_by as thumbnail family cards', async () => {
    const { generation: material } = await createGeneration();
    const { generation: middleGen } = await createGeneration({
      batchOverrides: { references: [{ source_generation_id: material.id, purpose: 'composition', aspect: 'pose' }] },
    });
    const consumer = await createBatch();
    await postJson(`/api/v1/batches/${consumer.body.id}/references`, {
      source_generation_id: middleGen.id,
      purpose: 'outfit',
    });

    const res = await req(`/g/${middleGen.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('class="family-strip"');
    // 親: the owning Batch's own reference material, rendered as a Generation thumbnail card.
    expect(html).toContain(`src="/g/${material.short_id}/image"`);
    expect(html).toContain(`href="/g/${material.short_id}"`);
    // 子: the Batch that used this Generation as material, rendered as a Batch card.
    expect(html).toContain(`href="/b/${consumer.body.short_id}"`);
    expect(html).toContain('rel-badge rel-reference');
  });

  it('GET /g/{short_id} shows retry (refinement) Batch cards for the owning Batch\'s incoming/outgoing relations', async () => {
    const { batch: batchA } = await createGeneration();
    const { generation: genB, batch: batchB } = await createGeneration({
      batchOverrides: { refinement: { source_batch_id: batchA.id, actor: 'human', reason: 'retry composition' } },
    });
    const batchC = await createBatch({
      refinement: { source_batch_id: batchB.id, actor: 'human', reason: 'retry lighting' },
    });

    const res = await req(`/g/${genB.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 親: batchA is the retry source of the owning Batch (batchB) -- a Batch-level relation, so
    // the card is annotated "via batch" to distinguish it from the Generation-level material cards.
    expect(html).toContain(`href="/b/${batchA.short_id}"`);
    expect(html).toContain('via batch');
    expect(html).toContain('reason: retry composition');
    expect(html).toContain('rel-badge rel-refinement');

    // 子: batchC is the retry target of the owning Batch.
    expect(html).toContain(`href="/b/${batchC.body.short_id}"`);
    expect(html).toContain('reason: retry lighting');
  });

  it('GET /b/{short_id} shows the representative (first-created) Generation as the thumbnail on parent/child Batch cards', async () => {
    const { generation: firstGen, batch: parentBatch } = await createGeneration();
    const parentJob = await createJob(parentBatch.id);
    // Ingested after firstGen -- proves the card picks creation order, not this later Generation.
    await ingestGeneration(parentJob.body.id, { seed: 2, original_filename: 'second-gen.png', comfy_output_index: 0 });

    const childBatch = await createBatch({
      refinement: { source_batch_id: parentBatch.id, actor: 'human', reason: 'retry' },
    });

    const res = await req(`/b/${childBatch.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain(`href="/b/${parentBatch.short_id}"`);
    expect(html).toContain(`src="/g/${firstGen.short_id}/image"`);
    expect(html).toContain('rel-badge rel-refinement');
  });

  it('GET /gallery nav does not include a Graph link (route stays reachable directly)', async () => {
    const res = await req('/gallery');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('href="/graph"');
    expect(html).not.toContain('>Graph<');

    const graphRes = await req('/graph');
    expect(graphRes.status).toBe(200);
  });
});

describe('系譜ミニマップ (MiniMap)', () => {
  it('GET /g/{short_id} for the middle Batch of a 3-Batch retry chain lists all three short_ids in order, current bracketed and unlinked', async () => {
    const { batch: batchA } = await createGeneration();
    const { generation: genB, batch: batchB } = await createGeneration({
      batchOverrides: { refinement: { source_batch_id: batchA.id, actor: 'human', reason: 'retry' } },
    });
    const batchC = await createBatch({
      refinement: { source_batch_id: batchB.id, actor: 'human', reason: 'retry again' },
    });

    const res = await req(`/g/${genB.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('class="mini-map"');
    const chainStart = html.indexOf('mini-map-chain');
    expect(chainStart).toBeGreaterThan(-1);
    const idxA = html.indexOf(batchA.short_id, chainStart);
    const idxB = html.indexOf(`[${batchB.short_id}]`, chainStart);
    const idxC = html.indexOf(batchC.body.short_id, chainStart);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);

    // Current (owning) Batch is bracket-highlighted and not a link; the others are.
    expect(html).toContain(`href="/b/${batchA.short_id}"`);
    expect(html).toContain(`href="/b/${batchC.body.short_id}"`);
    expect(html).not.toContain(`href="/b/${batchB.short_id}"`);
  });

  it('GET /g/{short_id} shows a References row spanning material ancestors and descendants', async () => {
    // Reference lineage A -> B -> C (B uses A's Generation as material, C uses B's).
    const { generation: genA, batch: batchA } = await createGeneration();
    const { generation: genB, batch: batchB } = await createGeneration();
    const { batch: batchC } = await createGeneration();
    await postJson(`/api/v1/batches/${batchB.id}/references`, { source_generation_id: genA.id });
    await postJson(`/api/v1/batches/${batchC.id}/references`, { source_generation_id: genB.id });

    const res = await req(`/g/${genB.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('>References<');
    const chainStart = html.indexOf('mini-map-chain');
    const idxA = html.indexOf(batchA.short_id, chainStart);
    const idxB = html.indexOf(`[${batchB.short_id}]`, chainStart);
    const idxC = html.indexOf(batchC.short_id, chainStart);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);
  });

  it('GET /g/{short_id} shows no Map section for a Batch with no relation and no Story', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/g/${generation.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('class="mini-map"');
    expect(html).not.toContain('>Map<');
  });

  it('GET /b/{short_id} for a Batch in a Story shows a Story-labeled mini-map row', async () => {
    const storyName = `mini-map-story-${crypto.randomUUID().slice(0, 8)}`;
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: storyName });
    const { batch: batchX } = await createGeneration();
    const batchY = await createBatch();
    await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: batchX.id,
      target_batch_id: batchY.body.id,
    });

    const res = await req(`/b/${batchY.body.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('class="mini-map"');
    expect(html).toContain(`>${storyName}<`);
    expect(html).toContain(`href="/b/${batchX.short_id}"`);
    expect(html).toContain(`[${batchY.body.short_id}]`);
  });
});

describe('Experiments pages', () => {
  async function createExperiment(overrides: Record<string, unknown> = {}) {
    const res = await postJson<{ id: string; short_id: string; name: string }>('/api/v1/experiments', {
      name: `ui-exp-${crypto.randomUUID().slice(0, 8)}`,
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  it('GET /experiments lists name, status, run count and latest result', async () => {
    const experiment = await createExperiment({ base_recipe: 'dq3' });
    const run = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.id}/runs`, {});
    await postJson(`/api/v1/experiment-runs/${run.body.id}`, { evaluation: { overall: 'fail' } }, 'PATCH');

    const res = await req('/experiments');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(experiment.name);
    expect(html).toContain(`/experiments/${experiment.short_id}`);
    expect(html).toContain('1 runs');
    expect(html).toContain('data-value="fail"');
  });

  it('GET /experiments?status= filters by status', async () => {
    const active = await createExperiment();
    const abandoned = await createExperiment();
    await postJson(`/api/v1/experiments/${abandoned.id}`, { status: 'abandoned' }, 'PATCH');

    const res = await req('/experiments?status=abandoned');
    const html = await res.text();
    expect(html).toContain(abandoned.name);
    expect(html).not.toContain(active.name);
  });

  it('GET /experiments/{short_id} shows the override delta of each run against its base', async () => {
    const experiment = await createExperiment({ base_recipe: 'dq3', description: 'legwear separation' });
    // 非 patch 形式の overrides は API のエンベロープ検証を通らないため、leaf diff
    // 表示経路をテストするにはここだけ env.DB へ直接 INSERT する。
    const now = new Date().toISOString();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO experiment_runs (id, experiment_id, run_index, overrides_json, objective, created_at, updated_at)
         VALUES (?, ?, 1, ?, 'baseline', ?, ?)`,
      ).bind(
        firstId,
        experiment.id,
        JSON.stringify({ controlnet: { weight: 0.6 }, prompt: { positive_append: ['black tights'] } }),
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO experiment_runs (id, experiment_id, run_index, parent_run_id, overrides_json, created_at, updated_at)
         VALUES (?, ?, 2, ?, ?, ?, ?)`,
      ).bind(
        secondId,
        experiment.id,
        firstId,
        JSON.stringify({ controlnet: { weight: 0.72 }, prompt: { positive_append: ['black tights'] } }),
        now,
        now,
      ),
    ]);

    const res = await req(`/experiments/${experiment.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('legwear separation');
    expect(html).toContain('Initial overrides');
    expect(html).toContain('Changed from #1');
    expect(html).toContain('controlnet.weight');
    expect(html).toContain('0.6 → 0.72');
    // 変わっていない leaf は差分に出さない
    expect(html).not.toContain('prompt.positive_append</span> black tights → black tights');
  });

  it('GET /experiments/{short_id} shows a patch-shaped run delta as a marked patch list, not a leaf diff', async () => {
    const experiment = await createExperiment({ base_recipe: 'dq3' });
    const kept = { target: 'prompt.positive', op: 'append', value: 'black tights', reason: 'baseline legwear' };
    const first = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.id}/runs`, {
      overrides: { patches: [kept] },
      objective: 'baseline',
    });
    const added = { target: 'render.cfg', op: 'set', value: 4.5, reason: 'sharper edges' };
    await postJson<{ id: string }>(`/api/v1/experiments/${experiment.id}/runs`, {
      parent_run_id: first.body.id,
      overrides: { patches: [kept, added] },
    });

    const res = await req(`/experiments/${experiment.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('render.cfg');
    expect(html).toContain('sharper edges');
    expect(html).toMatch(/exp-delta-added">\s*\+\s*<span class="exp-delta-path">render\.cfg/);
    expect(html).toMatch(/exp-delta-kept">\s*<span class="exp-delta-path">prompt\.positive/);
    expect(html).not.toContain('exp-delta-removed');
  });

  it('GET /experiments/{short_id} falls back to the leaf diff when overrides.patches is not a patch list', async () => {
    const experiment = await createExperiment({ base_recipe: 'dq3' });
    // patches はあるが中身がオブジェクトでない (patch 形式と誤認してはいけない) —
    // これも API のエンベロープ検証を通らないため env.DB へ直接 INSERT する。
    const now = new Date().toISOString();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO experiment_runs (id, experiment_id, run_index, overrides_json, objective, created_at, updated_at)
         VALUES (?, ?, 1, ?, 'baseline', ?, ?)`,
      ).bind(
        firstId,
        experiment.id,
        JSON.stringify({ patches: ['not-a-patch-object'], controlnet: { weight: 0.6 } }),
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO experiment_runs (id, experiment_id, run_index, parent_run_id, overrides_json, created_at, updated_at)
         VALUES (?, ?, 2, ?, ?, ?, ?)`,
      ).bind(
        secondId,
        experiment.id,
        firstId,
        JSON.stringify({ patches: ['not-a-patch-object'], controlnet: { weight: 0.72 } }),
        now,
        now,
      ),
    ]);

    const res = await req(`/experiments/${experiment.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('controlnet.weight');
    expect(html).toContain('0.6 → 0.72');
  });

  it('GET /experiments/{id} renders the attached generation thumbnail and the promotion', async () => {
    const { generation, batch } = await createGeneration();
    const experiment = await createExperiment();
    const run = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.id}/runs`, {
      overrides: { patches: [{ target: 'pose.hip_rotation', op: 'set', value: 4, reason: 'r' }] },
      batch_id: batch.id,
      generation_id: generation.id,
      evaluation: { overall: 'pass', aspects: { clothing: 'pass' }, notes: ['sock cuff is distinct'] },
      decision: { action: 'stabilize', reason: 'legwear separated' },
    });
    await postJson(`/api/v1/experiments/${experiment.id}/promotions`, {
      source_run_id: run.body.id,
      target_path: 'recipes/dq3.py',
    });

    const res = await req(`/experiments/${experiment.id}`);
    const html = await res.text();
    expect(html).toContain(`https://chimera.test/g/${generation.short_id}/image`);
    expect(html).toContain(`/b/${batch.short_id}`);
    expect(html).toContain('sock cuff is distinct');
    expect(html).toContain('stabilize');
    expect(html).toContain('comfyui-recipes / recipes/dq3.py');
    expect(html).toContain('data-value="proposed"');
    expect(html).not.toContain('http://localhost');
  });

  it('GET /experiments/{id} shows the exp-facts table: baseline-diff highlighting on the arm checkpoint cell, a variables column, and a patches row', async () => {
    const experiment = await createExperiment();

    const { generation: baselineGen, job: baselineJob, batch: baselineBatch } = await createGeneration();
    const { generation: armGen, job: armJob, batch: armBatch } = await createGeneration();
    await postJson(
      `/api/v1/jobs/${baselineJob.id}`,
      { graph: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } } } },
      'PATCH',
    );
    await postJson(
      `/api/v1/jobs/${armJob.id}`,
      { graph: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'arm.safetensors' } } } },
      'PATCH',
    );

    const baselineRun = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${experiment.id}/runs`, {
      overrides: { patches: [{ target: 'render.cfg', op: 'set', value: 5, reason: 'sharper' }] },
      batch_id: baselineBatch.id,
      generation_id: baselineGen.id,
    });
    const armRun = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${experiment.id}/runs`, {
      variables: { prompt_variant: 'v2' },
      batch_id: armBatch.id,
      generation_id: armGen.id,
    });

    const res = await req(`/experiments/${experiment.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('exp-facts');
    expect(html).toContain('<th>prompt_variant</th>');
    expect(html).toContain('render.cfg');
    expect(html).toContain('sharper');

    const baselineRowMatch = html.match(new RegExp(`<tr><td>#${baselineRun.body.run_index}</td>.*?</tr>`, 's'));
    const armRowMatch = html.match(new RegExp(`<tr><td>#${armRun.body.run_index}</td>.*?</tr>`, 's'));
    expect(baselineRowMatch).not.toBeNull();
    expect(armRowMatch).not.toBeNull();
    expect(baselineRowMatch![0]).not.toContain('exp-facts-diff');
    expect(armRowMatch![0]).toContain('exp-facts-diff');
    expect(armRowMatch![0].replace(/<[^>]+>/g, ' ')).toContain('arm.safetensors');
    expect(html).toContain(`Highlighted cells differ from #${baselineRun.body.run_index}`);
  });

  it('GET /experiments/{id} shows the baseline\'s positive prompt chips and a diff-added arm prompt row', async () => {
    const experiment = await createExperiment();

    const { generation: baselineGen, job: baselineJob, batch: baselineBatch } = await createGeneration();
    const { generation: armGen, job: armJob, batch: armBatch } = await createGeneration();
    const graphFor = (text: string) => ({
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['4', 1] } },
    });
    await postJson(`/api/v1/jobs/${baselineJob.id}`, { graph: graphFor('1girl, old_tag') }, 'PATCH');
    await postJson(`/api/v1/jobs/${armJob.id}`, { graph: graphFor('1girl, new_tag') }, 'PATCH');

    await postJson(`/api/v1/experiments/${experiment.id}/runs`, { batch_id: baselineBatch.id, generation_id: baselineGen.id });
    await postJson(`/api/v1/experiments/${experiment.id}/runs`, { batch_id: armBatch.id, generation_id: armGen.id });

    const res = await req(`/experiments/${experiment.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('exp-facts-prompts');
    expect(html).toContain('#1 positive');
    expect(html).toContain('>old_tag<');
    expect(html).toContain('diff-added');
  });

  it('GET /experiments/{unknown} renders the 404 page', async () => {
    const res = await req('/experiments/zzzzzz');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Experiment');
  });

  it('nav links to /experiments', async () => {
    const res = await req('/experiments');
    expect(await res.text()).toContain('href="/experiments"');
  });

  it('GET /bookmarks links a bookmarked experiment to its detail page', async () => {
    const experiment = await createExperiment();
    await req(`/api/v1/experiments/${experiment.id}/bookmark`, { method: 'PUT' });

    const res = await req('/bookmarks');
    const html = await res.text();
    expect(html).toContain(`/experiments/${experiment.id}`);
    expect(html).toContain(experiment.name);
  });

  it('GET /experiments/{id} offers only the allowed status transitions for an active experiment', async () => {
    const experiment = await createExperiment();

    const res = await req(`/experiments/${experiment.id}`);
    const html = await res.text();
    const optionValues = Array.from(html.matchAll(/<option value="([^"]*)"/g)).map((m) => m[1]);

    expect(optionValues).toContain('active');
    expect(optionValues).toContain('stabilized');
    expect(optionValues).toContain('abandoned');
    expect(optionValues).not.toContain('promoted');
  });
});

describe('A/B judge page', () => {
  async function batchWithSeeds(seeds: number[]) {
    const batch = await createBatch();
    const gens: Record<number, { id: string; short_id: string }> = {};
    for (const seed of seeds) {
      const job = await createJob(batch.body.id, { seed });
      const ingest = await ingestGeneration(job.body.id, {
        seed,
        original_filename: `out_${seed}_${crypto.randomUUID().slice(0, 8)}.png`,
        comfy_output_index: 0,
      });
      gens[seed] = { id: ingest.body.id, short_id: ingest.body.short_id };
    }
    return { batch: batch.body, gens };
  }

  async function setupPair() {
    const experiment = await postJson<{ id: string; short_id: string }>('/api/v1/experiments', {
      name: `ab-page-${crypto.randomUUID().slice(0, 8)}`,
    });
    const baselineRun = await postJson<{ id: string; run_index: number }>(
      `/api/v1/experiments/${experiment.body.id}/runs`,
      { objective: 'baseline objective text' },
    );
    const armRun = await postJson<{ id: string; run_index: number }>(
      `/api/v1/experiments/${experiment.body.id}/runs`,
      { objective: 'arm objective text' },
    );

    const { batch: baselineBatch, gens: baselineGens } = await batchWithSeeds([11, 22]);
    const { batch: armBatch, gens: armGens } = await batchWithSeeds([11, 22]);
    await postJson(`/api/v1/experiment-runs/${baselineRun.body.id}`, { batch_id: baselineBatch.id }, 'PATCH');
    await postJson(`/api/v1/experiment-runs/${armRun.body.id}`, { batch_id: armBatch.id }, 'PATCH');

    return {
      experiment: experiment.body,
      baselineRun: baselineRun.body,
      armRun: armRun.body,
      baselineGens,
      armGens,
    };
  }

  function extractPairsJson(html: string): { seed: number }[] {
    const match = html.match(/<script type="application\/json" id="ab-pairs">([\s\S]*?)<\/script>/);
    if (!match) throw new Error('ab-pairs script block not found');
    return JSON.parse(match[1]!.trim());
  }

  it('renders both images by generation UUID, embeds ab-pairs JSON, and hides run identity', async () => {
    const ctx = await setupPair();
    const res = await req(
      `/experiments/${ctx.experiment.short_id}/ab?baseline=${ctx.baselineRun.id}&arm=${ctx.armRun.id}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain(`/g/${ctx.baselineGens[11]!.id}/image`);
    expect(html).toContain(`/g/${ctx.armGens[11]!.id}/image`);
    expect(html).toContain('id="ab-pairs"');

    for (const gens of [ctx.baselineGens, ctx.armGens]) {
      for (const seed of [11, 22]) {
        expect(html).not.toContain(gens[seed]!.short_id);
      }
    }
    expect(html).not.toContain('baseline objective text');
    expect(html).not.toContain('arm objective text');
    expect(html).not.toContain('data-value="good"');
  });

  it('does not leak the checkpoint name before judgment, and carries the ab-reveal / ab-next skeleton', async () => {
    const ctx = await setupPair();

    const baselineRunDetail = await getJson<{ batch_id: string }>(`/api/v1/experiment-runs/${ctx.baselineRun.id}`);
    const baselineJobs = await getJson<{ jobs: { id: string; index: number }[] }>(
      `/api/v1/batches/${baselineRunDetail.body.batch_id}`,
    );
    const firstJob = baselineJobs.body.jobs.find((j) => j.index === 0)!;
    await setJobGraph(firstJob.id, { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'secret-checkpoint.safetensors' } } });

    const res = await req(
      `/experiments/${ctx.experiment.short_id}/ab?baseline=${ctx.baselineRun.id}&arm=${ctx.armRun.id}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).not.toContain('secret-checkpoint.safetensors');
    expect(html).toContain('class="ab-reveal"');
    expect(html).toContain('class="ab-reveal-line"');
    expect(html).toContain('class="ab-next"');
    expect(html).toMatch(/<div class="ab-reveal"[^>]*hidden/);
  });

  it('drops a judged seed from the embedded pairs JSON on the next load', async () => {
    const ctx = await setupPair();
    const before = await req(
      `/experiments/${ctx.experiment.id}/ab?baseline=${ctx.baselineRun.id}&arm=${ctx.armRun.id}`,
    );
    const beforePairs = extractPairsJson(await before.text());
    expect(beforePairs.some((p) => p.seed === 11)).toBe(true);
    expect(beforePairs.some((p) => p.seed === 22)).toBe(true);

    await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'left',
    });

    const after = await req(
      `/experiments/${ctx.experiment.id}/ab?baseline=${ctx.baselineRun.id}&arm=${ctx.armRun.id}`,
    );
    const afterPairs = extractPairsJson(await after.text());
    expect(afterPairs.some((p) => p.seed === 11)).toBe(false);
    expect(afterPairs.some((p) => p.seed === 22)).toBe(true);
  });

  it('renders a stable warning when baseline/arm params are missing or cross-experiment', async () => {
    const ctx = await setupPair();

    const missing = await req(`/experiments/${ctx.experiment.id}/ab?baseline=${ctx.baselineRun.id}`);
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain('Select a baseline and an arm run');

    const other = await postJson<{ id: string }>('/api/v1/experiments', {
      name: `ab-other-${crypto.randomUUID().slice(0, 8)}`,
    });
    const otherRun = await postJson<{ id: string }>(`/api/v1/experiments/${other.body.id}/runs`, {});

    const crossExperiment = await req(
      `/experiments/${ctx.experiment.id}/ab?baseline=${ctx.baselineRun.id}&arm=${otherRun.body.id}`,
    );
    expect(crossExperiment.status).toBe(200);
    expect(await crossExperiment.text()).toContain('belongs to a different experiment');
  });

  it('GET /experiments/{id} shows the A/B link for the non-baseline run, the pairs table, and the ratings table', async () => {
    const ctx = await setupPair();
    await postJson(`/api/v1/experiments/${ctx.experiment.id}/judgments`, {
      baseline_run_id: ctx.baselineRun.id,
      arm_run_id: ctx.armRun.id,
      seed: 11,
      left_generation_id: ctx.baselineGens[11]!.id,
      right_generation_id: ctx.armGens[11]!.id,
      verdict: 'right', // arm wins
    });

    const res = await req(`/experiments/${ctx.experiment.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain(
      `/experiments/${ctx.experiment.short_id}/ab?baseline=${ctx.baselineRun.id}&amp;arm=${ctx.armRun.id}`,
    );
    expect(html).toContain(`#${ctx.baselineRun.run_index} vs #${ctx.armRun.run_index}`);
    expect(html).toContain('exp-ab-ratings');
  });
});

describe('Experiments list filter robustness', () => {
  it('GET /experiments?status=<unknown> falls back to no filter instead of erroring', async () => {
    const created = await postJson<{ name: string }>('/api/v1/experiments', {
      name: `ui-exp-badfilter-${crypto.randomUUID().slice(0, 8)}`,
    });
    const res = await req('/experiments?status=stabilised');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(created.body.name);
  });
});

describe('Experiment run patch delta edge cases', () => {
  it('shows removed patch lines when a run clears every patch its base had', async () => {
    const experiment = await postJson<{ id: string; short_id: string }>('/api/v1/experiments', {
      name: `ui-exp-cleared-${crypto.randomUUID().slice(0, 8)}`,
    });
    const first = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, {
      overrides: {
        patches: [{ target: 'render.cfg', op: 'set', value: 4.5, reason: 'soften edges' }],
      },
    });
    await postJson(`/api/v1/experiments/${experiment.body.id}/runs`, {
      parent_run_id: first.body.id,
      overrides: { patches: [] },
    });

    const res = await req(`/experiments/${experiment.body.short_id}`);
    const html = await res.text();
    expect(html).toContain('exp-delta-removed');
    expect(html).toContain('soften edges');
  });
});

describe('Experiment run patch delta matching', () => {
  async function experimentWithRuns(runs: unknown[]) {
    const experiment = await postJson<{ id: string; short_id: string }>('/api/v1/experiments', {
      name: `ui-exp-match-${crypto.randomUUID().slice(0, 8)}`,
    });
    let parentId: string | null = null;
    for (const overrides of runs) {
      const body: Record<string, unknown> = { overrides };
      if (parentId) body.parent_run_id = parentId;
      const created = await postJson<{ id: string }>(`/api/v1/experiments/${experiment.body.id}/runs`, body);
      parentId = created.body.id;
    }
    const res = await req(`/experiments/${experiment.body.short_id}`);
    return await res.text();
  }

  const cfg = { target: 'render.cfg', op: 'set', value: 4.5, reason: 'soften edges' };
  const socks = { target: 'prompt.positive', op: 'append', value: ', socks', reason: 'sock cuff' };

  it('marks nothing as added on the first run, since it has no base to differ from', async () => {
    const html = await experimentWithRuns([{ patches: [cfg] }]);
    expect(html).toContain('Initial overrides');
    expect(html).toContain('soften edges');
    expect(html).not.toContain('exp-delta-added');
  });

  it('keeps duplicate patches distinct instead of collapsing them into one', async () => {
    // base に同じ patch が2件、次の Run に1件。差し引き1件が removed になる。
    const html = await experimentWithRuns([{ patches: [cfg, cfg] }, { patches: [cfg] }]);
    const removedCount = html.split('exp-delta-removed').length - 1;
    expect(removedCount).toBe(1);
  });

  it('falls back to the leaf diff when the base run is not patch-shaped', async () => {
    const experiment = await postJson<{ id: string; short_id: string }>('/api/v1/experiments', {
      name: `ui-exp-match-${crypto.randomUUID().slice(0, 8)}`,
    });
    // base run の overrides は非 patch 形式 (leaf diff フォールバックを起こすため) なので
    // API のエンベロープ検証を通らず env.DB へ直接 INSERT する。
    const now = new Date().toISOString();
    const baseId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO experiment_runs (id, experiment_id, run_index, overrides_json, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`,
    )
      .bind(baseId, experiment.body.id, JSON.stringify({ controlnet: { weight: 0.6 } }), now, now)
      .run();
    await postJson(`/api/v1/experiments/${experiment.body.id}/runs`, {
      parent_run_id: baseId,
      overrides: { patches: [socks] },
    });

    const res = await req(`/experiments/${experiment.body.short_id}`);
    const html = await res.text();
    // patch リストとして突き合わせず、leaf diff の path 表記が出る。
    expect(html).toContain('controlnet.weight');
    expect(html).toContain('patches');
    expect(html).not.toContain('exp-delta-kept');
  });
});
