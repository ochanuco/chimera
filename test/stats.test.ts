import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeStats, median, percentile, windowStart, type StatsData } from '../src/lib/stats';
import { clearGenerationData, createGeneration, getJson, postJson, req } from './helpers';

const NOW = new Date('2026-10-09T00:00:00.000Z');

function request(id: string, kind: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    status: 'done',
    recipe: 'yukari-anima',
    created_at: '2026-10-08T03:00:00.000Z',
    claimed_at: null,
    finished_at: null,
    parameters_json: null,
    preset_versions_json: null,
    ...overrides,
  };
}

function attempt(id: string, requestId: string, overrides: Record<string, unknown> = {}) {
  return { id, request_id: requestId, version: 'v2', source: 'worker', status: 'done', claimed_at: 1000, finished_at: 20000, env_json: null, cold_load: 0, ...overrides };
}

function prompt(attemptId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${attemptId}-p`,
    attempt_timing_id: attemptId,
    submitted_at: 2000,
    execution_start_at: 5000,
    execution_end_at: 15000,
    outputs_ready_at: 15500,
    ingested_at: 17000,
    ...overrides,
  };
}

function data(overrides: Partial<Record<keyof StatsData, unknown>>): StatsData {
  return { requests: [], attempts: [], prompts: [], nodes: [], renderFacts: new Map(), generations: [], ...overrides } as StatsData;
}

describe('percentiles', () => {
  it('computes median and nearest-rank p90', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([5], 0.9)).toBe(5);
  });

  it('derives the window start from the period', () => {
    expect(windowStart('7d', NOW)).toBe('2026-10-02T00:00:00.000Z');
    expect(windowStart('all', NOW)).toBeNull();
  });
});

describe('computeStats', () => {
  it('falls back to the requests table as v1 for requests without timing rows', () => {
    const stats = computeStats(
      data({
        requests: [
          request('r1', 'generate', { claimed_at: '2026-10-08T03:00:00.000Z', finished_at: '2026-10-08T03:01:00.000Z' }),
          request('r2', 'generate', { claimed_at: '2026-10-08T04:00:00.000Z', finished_at: '2026-10-08T04:03:00.000Z' }),
          request('r3', 'generate', { status: 'queued', claimed_at: '2026-10-08T04:00:00.000Z' }),
          request('r4', 'generate', { status: 'cancelled', claimed_at: '2026-10-08T04:00:00.000Z', finished_at: '2026-10-08T04:05:00.000Z' }),
        ],
      }),
      '30d',
      'include',
      NOW,
    );
    expect(stats.daily).toEqual([{ date: '2026-10-08', kind: 'generate', version: 'v1', n: 2, median_ms: 120000 }]);
    expect(stats.counts.gpu_approx_ms).toBe(240000);
    expect(stats.counts.gpu_ms).toBe(0);
    expect(stats.segments).toEqual([]);
  });

  it('splits a v2 attempt into segments and keeps v1 and v2 series apart', () => {
    const stats = computeStats(
      data({
        requests: [request('r1', 'generate'), request('r2', 'generate', { claimed_at: '2026-10-08T05:00:00.000Z', finished_at: '2026-10-08T05:00:30.000Z' })],
        attempts: [attempt('a1', 'r1')],
        prompts: [prompt('a1')],
      }),
      '30d',
      'include',
      NOW,
    );
    const seg = Object.fromEntries(stats.segments.map((s) => [s.segment, s]));
    expect(seg.pre_submit).toMatchObject({ n: 1, median_ms: 1000 });
    expect(seg.queue!.median_ms).toBe(3000);
    expect(seg.execute!.median_ms).toBe(10000);
    expect(seg.post!.median_ms).toBe(2000);
    expect(seg.tail!.median_ms).toBe(3000);
    expect(stats.daily).toEqual([
      { date: '2026-10-08', kind: 'generate', version: 'v1', n: 1, median_ms: 30000 },
      { date: '2026-10-08', kind: 'generate', version: 'v2', n: 1, median_ms: 19000 },
    ]);
    expect(stats.counts.gpu_ms).toBe(10000);
  });

  it('sums multiple prompts and falls back to outputs_ready_at when not ingested', () => {
    const stats = computeStats(
      data({
        requests: [request('r1', 'redraw')],
        attempts: [attempt('a1', 'r1')],
        prompts: [
          prompt('a1', { id: 'pa', submitted_at: 2000, execution_start_at: 3000, execution_end_at: 6000, outputs_ready_at: 6500, ingested_at: null }),
          prompt('a1', { id: 'pb', submitted_at: 7000, execution_start_at: 8000, execution_end_at: 12000, outputs_ready_at: 12100, ingested_at: 13000 }),
        ],
      }),
      '30d',
      'include',
      NOW,
    );
    const seg = Object.fromEntries(stats.segments.map((s) => [s.segment, s.median_ms]));
    expect(seg).toEqual({ pre_submit: 1000, queue: 2000, execute: 7000, post: 500 + 1000, tail: 7000 });
  });

  it('drops cold-load attempts when cold is excluded', () => {
    const base = data({
      requests: [request('r1', 'generate'), request('r2', 'generate')],
      attempts: [attempt('a1', 'r1', { cold_load: 1, finished_at: 100000 }), attempt('a2', 'r2', { cold_load: 0, finished_at: 20000 })],
      prompts: [prompt('a1'), prompt('a2')],
    });
    const included = computeStats(base, '30d', 'include', NOW);
    expect(included.daily[0]).toMatchObject({ version: 'v2', n: 2, median_ms: (99000 + 19000) / 2 });
    const excluded = computeStats(base, '30d', 'exclude', NOW);
    expect(excluded.daily[0]).toMatchObject({ n: 1, median_ms: 19000 });
    expect(excluded.segments.find((s) => s.segment === 'execute')!.n).toBe(1);
  });

  it('reports p90 per segment', () => {
    const requests = Array.from({ length: 10 }, (_, i) => request(`r${i}`, 'generate'));
    const attempts = requests.map((r, i) => attempt(`a${i}`, r.id));
    const prompts = requests.map((r, i) => prompt(`a${i}`, { execution_end_at: 5000 + (i + 1) * 1000 }));
    const execute = computeStats(data({ requests, attempts, prompts }), '30d', 'include', NOW).segments.find((s) => s.segment === 'execute')!;
    expect(execute).toMatchObject({ n: 10, median_ms: 5500, p90_ms: 9000 });
  });

  it('groups role durations by checkpoint and canvas, excluding nodes without a role', () => {
    const facts = JSON.stringify({ version: 2, checkpoints: ['ckpt.safetensors'], canvas: { width: 896, height: 1440, final_size: null } });
    const stats = computeStats(
      data({
        requests: [request('r1', 'generate')],
        attempts: [attempt('a1', 'r1')],
        prompts: [prompt('a1')],
        renderFacts: new Map([['j1', facts]]),
        nodes: [
          { attempt_timing_id: 'a1', role: 'base_sampler', duration_ms: 4000, step_ms_json: null, comfy_job_id: 'j1' },
          { attempt_timing_id: 'a1', role: 'base_sampler', duration_ms: 6000, step_ms_json: null, comfy_job_id: 'j1' },
          { attempt_timing_id: 'a1', role: 'vae_decode', duration_ms: 500, step_ms_json: null, comfy_job_id: null },
          { attempt_timing_id: 'gone', role: 'base_sampler', duration_ms: 1, step_ms_json: null, comfy_job_id: 'j1' },
        ],
      }),
      '30d',
      'include',
      NOW,
    );
    expect(stats.roles).toEqual([
      { checkpoint: 'ckpt.safetensors', canvas: '896x1440', role: 'base_sampler', n: 2, median_ms: 5000, p90_ms: 6000 },
      { checkpoint: 'unknown', canvas: 'unknown', role: 'vae_decode', n: 1, median_ms: 500, p90_ms: 500 },
    ]);
  });

  it('computes per-step medians and the step-1 versus rest split', () => {
    const stats = computeStats(
      data({
        requests: [request('r1', 'generate')],
        attempts: [attempt('a1', 'r1')],
        nodes: [
          { attempt_timing_id: 'a1', role: 'base_sampler', duration_ms: 1, step_ms_json: '[900,100,100]', comfy_job_id: null },
          { attempt_timing_id: 'a1', role: 'base_sampler', duration_ms: 1, step_ms_json: '[700,300,200]', comfy_job_id: null },
        ],
      }),
      '30d',
      'include',
      NOW,
    );
    expect(stats.steps).toEqual([
      {
        role: 'base_sampler',
        n: 2,
        steps: [
          { index: 1, n: 2, median_ms: 800 },
          { index: 2, n: 2, median_ms: 200 },
          { index: 3, n: 2, median_ms: 150 },
        ],
        first_median_ms: 800,
        rest_median_ms: 150,
      },
    ]);
  });

  it('compares v2 execute time across environments per kind', () => {
    const env1 = JSON.stringify({ comfyui_version: '0.37.0', attention: 'ck', argv: ['main.py', '--fast'] });
    const env2 = JSON.stringify({ comfyui_version: '0.37.0', attention: 'pytorch', argv: ['main.py'] });
    const stats = computeStats(
      data({
        requests: [request('r1', 'generate'), request('r2', 'generate'), request('r3', 'generate')],
        attempts: [attempt('a1', 'r1', { env_json: env1 }), attempt('a2', 'r2', { env_json: env2 }), attempt('a3', 'r3', { env_json: env1 })],
        prompts: [prompt('a1'), prompt('a2', { execution_end_at: 25000 }), prompt('a3', { execution_end_at: 7000 })],
      }),
      '30d',
      'include',
      NOW,
    );
    expect(stats.environments).toEqual([
      { comfyui_version: '0.37.0', attention: 'ck', argv: 'main.py --fast', kind: 'generate', n: 2, median_execute_ms: 6000 },
      { comfyui_version: '0.37.0', attention: 'pytorch', argv: 'main.py', kind: 'generate', n: 1, median_execute_ms: 20000 },
    ]);
  });

  it('counts generations by rating, kind, recipe and pose with the tail aggregated', () => {
    const gen = (rating: string | null, kind: string, pose: string, published = 0) => ({
      rating,
      kind,
      recipe: 'yukari-anima',
      parameters_json: JSON.stringify({ pose }),
      preset_versions_json: null,
      published,
    });
    const poses = Array.from({ length: 12 }, (_, i) => gen(null, 'generate', `pose${i}`));
    const stats = computeStats(
      data({
        requests: [request('r1', 'generate')],
        attempts: [attempt('a1', 'r1')],
        prompts: [prompt('a1')],
        generations: [gen('good', 'generate', 'a', 1), gen('good', 'redraw', 'a'), gen('bad', 'generate', 'b'), gen('neutral', 'generate', 'b'), ...poses],
      }),
      '30d',
      'include',
      NOW,
    );
    const c = stats.counts;
    expect(c.generations).toBe(16);
    expect(c.by_rating).toEqual({ good: 2, neutral: 1, bad: 1, unrated: 12 });
    expect(c.published).toBe(1);
    expect(c.by_kind).toEqual([{ key: 'generate', count: 15 }, { key: 'redraw', count: 1 }]);
    expect(c.by_recipe).toEqual([{ key: 'yukari-anima', count: 16 }]);
    expect(c.by_pose).toHaveLength(11);
    expect(c.by_pose.slice(0, 2)).toEqual([{ key: 'a', count: 2 }, { key: 'b', count: 2 }]);
    expect(c.by_pose.at(-1)).toEqual({ key: '(その他)', count: 4 });
    expect(c.wall_ms).toBe(19000);
    expect(c.mean_ms_per_generation).toBe(19000 / 16);
    expect(c.ms_per_good_generation).toBe(9500);
  });
});

describe('stats from D1', () => {
  beforeEach(async () => {
    await clearGenerationData();
  });

  it('serves GET /api/v1/stats and the /stats page with defaults and validation', async () => {
    const { request: r } = await createGeneration();
    await env.DB.prepare("UPDATE requests SET claimed_at = ?, finished_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 60000).toISOString(), new Date().toISOString(), r.id)
      .run();

    const res = await getJson<{ period: string; cold: string; counts: { generations: number }; daily: { version: string; median_ms: number }[] }>('/api/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ period: '30d', cold: 'include', counts: { generations: 1 } });
    expect(res.body.daily).toMatchObject([{ version: 'v1', median_ms: 60000 }]);
    await postJson(
      `/api/v1/requests/${r.id}/timings`,
      {
        worker_id: 'w1',
        attempt: 1,
        version: 'v2',
        source: 'worker',
        status: 'done',
        claimed_at: 1000,
        finished_at: 9000,
        cold_load: true,
        prompts: [{ prompt_id: 'p', purpose: 'render', status: 'success', submitted_at: 2000, execution_start_at: 3000, execution_end_at: 8000, ingested_at: 8500, nodes: [] }],
      },
      'PUT',
    );
    const withV2 = await getJson<{ segments: { segment: string; median_ms: number }[] }>('/api/v1/stats');
    expect(withV2.body.segments.find((s) => s.segment === 'execute')!.median_ms).toBe(5000);
    expect((await getJson<{ segments: unknown[] }>('/api/v1/stats?cold=exclude')).body.segments).toEqual([]);
    expect((await getJson('/api/v1/stats?period=all&cold=exclude')).status).toBe(200);
    expect((await getJson('/api/v1/stats?period=1y')).status).toBe(400);
    expect((await getJson('/api/v1/stats?cold=maybe')).status).toBe(400);

    const page = await req('/stats?period=7d&cold=exclude');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('生成時間の統計');
    expect(html).toContain('href="/stats?period=30d&amp;cold=exclude"');
    expect(html).toContain('href="/stats?period=7d&amp;cold=include"');
    expect(await (await req('/stats')).text()).toContain('<svg');
    expect(html).toContain('href="/stats"');
    expect((await req('/stats?period=bogus')).status).toBe(200);
  });
});
