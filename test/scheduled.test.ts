import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { createGeneration } from './helpers';

function controller(scheduledTime: number): ScheduledController {
  return { scheduledTime, cron: '*/30 * * * *', noRetry() {} } as ScheduledController;
}

describe('scheduled handler', () => {
  it('never deletes an original, however old and unreferenced the Generation is', async () => {
    const { generation } = await createGeneration();
    const key = `generations/${generation.id}/original.png`;
    await env.IMAGES.put(key, new Uint8Array([1, 2, 3]));
    const old = new Date('2020-01-01T00:00:00.000Z').toISOString();
    await env.DB.prepare('UPDATE generations SET created_at = ?, r2_object_key = ?, rating = NULL, bookmark = 0 WHERE id = ?')
      .bind(old, key, generation.id)
      .run();

    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    await worker.scheduled!(controller(Date.now()), env, ctx);
    await Promise.all(waits);

    expect(await env.IMAGES.head(key)).not.toBeNull();
    const row = await env.DB.prepare('SELECT original_purged_at FROM generations WHERE id = ?').bind(generation.id).first<{ original_purged_at: string | null }>();
    expect(row?.original_purged_at).toBeNull();
  });
});
