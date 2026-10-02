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

describe('Batch refines_generation_id', () => {
  it('is set on create when a refinement relation pairs with a rebuild reference to the source batch\'s generation', async () => {
    const { batch: source, generation: sourceGen } = await createGeneration();

    const created = await postJson<{ refines_generation_id: string | null }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      refinement: { source_batch_id: source.id, actor: 'claude', reason: 'finalize' },
      references: [{ source_generation_id: sourceGen.id, purpose: 'rebuild' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.refines_generation_id).toBe(sourceGen.id);
  });

  it('stays null with only a refinement relation (no rebuild reference)', async () => {
    const source = await createBatch();

    const created = await postJson<{ refines_generation_id: string | null }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      refinement: { source_batch_id: source.body.id, actor: 'claude', reason: 'finalize' },
    });
    expect(created.status).toBe(201);
    expect(created.body.refines_generation_id).toBeNull();
  });

  it("stays null when the rebuild reference points to a generation outside the relation's source batch", async () => {
    const source = await createBatch();
    const { generation: unrelatedGen } = await createGeneration();

    const created = await postJson<{ refines_generation_id: string | null }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      refinement: { source_batch_id: source.body.id, actor: 'claude', reason: 'finalize' },
      references: [{ source_generation_id: unrelatedGen.id, purpose: 'rebuild' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.refines_generation_id).toBeNull();
  });

  it('is recomputed after POST /batches/{id}/references adds the matching rebuild reference', async () => {
    const { batch: source, generation: sourceGen } = await createGeneration();
    const target = await postJson<{ id: string; refines_generation_id: string | null }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      refinement: { source_batch_id: source.id, actor: 'claude', reason: 'finalize' },
    });
    expect(target.body.refines_generation_id).toBeNull();

    await postJson(`/api/v1/batches/${target.body.id}/references`, {
      source_generation_id: sourceGen.id,
      purpose: 'rebuild',
    });

    const detail = await getJson<{ refines_generation_id: string | null }>(`/api/v1/batches/${target.body.id}`);
    expect(detail.body.refines_generation_id).toBe(sourceGen.id);
  });

  it('is recomputed after POST /batches/{target}/relations adds the matching refinement relation', async () => {
    const { batch: source, generation: sourceGen } = await createGeneration();
    const target = await postJson<{ id: string; refines_generation_id: string | null }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      references: [{ source_generation_id: sourceGen.id, purpose: 'rebuild' }],
    });
    expect(target.body.refines_generation_id).toBeNull();

    await postJson(`/api/v1/batches/${target.body.id}/relations`, {
      source_batch_id: source.id,
      type: 'refinement',
      actor: 'claude',
    });

    const detail = await getJson<{ refines_generation_id: string | null }>(`/api/v1/batches/${target.body.id}`);
    expect(detail.body.refines_generation_id).toBe(sourceGen.id);
  });
});

describe('Story and graph are gone', () => {
  it('serves no /stories or /graph routes', async () => {
    expect((await getJson('/api/v1/stories')).status).toBe(404);
    expect((await postJson('/api/v1/stories', { name: 'x' })).status).toBe(404);
    expect((await getJson('/api/v1/graph')).status).toBe(404);
  });

  it('accepts and ignores a story key on batch create, whatever its shape', async () => {
    const first = await postJson<{ id: string }>('/api/v1/batches', {
      idempotency_key: crypto.randomUUID(),
      story: {
        story_id: 'does-not-exist',
        previous_batch_ids: ['also-missing'],
        transition: { label: 'continue' },
      },
    });
    expect(first.status).toBe(201);

    const nullStory = await postJson('/api/v1/batches', { idempotency_key: crypto.randomUUID(), story: null });
    expect(nullStory.status).toBe(201);
  });

  it('keeps accepting a non-refinement relation type without deriving anything', async () => {
    const a = await createBatch();
    const b = await createBatch();
    const res = await postJson(`/api/v1/batches/${b.body.id}/relations`, {
      source_batch_id: a.body.id,
      type: 'retry',
      actor: 'claude',
    });
    expect(res.status).toBe(201);
  });
});
