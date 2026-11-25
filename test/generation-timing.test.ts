import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, postJson, req } from './helpers';
import { formatDuration, formatJstMinute, loadGenerationTiming } from '../src/lib/generation-timing';

const PROMPT = 'b2222222-0000-4000-8000-000000000002';

async function setRequestTimes(requestId: string, times: { status?: string; created_at: string; claimed_at: string | null; finished_at: string | null }) {
  await env.DB.prepare('UPDATE requests SET status = ?, created_at = ?, claimed_at = ?, finished_at = ? WHERE id = ?')
    .bind(times.status ?? 'done', times.created_at, times.claimed_at, times.finished_at, requestId)
    .run();
}

function timings(executionStart: number, executionEnd: number) {
  return {
    worker_id: 'w1',
    attempt: 1,
    version: 'v2',
    source: 'worker',
    status: 'done',
    claimed_at: 1000,
    finished_at: executionEnd + 1000,
    prompts: [
      {
        prompt_id: PROMPT,
        purpose: 'render',
        resumed: false,
        submitted_at: executionStart - 100,
        execution_start_at: executionStart,
        execution_end_at: executionEnd,
        status: 'success',
        nodes: [],
      },
    ],
  };
}

describe('formatDuration', () => {
  it('writes seconds, minutes and hours in Japanese units', () => {
    expect(formatDuration(42_000)).toBe('42 秒');
    expect(formatDuration(192_000)).toBe('3 分 12 秒');
    expect(formatDuration(180_000)).toBe('3 分');
    expect(formatDuration(3_900_000)).toBe('1 時間 5 分');
    expect(formatDuration(400)).toBe('1 秒未満');
  });
});

describe('formatJstMinute', () => {
  it('shows the JST wall clock, crossing midnight', () => {
    expect(formatJstMinute('2026-11-24T14:06:00.000Z')).toBe('11/24 23:06');
    expect(formatJstMinute('2026-11-24T16:37:00.000Z')).toBe('11/25 01:37');
  });
});

describe('Generation Detail 描画 row', () => {
  it('takes the render time from the job prompt timing and the wait from the request', async () => {
    const { request, job, generation } = await createGeneration();
    await env.DB.prepare('UPDATE comfy_jobs SET comfy_prompt_id = ? WHERE id = ?').bind(PROMPT, job.id).run();
    expect((await postJson(`/api/v1/requests/${request.id}/timings`, timings(2000, 44_000), 'PUT')).status).toBe(200);
    await setRequestTimes(request.id, {
      created_at: '2026-11-24T14:00:00.000Z',
      claimed_at: '2026-11-24T14:03:12.000Z',
      finished_at: '2026-11-24T14:10:00.000Z',
    });

    expect(await loadGenerationTiming(env.DB, job.id)).toEqual({ renderMs: 42_000, waitMs: 192_000 });
    const html = await (await req(`/g/${generation.short_id}`)).text();
    expect(html).toContain('<dt class="kv-k">描画</dt>');
    expect(html).toContain('42 秒<span class="kv-dim">（待ち 3 分 12 秒）</span>');
  });

  it('falls back to claimed → finished of a finished request without timings', async () => {
    const { request, job } = await createGeneration();
    await setRequestTimes(request.id, {
      created_at: '2026-11-24T14:00:00.000Z',
      claimed_at: '2026-11-24T14:00:05.000Z',
      finished_at: '2026-11-24T14:01:35.000Z',
    });
    expect(await loadGenerationTiming(env.DB, job.id)).toEqual({ renderMs: 90_000, waitMs: 5_000 });
  });

  it('hides the row when neither timings nor a finished request exist', async () => {
    const { request, job, generation } = await createGeneration();
    await setRequestTimes(request.id, { status: 'running', created_at: '2026-11-24T14:00:00.000Z', claimed_at: '2026-11-24T14:00:05.000Z', finished_at: null });
    expect(await loadGenerationTiming(env.DB, job.id)).toBeNull();
    expect(await (await req(`/g/${generation.short_id}`)).text()).not.toContain('>描画<');
  });
});
