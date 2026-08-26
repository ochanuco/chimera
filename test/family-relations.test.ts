import { describe, expect, it } from 'vitest';
import { createBatch, createGeneration, getJson, postJson } from './helpers';

describe('Batch detail: reference_children', () => {
  it('lists Batches that used one of this Batch\'s Generations as reference material', async () => {
    const { batch: sourceBatch, generation } = await createGeneration();
    const consumer = await createBatch();

    const res = await postJson(`/api/v1/batches/${consumer.body.id}/references`, {
      source_generation_id: generation.id,
      purpose: 'composition',
      aspect: 'pose',
    });
    expect(res.status).toBe(201);

    const detail = await getJson<{
      reference_children: { batch_id: string; source_generation_id: string; purpose: string | null; aspect: string | null }[];
    }>(`/api/v1/batches/${sourceBatch.id}`);
    expect(detail.body.reference_children).toHaveLength(1);
    expect(detail.body.reference_children[0]).toMatchObject({
      batch_id: consumer.body.id,
      source_generation_id: generation.id,
      purpose: 'composition',
      aspect: 'pose',
    });
  });

  it('is empty when nothing references this Batch\'s Generations', async () => {
    const { batch } = await createGeneration();
    const detail = await getJson<{ reference_children: unknown[] }>(`/api/v1/batches/${batch.id}`);
    expect(detail.body.reference_children).toEqual([]);
  });
});

describe('Batch detail: siblings', () => {
  it('reports siblings via a shared reference source Generation', async () => {
    const { generation } = await createGeneration();
    const b1 = await createBatch();
    const b2 = await createBatch();

    await postJson(`/api/v1/batches/${b1.body.id}/references`, { source_generation_id: generation.id });
    await postJson(`/api/v1/batches/${b2.body.id}/references`, { source_generation_id: generation.id });

    const detail1 = await getJson<{ siblings: { batch_id: string; via: string; shared_id: string }[] }>(
      `/api/v1/batches/${b1.body.id}`,
    );
    expect(detail1.body.siblings).toHaveLength(1);
    expect(detail1.body.siblings[0]).toMatchObject({ batch_id: b2.body.id, via: 'reference', shared_id: generation.id });

    const detail2 = await getJson<{ siblings: { batch_id: string; via: string; shared_id: string }[] }>(
      `/api/v1/batches/${b2.body.id}`,
    );
    expect(detail2.body.siblings).toHaveLength(1);
    expect(detail2.body.siblings[0]).toMatchObject({ batch_id: b1.body.id, via: 'reference', shared_id: generation.id });
  });

  it('reports siblings via a shared refinement source Batch, and excludes self', async () => {
    const parent = await createBatch();
    const r1 = await createBatch();
    const r2 = await createBatch();

    await postJson(`/api/v1/batches/${r1.body.id}/relations`, {
      source_batch_id: parent.body.id,
      type: 'refinement',
      actor: 'human',
    });
    await postJson(`/api/v1/batches/${r2.body.id}/relations`, {
      source_batch_id: parent.body.id,
      type: 'refinement',
      actor: 'human',
    });

    const detail = await getJson<{ siblings: { batch_id: string; via: string; shared_id: string }[] }>(
      `/api/v1/batches/${r1.body.id}`,
    );
    expect(detail.body.siblings).toHaveLength(1);
    expect(detail.body.siblings[0]).toMatchObject({ batch_id: r2.body.id, via: 'refinement', shared_id: parent.body.id });
    expect(detail.body.siblings.some((s) => s.batch_id === r1.body.id)).toBe(false);
  });

  it('does not duplicate a sibling reached through multiple shared references', async () => {
    const { generation: g1 } = await createGeneration();
    const { generation: g2 } = await createGeneration();
    const b1 = await createBatch();
    const b2 = await createBatch();

    await postJson(`/api/v1/batches/${b1.body.id}/references`, { source_generation_id: g1.id });
    await postJson(`/api/v1/batches/${b1.body.id}/references`, { source_generation_id: g2.id });
    await postJson(`/api/v1/batches/${b2.body.id}/references`, { source_generation_id: g1.id });
    await postJson(`/api/v1/batches/${b2.body.id}/references`, { source_generation_id: g2.id });

    const detail = await getJson<{ siblings: { batch_id: string; via: string; shared_id: string }[] }>(
      `/api/v1/batches/${b1.body.id}`,
    );
    // Shares both g1 and g2 with b2, but each distinct (via, shared_id) pair is its own row.
    expect(detail.body.siblings.filter((s) => s.batch_id === b2.body.id)).toHaveLength(2);
  });
});

describe('Generation detail: used_by', () => {
  it('lists Batches that used this Generation as reference material', async () => {
    const { generation } = await createGeneration();
    const consumer = await createBatch();

    await postJson(`/api/v1/batches/${consumer.body.id}/references`, {
      source_generation_id: generation.id,
      purpose: 'composition',
      aspect: 'outfit',
    });

    const detail = await getJson<{
      used_by: { batch_id: string; purpose: string | null; aspect: string | null }[];
    }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.used_by).toHaveLength(1);
    expect(detail.body.used_by[0]).toMatchObject({ batch_id: consumer.body.id, purpose: 'composition', aspect: 'outfit' });
  });

  it('is also present on the /context endpoint and empty when unused', async () => {
    const { generation } = await createGeneration();
    const detail = await getJson<{ used_by: unknown[] }>(`/api/v1/generations/${generation.id}/context`);
    expect(detail.body.used_by).toEqual([]);
  });
});
