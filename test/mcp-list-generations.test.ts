import { describe, expect, it } from 'vitest';
import { createGeneration, mcpToolCall, postJson } from './helpers';

interface ListItem {
  short_id: string;
  canonical_url: string;
  tags: string[];
  image_url?: string;
}

interface ListResult {
  items: ListItem[];
  total: number;
}

describe('MCP list_generations', () => {
  it('filters by tag and returns gallery fields without image fields', async () => {
    const { generation } = await createGeneration();
    const tag = `outfit-good-${crypto.randomUUID().slice(0, 8)}`;
    await postJson(`/api/v1/generations/${generation.id}/tags`, { name: tag });

    const call = await mcpToolCall<ListResult>('list_generations', { tag });
    expect(call.isError).toBe(false);
    expect(call.data?.items.map((item) => item.short_id)).toEqual([generation.short_id]);
    expect(call.data?.total).toBe(1);

    const item = call.data?.items[0];
    expect(item?.short_id).toBe(generation.short_id);
    expect(item?.canonical_url).toContain(generation.short_id);
    expect(item?.tags).toContain(tag);
    expect(item?.image_url).toBeUndefined();
  });
});
