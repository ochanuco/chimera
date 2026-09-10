import { describe, expect, it } from 'vitest';
import { createGeneration, mcpToolCall, postJson } from './helpers';

interface Publication {
  id: string;
  generation_id: string;
  url: string | null;
  published_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

describe('MCP record_publication', () => {
  it('records a publication by short_id, defaults created_by to mcp, and is idempotent', async () => {
    const { generation } = await createGeneration();

    const call = await mcpToolCall<Publication>('record_publication', {
      generation_id: generation.short_id,
      url: 'https://x.com/example/status/10',
    });
    expect(call.isError).toBe(false);
    expect(call.data?.generation_id).toBe(generation.id);
    expect(call.data?.url).toBe('https://x.com/example/status/10');
    expect(call.data?.created_by).toBe('mcp');

    const replay = await mcpToolCall<Publication>('record_publication', {
      generation_id: generation.short_id,
      url: 'https://x.com/example/status/10',
    });
    // 別の idempotency_key 無し呼び出しは別レコードとして記録される (record_observation と同じ「キー無しは新規」規約)。
    expect(replay.isError).toBe(false);
    expect(replay.data?.id).not.toBe(call.data?.id);
  });

  it('resending the same idempotency_key returns the already-made row', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await mcpToolCall<Publication>('record_publication', {
      generation_id: generation.id,
      idempotency_key: key,
    });
    expect(first.isError).toBe(false);

    const second = await mcpToolCall<Publication>('record_publication', {
      generation_id: generation.id,
      idempotency_key: key,
    });
    expect(second.isError).toBe(false);
    expect(second.data?.id).toBe(first.data?.id);
  });

  it('rejects a non-https url', async () => {
    const { generation } = await createGeneration();
    const call = await mcpToolCall('record_publication', {
      generation_id: generation.id,
      url: 'ftp://example.com/x',
    });
    expect(call.isError).toBe(true);
  });
});

describe('MCP list_generations published + get_generation publications', () => {
  it('filters by published and includes the field on each item', async () => {
    const { generation: published } = await createGeneration();
    const { generation: unpublished } = await createGeneration();
    await mcpToolCall('record_publication', { generation_id: published.id });

    const call = await mcpToolCall<{ items: { short_id: string; published: boolean }[] }>('list_generations', {
      published: true,
    });
    expect(call.isError).toBe(false);
    const shortIds = call.data?.items.map((i) => i.short_id) ?? [];
    expect(shortIds).toContain(published.short_id);
    expect(shortIds).not.toContain(unpublished.short_id);
    expect(call.data?.items.find((i) => i.short_id === published.short_id)?.published).toBe(true);
  });

  it('get_generation includes publications', async () => {
    const { generation } = await createGeneration();
    await postJson(`/api/v1/generations/${generation.id}/publications`, { url: 'https://x.com/example/status/11' });

    const call = await mcpToolCall<{ publications: Publication[] }>('get_generation', { generation_id: generation.short_id });
    expect(call.isError).toBe(false);
    expect(call.data?.publications).toHaveLength(1);
    expect(call.data?.publications[0]?.url).toBe('https://x.com/example/status/11');
  });
});
