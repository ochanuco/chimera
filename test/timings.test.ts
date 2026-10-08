import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, createJob, createRequest, postJson, req, setJobGraph } from './helpers';

const PROMPT = 'a1111111-0000-4000-8000-000000000001';

function body(overrides: Record<string, unknown> = {}) {
  return {
    worker_id: 'w1',
    attempt: 1,
    version: 'v2',
    source: 'worker',
    status: 'done',
    claimed_at: 1000,
    finished_at: 9000,
    env: { comfyui_version: '0.37.0', argv: ['main.py', '--fast'], attention: 'ck' },
    cold_load: false,
    prompts: [
      {
        prompt_id: PROMPT,
        purpose: 'render',
        resumed: false,
        submitted_at: 1500,
        execution_start_at: 2000,
        execution_end_at: 7000,
        outputs_ready_at: 7100,
        ingested_at: 8000,
        status: 'success',
        nodes: [
          { node_id: '3', class_type: 'KSampler', role: 'base_sampler', cached: false, started_at: 2100, ended_at: 6900, steps_total: 3, step_ms: [400, 300, 300] },
          { node_id: '1', class_type: 'CheckpointLoaderSimple', role: 'unet_loader', cached: true, started_at: null, ended_at: null },
        ],
      },
    ],
    ...overrides,
  };
}

async function counts() {
  const one = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
  return { attempts: await one('request_attempt_timings'), prompts: await one('prompt_timings'), nodes: await one('node_timings') };
}

beforeEach(async () => {
  await clearGenerationData();
});

describe('migration 0041 generation timings', () => {
  it('creates the three tables with the unique attempt key', async () => {
    expect(env.TEST_MIGRATIONS.some((m) => m.name === '0041_generation_timings.sql')).toBe(true);
    const { body: request } = await createRequest();
    const insert = (version: string) =>
      env.DB.prepare(
        `INSERT INTO request_attempt_timings (id, request_id, attempt, version, source, status, created_at) VALUES (?, ?, 1, ?, 'worker', 'done', '2026-01-01T00:00:00Z')`,
      ).bind(crypto.randomUUID(), request.id, version);
    await insert('v2').run();
    await insert('v1').run();
    await expect(insert('v2').run()).rejects.toThrow();
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%timings%'").all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(
      expect.arrayContaining(['idx_request_attempt_timings_request_id', 'idx_prompt_timings_request_id', 'idx_prompt_timings_prompt_id', 'idx_node_timings_role']),
    );
  });
});

