import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { enqueueWaitMs, settleRequest } from '../src/lib/request-settle';
import type { RequestRow } from '../src/types';
import { createJob, createRequest, mcpToolCall } from './helpers';

async function row(id: string): Promise<RequestRow> {
  return (await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<RequestRow>()) as RequestRow;
}

describe('settleRequest', () => {
  it('returns a failed request with its error', async () => {
    const { body } = await createRequest({ status: 'queued' });
    await env.DB.prepare("UPDATE requests SET status = 'failed', error = 'patch compile failed' WHERE id = ?").bind(body.id).run();
    const { row: seen, settled } = await settleRequest(env.DB, await row(body.id), 5_000);
    expect(settled.outcome).toBe('failed');
    expect(seen.error).toBe('patch compile failed');
  });

  it('reports submitted once a Job carries a comfy_prompt_id', async () => {
    const { body } = await createRequest({ status: 'running' });
    const job = await createJob(body.id);
    await env.DB.prepare("UPDATE comfy_jobs SET comfy_prompt_id = 'p1' WHERE id = ?").bind(job.body.id).run();
    const { settled } = await settleRequest(env.DB, await row(body.id), 5_000);
    expect(settled.outcome).toBe('submitted');
  });

  it('does not count a Job the worker has not submitted yet', async () => {
    const { body } = await createRequest({ status: 'running' });
    await createJob(body.id);
    const { settled } = await settleRequest(env.DB, await row(body.id), 0);
    expect(settled.outcome).toBe('pending');
  });

  it('sees a failure that lands while it waits', async () => {
    const { body } = await createRequest({ status: 'queued' });
    const waiting = settleRequest(env.DB, await row(body.id), 5_000);
    await env.DB.prepare("UPDATE requests SET status = 'failed', error = 'boom' WHERE id = ?").bind(body.id).run();
    const { settled } = await waiting;
    expect(settled.outcome).toBe('failed');
    expect(settled.waited_ms).toBeLessThan(5_000);
  });
});

describe('enqueueWaitMs', () => {
  it('defaults when unset or invalid and honours 0', () => {
    expect(enqueueWaitMs(undefined)).toBe(30_000);
    expect(enqueueWaitMs('nope')).toBe(30_000);
    expect(enqueueWaitMs('0')).toBe(0);
    expect(enqueueWaitMs('12000')).toBe(12_000);
  });
});

describe('MCP enqueue tools', () => {
  it('return what they saw of the worker', async () => {
    const created = await mcpToolCall<{ settled: { outcome: string } }>('create_request', {
      kind: 'generate',
      payload: { schema_version: 1, request: { instruction: 'settle', count: 1 }, generation: { recipe: 'yukari', parameters: { pose: 'stand' } } },
      idempotency_key: crypto.randomUUID(),
    });
    expect(created.isError).toBe(false);
    expect(created.data?.settled.outcome).toBe('pending');
  });

  it('refuse a generate payload without request.instruction', async () => {
    const created = await mcpToolCall('create_request', {
      kind: 'generate',
      payload: { schema_version: 1, request: { count: 1 }, generation: { recipe: 'yukari' } },
      idempotency_key: crypto.randomUUID(),
    });
    expect(created.isError).toBe(true);
  });
});
