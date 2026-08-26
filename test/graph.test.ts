import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, createJob, getJson, ingestGeneration, postJson } from './helpers';

interface GraphGeneration {
  short_id: string;
  rating: 'good' | 'neutral' | 'bad' | null;
  bookmark: boolean;
}

interface GraphNode {
  id: string;
  short_id: string;
  raw_instruction: string | null;
  status: string;
  created_at: string;
  generation_count: number;
  generations: GraphGeneration[];
  thumbnail_generation_short_id: string | null;
}

interface GraphEdge {
  type: 'reference' | 'relation' | 'story';
  source_batch_id: string;
  target_batch_id: string;
  label: string;
  source_generation_short_id?: string;
  aspect?: string | null;
  relation_type?: string | null;
  actor?: string;
  story_id?: string;
}

describe('GET /api/v1/graph', () => {
  it('returns every batch as a node, ordered by created_at ascending', async () => {
    const b1 = await createBatch();
    const b2 = await createBatch();

    const res = await getJson<{ nodes: GraphNode[]; edges: GraphEdge[] }>('/api/v1/graph');
    expect(res.status).toBe(200);

    const ids = res.body.nodes.map((n) => n.id);
    expect(ids.indexOf(b1.body.id)).toBeLessThan(ids.indexOf(b2.body.id));
  });

  it('reports generation_count and thumbnail_generation_short_id per batch', async () => {
    const { batch, generation } = await createGeneration();

    const res = await getJson<{ nodes: GraphNode[] }>('/api/v1/graph');
    const node = res.body.nodes.find((n) => n.id === batch.id);
    expect(node).toBeDefined();
    expect(node?.generation_count).toBe(1);
    expect(node?.thumbnail_generation_short_id).toBe(generation.short_id);
  });

  it('a batch with no generations has generation_count 0 and a null thumbnail', async () => {
    const batch = await createBatch();
    const res = await getJson<{ nodes: GraphNode[] }>('/api/v1/graph');
    const node = res.body.nodes.find((n) => n.id === batch.body.id);
    expect(node).toBeDefined();
    expect(node?.generation_count).toBe(0);
    expect(node?.thumbnail_generation_short_id).toBeNull();
  });

  it('truncates raw_instruction to the first 60 characters', async () => {
    const longInstruction = 'x'.repeat(120);
    const batch = await createBatch({ raw_instruction: longInstruction });
    const res = await getJson<{ nodes: GraphNode[] }>('/api/v1/graph');
    const node = res.body.nodes.find((n) => n.id === batch.body.id);
    expect(node?.raw_instruction).toBe(longInstruction.slice(0, 60));
  });

  it('aggregates BatchReference edges from Generation to the source Generation\'s Batch', async () => {
    const { generation, batch: sourceBatch } = await createGeneration();
    const targetBatch = await createBatch({
      references: [{ source_generation_id: generation.id, purpose: 'composition', aspect: 'pose' }],
    });

    const res = await getJson<{ edges: GraphEdge[] }>('/api/v1/graph');
    const refEdges = res.body.edges.filter((e) => e.type === 'reference');
    const edge = refEdges.find(
      (e) => e.source_batch_id === sourceBatch.id && e.target_batch_id === targetBatch.body.id,
    );
    expect(edge).toBeDefined();
    expect(edge?.source_generation_short_id).toBe(generation.short_id);
    expect(edge?.aspect).toBe('pose');
    expect(edge?.label).toBe(`pose (${generation.short_id})`);
  });

  it('excludes a reference edge whose source and target batch are the same', async () => {
    const { generation, batch } = await createGeneration();
    await postJson(`/api/v1/batches/${batch.id}/references`, {
      source_generation_id: generation.id,
      aspect: 'self',
    });

    const res = await getJson<{ edges: GraphEdge[] }>('/api/v1/graph');
    const selfLoop = res.body.edges.filter(
      (e) => e.type === 'reference' && e.source_batch_id === batch.id && e.target_batch_id === batch.id,
    );
    expect(selfLoop).toHaveLength(0);
  });

  it('records a BatchRelation as a distinct "relation" edge, separate from references', async () => {
    const source = await createBatch();
    const target = await createBatch();
    await postJson(`/api/v1/batches/${target.body.id}/relations`, {
      source_batch_id: source.body.id,
      type: 'refinement',
      actor: 'human',
    });

    const res = await getJson<{ edges: GraphEdge[] }>('/api/v1/graph');
    const edge = res.body.edges.find(
      (e) => e.type === 'relation' && e.source_batch_id === source.body.id && e.target_batch_id === target.body.id,
    );
    expect(edge).toBeDefined();
    expect(edge?.relation_type).toBe('refinement');
    expect(edge?.actor).toBe('human');
    expect(edge?.label).toBe('refinement / human');
  });

  it('records a StoryRelation as a distinct "story" edge, separate from reference/relation edges', async () => {
    const story = await postJson<{ id: string }>('/api/v1/stories', {
      name: `graph-story-${crypto.randomUUID().slice(0, 8)}`,
    });
    const b1 = await createBatch();
    const b2 = await createBatch();
    await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
      label: 'move to the beach',
    });

    const res = await getJson<{ edges: GraphEdge[] }>('/api/v1/graph');
    const edge = res.body.edges.find(
      (e) => e.type === 'story' && e.source_batch_id === b1.body.id && e.target_batch_id === b2.body.id,
    );
    expect(edge).toBeDefined();
    expect(edge?.story_id).toBe(story.body.id);
    expect(edge?.label).toContain('move to the beach');
  });

  it('returns a batch\'s generations array, ascending by created_at, with short_id/rating/bookmark per entry', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    const g1 = await ingestGeneration(job.body.id, {
      seed: 1,
      original_filename: 'multi-1.png',
      comfy_output_index: 0,
    });
    const g2 = await ingestGeneration(job.body.id, {
      seed: 2,
      original_filename: 'multi-2.png',
      comfy_output_index: 1,
    });
    const g3 = await ingestGeneration(job.body.id, {
      seed: 3,
      original_filename: 'multi-3.png',
      comfy_output_index: 2,
    });

    const res = await getJson<{ nodes: GraphNode[] }>('/api/v1/graph');
    const node = res.body.nodes.find((n) => n.id === batch.body.id);
    expect(node).toBeDefined();
    expect(node?.generations).toHaveLength(3);
    expect(node?.generations.map((g) => g.short_id)).toEqual([
      g1.body.short_id,
      g2.body.short_id,
      g3.body.short_id,
    ]);
    for (const g of node?.generations ?? []) {
      expect(g.rating).toBeNull();
      expect(g.bookmark).toBe(false);
    }
  });

  it('caps generations at 9 even when a batch has more than 9 generations', async () => {
    const batch = await createBatch();
    const job = await createJob(batch.body.id);
    for (let i = 0; i < 10; i += 1) {
      const result = await ingestGeneration(job.body.id, {
        seed: i,
        original_filename: `overflow-${i}.png`,
        comfy_output_index: i,
      });
      expect(result.status).toBe(201);
    }

    const res = await getJson<{ nodes: GraphNode[] }>('/api/v1/graph');
    const node = res.body.nodes.find((n) => n.id === batch.body.id);
    expect(node).toBeDefined();
    expect(node?.generation_count).toBe(10);
    expect(node?.generations).toHaveLength(9);
  });

  it('surfaces a generation\'s rating and bookmark in its generations[] entry', async () => {
    const { batch, generation } = await createGeneration();
    await postJson(`/api/v1/generations/${generation.id}/rating`, { rating: 'good' }, 'PUT');
    await postJson(`/api/v1/generations/${generation.id}/bookmark`, undefined, 'PUT');

    const res = await getJson<{ nodes: GraphNode[] }>('/api/v1/graph');
    const node = res.body.nodes.find((n) => n.id === batch.id);
    const entry = node?.generations.find((g) => g.short_id === generation.short_id);
    expect(entry).toBeDefined();
    expect(entry?.rating).toBe('good');
    expect(entry?.bookmark).toBe(true);
  });
});