describe('PUT /api/v1/requests/:id/timings', () => {
  it('stores attempt, prompt and node rows with derived durations and a resolved job', async () => {
    const { request, job } = await createGeneration();
    await env.DB.prepare('UPDATE comfy_jobs SET comfy_prompt_id = ? WHERE id = ?').bind(PROMPT, job.id).run();
    const res = await postJson(`/api/v1/requests/${request.id}/timings`, body(), 'PUT');
    expect(res).toEqual({ status: 200, body: { ok: true } });

    const attempt = await env.DB.prepare('SELECT * FROM request_attempt_timings WHERE request_id = ?').bind(request.id).first<Record<string, unknown>>();
    expect(attempt).toMatchObject({ attempt: 1, version: 'v2', source: 'worker', status: 'done', claimed_at: 1000, finished_at: 9000, cold_load: 0, worker_id: 'w1' });
    expect(JSON.parse(attempt!.env_json as string)).toMatchObject({ attention: 'ck' });
    const prompt = await env.DB.prepare('SELECT * FROM prompt_timings WHERE request_id = ?').bind(request.id).first<Record<string, unknown>>();
    expect(prompt).toMatchObject({ prompt_id: PROMPT, comfy_job_id: job.id, purpose: 'render', resumed: 0, status: 'success', ingested_at: 8000 });
    const { results: nodes } = await env.DB.prepare('SELECT * FROM node_timings ORDER BY node_id').all<Record<string, unknown>>();
    expect(nodes[0]).toMatchObject({ node_id: '1', cached: 1, duration_ms: null });
    expect(nodes[1]).toMatchObject({ node_id: '3', role: 'base_sampler', cached: 0, duration_ms: 4800, steps_total: 3, step_ms_json: '[400,300,300]' });
  });

  it('stores every node of large multi-prompt graphs', async () => {
    const { body: request } = await createRequest();
    const nodes = Array.from({ length: 45 }, (_, i) => ({ node_id: String(i), class_type: 'KSampler', role: `r${i}`, cached: false, started_at: i, ended_at: i + 2 }));
    const prompts = Array.from({ length: 6 }, (_, i) => ({ ...body().prompts[0], prompt_id: `p${i}`, nodes }));
    const res = await postJson(`/api/v1/requests/${request.id}/timings`, body({ prompts }), 'PUT');
    expect(res.status).toBe(200);
    expect(await counts()).toEqual({ attempts: 1, prompts: 6, nodes: 270 });
  });

  it('leaves comfy_job_id null when no Job carries the prompt id', async () => {
    const { body: request } = await createRequest();
    await postJson(`/api/v1/requests/${request.id}/timings`, body(), 'PUT');
    const prompt = await env.DB.prepare('SELECT comfy_job_id FROM prompt_timings').first<{ comfy_job_id: string | null }>();
    expect(prompt!.comfy_job_id).toBeNull();
  });

  it('replaces the attempt and its children when resent', async () => {
    const { body: request } = await createRequest();
    await postJson(`/api/v1/requests/${request.id}/timings`, body(), 'PUT');
    expect(await counts()).toEqual({ attempts: 1, prompts: 1, nodes: 2 });

    const resent = body({
      status: 'failed',
      prompts: [{ ...body().prompts[0], nodes: [{ node_id: '9', class_type: 'SaveImage', role: 'save_image', cached: false, started_at: 1, ended_at: 4 }] }],
    });
    expect((await postJson(`/api/v1/requests/${request.id}/timings`, resent, 'PUT')).status).toBe(200);
    expect(await counts()).toEqual({ attempts: 1, prompts: 1, nodes: 1 });
    const row = await env.DB.prepare('SELECT status FROM request_attempt_timings').first<{ status: string }>();
    expect(row!.status).toBe('failed');

    await postJson(`/api/v1/requests/${request.id}/timings`, body({ version: 'v1', source: 'comfy_history' }), 'PUT');
    await postJson(`/api/v1/requests/${request.id}/timings`, body({ attempt: 2 }), 'PUT');
    expect((await counts()).attempts).toBe(3);
  });

  it('removes child rows through ON DELETE CASCADE', async () => {
    const { body: request } = await createRequest();
    await postJson(`/api/v1/requests/${request.id}/timings`, body(), 'PUT');
    await env.DB.prepare('DELETE FROM request_attempt_timings').run();
    expect(await counts()).toEqual({ attempts: 0, prompts: 0, nodes: 0 });
  });

  it('returns 404 for an unknown request', async () => {
    const res = await postJson(`/api/v1/requests/${crypto.randomUUID()}/timings`, body(), 'PUT');
    expect(res.status).toBe(404);
  });

  it('rejects an invalid body with 400', async () => {
    const { body: request } = await createRequest();
    for (const bad of [body({ version: 'v3' }), body({ status: 'weird' }), { ...body(), worker_id: undefined }, body({ claimed_at: 'x' })]) {
      const res = await postJson<{ error: { code: string } }>(`/api/v1/requests/${request.id}/timings`, bad, 'PUT');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });
});

describe('POST /api/v1/timings/import-comfy-history', () => {
  const P1 = 'b2222222-0000-4000-8000-000000000001';
  const P2 = 'b2222222-0000-4000-8000-000000000002';
  const UNMAPPED = 'b2222222-0000-4000-8000-0000000000ff';

  it('imports cached nodes and execution times per request, skipping unmapped prompts', async () => {
    const { body: request } = await createRequest({ status: 'done' });
    await env.DB.prepare("UPDATE requests SET attempt = 2, worker_id = 'w9', claimed_at = '2026-01-01T00:00:10.000Z', finished_at = '2026-01-01T00:01:10.000Z' WHERE id = ?").bind(request.id).run();
    const job1 = (await createJob(request.id)).body;
    const job2 = (await createJob(request.id)).body;
    await env.DB.prepare('UPDATE comfy_jobs SET comfy_prompt_id = ? WHERE id = ?').bind(P1, job1.id).run();
    await env.DB.prepare('UPDATE comfy_jobs SET comfy_prompt_id = ? WHERE id = ?').bind(P2, job2.id).run();
    await setJobGraph(job1.id, { '4': { class_type: 'CheckpointLoaderSimple', inputs: {}, _meta: { title: 'unet_loader' } }, '5': { class_type: 'VAELoader', inputs: {} } });

    const history = {
      [P1]: {
        status: {
          status_str: 'success',
          messages: [
            ['execution_start', { prompt_id: P1, timestamp: 100000 }],
            ['execution_cached', { nodes: ['4', '5', '77'], prompt_id: P1, timestamp: 100001 }],
            ['execution_success', { prompt_id: P1, timestamp: 130000 }],
          ],
        },
      },
      [P2]: {
        status: {
          status_str: 'error',
          messages: [
            ['execution_start', { prompt_id: P2, timestamp: 200000 }],
            ['execution_error', { prompt_id: P2, timestamp: 210000 }],
          ],
        },
      },
      [UNMAPPED]: { status: { status_str: 'success', messages: [] } },
    };
    const res = await postJson<{ imported_requests: number; imported_prompts: number; skipped_prompt_ids: string[] }>('/api/v1/timings/import-comfy-history', history);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported_requests: 1, imported_prompts: 2, skipped_prompt_ids: [UNMAPPED] });

    const attempt = await env.DB.prepare('SELECT * FROM request_attempt_timings').first<Record<string, unknown>>();
    expect(attempt).toMatchObject({ attempt: 2, version: 'v1', source: 'comfy_history', status: 'done', worker_id: 'w9', claimed_at: Date.parse('2026-01-01T00:00:10.000Z'), finished_at: Date.parse('2026-01-01T00:01:10.000Z') });
    const p1 = await env.DB.prepare('SELECT * FROM prompt_timings WHERE prompt_id = ?').bind(P1).first<Record<string, unknown>>();
    expect(p1).toMatchObject({ execution_start_at: 100000, execution_end_at: 130000, status: 'success', comfy_job_id: job1.id });
    const p2 = await env.DB.prepare('SELECT * FROM prompt_timings WHERE prompt_id = ?').bind(P2).first<Record<string, unknown>>();
    expect(p2).toMatchObject({ execution_end_at: 210000, status: 'error' });
    const { results: nodes } = await env.DB.prepare('SELECT node_id, class_type, role, cached, duration_ms FROM node_timings ORDER BY node_id').all<Record<string, unknown>>();
    expect(nodes).toEqual([
      { node_id: '4', class_type: 'CheckpointLoaderSimple', role: 'unet_loader', cached: 1, duration_ms: null },
      { node_id: '5', class_type: 'VAELoader', role: null, cached: 1, duration_ms: null },
      { node_id: '77', class_type: 'unknown', role: null, cached: 1, duration_ms: null },
    ]);

    // Re-import is idempotent and a v2 row for the same attempt is untouched.
    await postJson(`/api/v1/requests/${request.id}/timings`, body({ attempt: 2 }), 'PUT');
    await postJson('/api/v1/timings/import-comfy-history', history);
    const { results } = await env.DB.prepare('SELECT version FROM request_attempt_timings ORDER BY version').all<{ version: string }>();
    expect(results.map((r) => r.version)).toEqual(['v1', 'v2']);
  });

  it('rejects a non-object body', async () => {
    const res = await req('/api/v1/timings/import-comfy-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
    expect(res.status).toBe(400);
  });
});
