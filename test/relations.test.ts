import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, getJson, postJson } from './helpers';

describe('Batch references', () => {
  it('POST /batches/{id}/references links a source generation to a target batch', async () => {
    const { generation } = await createGeneration();
    const target = await createBatch();

    const res = await postJson(`/api/v1/batches/${target.body.id}/references`, {
      source_generation_id: generation.id,
      purpose: 'composition',
      aspect: 'pose',
      instruction: 'keep the pose',
    });
    expect(res.status).toBe(201);

    const detail = await getJson<{ references: { source_generation_id: string; aspect: string }[] }>(
      `/api/v1/batches/${target.body.id}`,
    );
    expect(detail.body.references).toHaveLength(1);
    expect(detail.body.references[0]).toMatchObject({ source_generation_id: generation.id, aspect: 'pose' });
  });

  it('nested references on batch create are validated and persisted', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();

    const created = await postJson<{ id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      references: [
        { source_generation_id: g1.id, purpose: 'composition', aspect: 'pose' },
        { source_generation_id: g2.short_id, purpose: 'composition', aspect: 'outfit' },
      ],
    });
    expect(created.status).toBe(201);

    const detail = await getJson<{ references: unknown[] }>(`/api/v1/batches/${created.body.id}`);
    expect(detail.body.references).toHaveLength(2);
  });

  it('404s when the referenced generation does not exist', async () => {
    const target = await createBatch();
    const res = await postJson(`/api/v1/batches/${target.body.id}/references`, {
      source_generation_id: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });
});

describe('Batch relations', () => {
  it('POST /batches/{target}/relations records a refinement relation', async () => {
    const source = await createBatch();
    const target = await createBatch();

    const res = await postJson(`/api/v1/batches/${target.body.id}/relations`, {
      source_batch_id: source.body.id,
      type: 'refinement',
      actor: 'human',
      reason: 'hands were bad',
    });
    expect(res.status).toBe(201);

    const targetDetail = await getJson<{ relations: { incoming: { source_batch_id: string; actor: string }[] } }>(
      `/api/v1/batches/${target.body.id}`,
    );
    expect(targetDetail.body.relations.incoming).toHaveLength(1);
    expect(targetDetail.body.relations.incoming[0]).toMatchObject({ source_batch_id: source.body.id, actor: 'human' });

    const sourceDetail = await getJson<{ relations: { outgoing: { target_batch_id: string }[] } }>(
      `/api/v1/batches/${source.body.id}`,
    );
    expect(sourceDetail.body.relations.outgoing).toHaveLength(1);
    expect(sourceDetail.body.relations.outgoing[0]).toMatchObject({ target_batch_id: target.body.id });
  });

  it('nested refinement on batch create records the relation', async () => {
    const source = await createBatch();

    const created = await postJson<{ id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      refinement: { source_batch_id: source.body.id, actor: 'claude', reason: 'auto retry' },
    });
    expect(created.status).toBe(201);

    const detail = await getJson<{ relations: { incoming: { actor: string }[] } }>(
      `/api/v1/batches/${created.body.id}`,
    );
    expect(detail.body.relations.incoming[0]?.actor).toBe('claude');
  });
});

describe('Story relations', () => {
  it('creates a story, links batches, and lists them on the story', async () => {
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: 'summer arc' });
    const b1 = await createBatch();
    const b2 = await createBatch();

    const rel = await postJson(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
      label: 'move to the beach',
      description: 'evening beach scene',
    });
    expect(rel.status).toBe(201);

    const detail = await getJson<{
      relations: { source_batch_id: string; target_batch_id: string; label: string }[];
      batches: { id: string }[];
    }>(`/api/v1/stories/${story.body.id}`);
    expect(detail.body.relations).toHaveLength(1);
    expect(detail.body.relations[0]).toMatchObject({
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
      label: 'move to the beach',
    });
    expect(detail.body.batches.map((b) => b.id).sort()).toEqual([b1.body.id, b2.body.id].sort());
  });

  it('nested story on batch create links previous batches via StoryRelation', async () => {
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: 'branching arc' });
    const prev = await createBatch();

    const created = await postJson<{ id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      story: {
        story_id: story.body.id,
        previous_batch_ids: [prev.body.id],
        transition: { label: 'continue', description: 'next scene' },
      },
    });
    expect(created.status).toBe(201);

    const storyDetail = await getJson<{ relations: { source_batch_id: string; target_batch_id: string }[] }>(
      `/api/v1/stories/${story.body.id}`,
    );
    expect(storyDetail.body.relations).toHaveLength(1);
    expect(storyDetail.body.relations[0]).toMatchObject({
      source_batch_id: prev.body.id,
      target_batch_id: created.body.id,
    });
  });

  it('PATCH updates relation label/description', async () => {
    const story = await postJson<{ id: string }>('/api/v1/stories', { name: 'edit arc' });
    const b1 = await createBatch();
    const b2 = await createBatch();
    const rel = await postJson<{ id: string }>(`/api/v1/stories/${story.body.id}/relations`, {
      source_batch_id: b1.body.id,
      target_batch_id: b2.body.id,
      label: 'first label',
    });

    const patched = await postJson<{ label: string }>(
      `/api/v1/stories/${story.body.id}/relations/${rel.body.id}`,
      { label: 'updated label' },
      'PATCH',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.label).toBe('updated label');
  });
});
