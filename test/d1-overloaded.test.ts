import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { handleError } from '../src/app';

function failingApp(message: string) {
  const probe = new Hono();
  probe.get('/boom', () => {
    throw new Error(message);
  });
  probe.onError(handleError);
  return probe;
}

describe('handleError', () => {
  it('answers a D1 overloaded error with 503 d1_overloaded and Retry-After', async () => {
    const res = await failingApp('D1_ERROR: D1 DB is overloaded. Requests queued for too long.').request('/boom');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('d1_overloaded');
  });

  it('keeps any other error as 500 internal_error', async () => {
    const res = await failingApp('something else').request('/boom');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('internal_error');
  });
});
