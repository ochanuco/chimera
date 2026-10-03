import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getExperimentRunFamily } from '../src/lib/experiments';
import { getGenerationFamily } from '../src/lib/generation-family';
import { getGenerationByIdOrShortId } from '../src/lib/db';
import { createRequest, createGeneration, getJson, postJson } from './helpers';

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function familyOf(generationId: string) {
  const generation = (await getGenerationByIdOrShortId(env.DB, generationId))!;
  const experimentRun = generation.request_id ? await getExperimentRunFamily(env.DB, generation.request_id) : null;
  return { generation, family: await getGenerationFamily(env.DB, generation, experimentRun) };
}

describe('Generation family: 素材参照 (request_references)', () => {
  it('lists the Generation referenced by this Generation\'s Request as a parent, and the consumer as a child', async () => {
    const { generation: source } = await createGeneration();
    const { generation: consumer, request: consumerRequest } = await createGeneration({
      requestOverrides: { references: [{ source_generation_id: source.id, purpose: 'composition', aspect: 'pose' }] },
    });

    const parent = await familyOf(consumer.id);
    expect(parent.family.parents).toHaveLength(1);
    expect(parent.family.parents[0]).toMatchObject({
      kind: 'reference',
      href: `/g/${source.short_id}`,
      detail: 'purpose: composition / aspect: pose',
    });
    expect(parent.family.parents[0]!.caption).toBeUndefined();

    const child = await familyOf(source.id);
    expect(child.family.children).toHaveLength(1);
    expect(child.family.children[0]).toMatchObject({
      kind: 'reference',
      href: `/g/${consumer.short_id}`,
      caption: 'via request',
      detail: 'purpose: composition / aspect: pose',
    });
    expect(consumerRequest.id).toBeTruthy();
  });

  it('skips a consumer Request that has no Generation yet', async () => {
    const { generation: source } = await createGeneration();
    await createRequest({ references: [{ source_generation_id: source.id }] });

    const { family } = await familyOf(source.id);
    expect(family.children).toEqual([]);
  });

  it('is empty when nothing is related', async () => {
    const { generation } = await createGeneration();
    const { family } = await familyOf(generation.id);
    expect(family).toEqual({ parents: [], children: [], siblings: [] });
  });
});

describe('Generation family: 仕上げ元 (refines_generation_id)', () => {
  it('shows the source as a Refinement parent and the refined Generation as a Refinement child, without a retry relation family', async () => {
    const raw = await createGeneration();
    const refined = await createGeneration({
      jobOverrides: { source_generation_id: raw.generation.id },
    });

    const parent = await familyOf(refined.generation.id);
    expect(parent.family.parents).toHaveLength(1);
    expect(parent.family.parents[0]).toMatchObject({ kind: 'refinement', href: `/g/${raw.generation.short_id}` });

    const child = await familyOf(raw.generation.id);
    expect(child.family.children).toHaveLength(1);
    expect(child.family.children[0]).toMatchObject({ kind: 'refinement', href: `/g/${refined.generation.short_id}` });
  });
});

describe('Experiment run family (request based)', () => {
  it('reports parent/children/siblings across 3 runs by their result Requests, and null outside any experiment', async () => {
    const exp = await postJson<{ id: string }>('/api/v1/experiments', { name: uniqueName('exp') });
    const run1 = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${exp.body.id}/runs`, {});
    const run2 = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${exp.body.id}/runs`, {
      parent_run_id: run1.body.id,
    });
    const run3 = await postJson<{ id: string; run_index: number }>(`/api/v1/experiments/${exp.body.id}/runs`, {});
    const { request: request1 } = await createGeneration({ requestOverrides: { run_id: run1.body.id } });
    const { request: request2 } = await createGeneration({ requestOverrides: { run_id: run2.body.id } });
    const { request: request3 } = await createGeneration({ requestOverrides: { run_id: run3.body.id } });
    const { request: unrelatedRequest } = await createGeneration();

    const family1 = await getExperimentRunFamily(env.DB, request1.id);
    expect(family1).toMatchObject({
      run: { id: run1.body.id, run_index: 1 },
      parent: null,
      children: [{ run_id: run2.body.id, run_index: 2, request_id: request2.id }],
      siblings: [{ run_id: run3.body.id, run_index: 3, request_id: request3.id }],
    });

    const family2 = await getExperimentRunFamily(env.DB, request2.id);
    expect(family2).toMatchObject({
      run: { id: run2.body.id, run_index: 2 },
      parent: { run_id: run1.body.id, run_index: 1, request_id: request1.id },
      children: [],
      siblings: [{ run_id: run3.body.id, run_index: 3, request_id: request3.id }],
    });

    const family3 = await getExperimentRunFamily(env.DB, request3.id);
    expect(family3!.siblings.map((s) => s.run_id).sort()).toEqual([run1.body.id, run2.body.id].sort());

    expect(await getExperimentRunFamily(env.DB, unrelatedRequest.id)).toBeNull();
  });
});

describe('Generation detail: references / used_by (request ids)', () => {
  it('lists Requests that used this Generation as reference material', async () => {
    const { generation } = await createGeneration();
    const consumer = await createRequest({
      references: [{ source_generation_id: generation.id, purpose: 'composition', aspect: 'outfit' }],
    });

    const detail = await getJson<{
      references: { target_request_id: string; purpose: string | null }[];
      used_by: { request_id: string; purpose: string | null; aspect: string | null }[];
    }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.used_by).toHaveLength(1);
    expect(detail.body.used_by[0]).toMatchObject({ request_id: consumer.body.id, purpose: 'composition', aspect: 'outfit' });
    expect(detail.body.used_by[0]).not.toHaveProperty('batch_id');
    expect(detail.body.references[0]).toMatchObject({ target_request_id: consumer.body.id, purpose: 'composition' });
    expect(detail.body.references[0]).not.toHaveProperty('target_batch_id');
  });

  it('is also present on the /context endpoint and empty when unused', async () => {
    const { generation } = await createGeneration();
    const context = await getJson<{ used_by: unknown[]; references: unknown[] }>(
      `/api/v1/generations/${generation.id}/context`,
    );
    expect(context.body.used_by).toEqual([]);
    expect(context.body.references).toEqual([]);
  });
});
