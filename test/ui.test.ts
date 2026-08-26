import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, postJson, req } from './helpers';

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

  it('GET /compare?ids=a,b renders both generations', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const res = await req(`/compare?ids=${g1.short_id},${g2.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(g1.short_id);
    expect(body).toContain(g2.short_id);
  });
});
