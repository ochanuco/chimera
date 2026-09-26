import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneration, ingestGeneration, makePngWithChunks, req, setJobGraph, textChunkData } from './helpers';
import { recompressRetainedOriginals } from '../src/lib/original-recompress';
import type { GenerationRow } from '../src/types';

const NOW = new Date('2026-09-19T00:00:00.000Z').toISOString();

// original-recompress.ts is disabled unless this var is 'on' (ships disabled, not in wrangler.jsonc).
const RECOMPRESS_ENV = { ...env, ORIGINAL_RECOMPRESS: 'on' };

function daysAgo(days: number): string {
  return new Date(new Date(NOW).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function ageGeneration(id: string, days: number): Promise<void> {
  await env.DB.prepare('UPDATE generations SET created_at = ? WHERE id = ?').bind(daysAgo(days), id).run();
}

/** Rated good, so the purge pass never claims it: past the window it is a kept original. */
async function ageKeptGeneration(id: string, days: number): Promise<void> {
  await env.DB.prepare("UPDATE generations SET created_at = ?, rating = 'good' WHERE id = ?").bind(daysAgo(days), id).run();
}

function originalKey(generationId: string): string {
  return `generations/${generationId}/original.png`;
}

function webpKey(generationId: string): string {
  return `generations/${generationId}/original.webp`;
}

async function generationRow(id: string): Promise<GenerationRow> {
  const row = await env.DB.prepare('SELECT * FROM generations WHERE id = ?').bind(id).first<GenerationRow>();
  if (!row) throw new Error(`generation ${id} not found`);
  return row;
}

/** Diagonal gradient, not a solid fill — a solid color already compresses to near-nothing under
 * PNG's deflate, which would make "WebP is smaller" trivially false regardless of the codec. */
async function makeOpaquePng(size: number): Promise<Uint8Array> {
  return makePngWithChunks(size, size, {
    colorType: 2,
    pixel: (x, y) => [(x * 255) / size, (y * 255) / size, ((x + y) * 255) / (2 * size)].map(Math.round) as [
      number,
      number,
      number,
    ],
  });
}

async function putOriginal(generationId: string, bytes: Uint8Array): Promise<void> {
  await env.IMAGES.put(originalKey(generationId), bytes);
}

beforeEach(async () => {
  // Same reasoning as test/original-purge.test.ts's beforeEach: scans every candidate row, so
  // leftover rows from an earlier test would pollute "oldest first" / global-count assertions.
  await env.DB.batch([
    env.DB.prepare('UPDATE batches SET refines_generation_id = NULL'),
    env.DB.prepare('UPDATE experiments SET base_generation_id = NULL'),
    env.DB.prepare('DELETE FROM generation_assets'),
    env.DB.prepare('DELETE FROM pairwise_judgments'),
    env.DB.prepare('DELETE FROM experiment_promotions'),
    env.DB.prepare('DELETE FROM experiment_runs'),
    env.DB.prepare('DELETE FROM generation_publications'),
    env.DB.prepare('DELETE FROM preset_references'),
    env.DB.prepare('DELETE FROM presets'),
    env.DB.prepare('DELETE FROM batch_references'),
    env.DB.prepare('DELETE FROM requests'),
    env.DB.prepare('DELETE FROM generations'),
    env.DB.prepare('DELETE FROM comfy_jobs'),
    env.DB.prepare('DELETE FROM batches'),
    env.DB.prepare('DELETE FROM experiments'),
  ]);
});

describe('recompressRetainedOriginals', () => {
  it('does nothing when ORIGINAL_RECOMPRESS is not set', async () => {
    const { generation } = await createGeneration();
    await putOriginal(generation.id, await makeOpaquePng(256));
    await ageKeptGeneration(generation.id, 31);

    const result = await recompressRetainedOriginals({ ...env, ORIGINAL_RECOMPRESS: undefined }, NOW, 10);
    expect(result).toEqual({ converted: 0, kept: 0 });
    expect(await env.IMAGES.head(originalKey(generation.id))).not.toBeNull();
    expect((await generationRow(generation.id)).original_recompress_checked_at).toBeNull();
  });

  it('converts an opaque PNG past the retention window to lossless WebP', async () => {
    const { generation } = await createGeneration();
    const pngBytes = await makeOpaquePng(256);
    await putOriginal(generation.id, pngBytes);
    await ageGeneration(generation.id, 31);
    await req(`/api/v1/generations/${generation.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'good' }),
    });

    const result = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(result).toEqual({ converted: 1, kept: 0 });

    expect(await env.IMAGES.head(originalKey(generation.id))).toBeNull();
    const stored = await env.IMAGES.head(webpKey(generation.id));
    expect(stored).not.toBeNull();
    expect(stored!.size).toBeLessThan(pngBytes.byteLength);

    const row = await generationRow(generation.id);
    expect(row.r2_object_key).toBe(webpKey(generation.id));
    expect(row.image_size).toBe(stored!.size);
    expect(row.original_recompress_checked_at).toBe(NOW);

    const imageRes = await req(`/g/${generation.short_id}/image`);
    expect(imageRes.status).toBe(200);
    expect(imageRes.headers.get('Content-Type')).toBe('image/webp');

    const previewRes = await req(`/g/${generation.short_id}/preview`);
    expect(previewRes.status).toBe(200);
  });

  it('leaves a Generation inside the retention window untouched', async () => {
    const { generation } = await createGeneration();
    await putOriginal(generation.id, await makeOpaquePng(256));
    await ageGeneration(generation.id, 29);

    const result = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(result).toEqual({ converted: 0, kept: 0 });
    expect(await env.IMAGES.head(originalKey(generation.id))).not.toBeNull();
  });

  it('leaves an original that is waiting to be purged untouched', async () => {
    const { generation } = await createGeneration();
    await putOriginal(generation.id, await makeOpaquePng(256));
    await ageGeneration(generation.id, 31);

    const result = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(result).toEqual({ converted: 0, kept: 0 });
    expect(await env.IMAGES.head(originalKey(generation.id))).not.toBeNull();
    expect((await generationRow(generation.id)).original_recompress_checked_at).toBeNull();
  });

  it('leaves a purged Generation untouched', async () => {
    const { generation } = await createGeneration();
    await putOriginal(generation.id, await makeOpaquePng(256));
    await ageGeneration(generation.id, 31);
    await env.DB.prepare('UPDATE generations SET original_purged_at = ? WHERE id = ?').bind(NOW, generation.id).run();
    await env.IMAGES.delete(originalKey(generation.id));

    const result = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(result).toEqual({ converted: 0, kept: 0 });
  });

  it('keeps a PNG with transparency as PNG, and does not re-examine it next run', async () => {
    const { generation } = await createGeneration();
    const rgbaBytes = await makePngWithChunks(64, 64, { colorType: 6 });
    await putOriginal(generation.id, rgbaBytes);
    await ageKeptGeneration(generation.id, 31);

    const result = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(result).toEqual({ converted: 0, kept: 1 });
    expect(await env.IMAGES.head(originalKey(generation.id))).not.toBeNull();
    expect((await generationRow(generation.id)).original_recompress_checked_at).toBe(NOW);

    const second = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(second).toEqual({ converted: 0, kept: 0 });
  });

  it('rescues the graph from the PNG prompt chunk before converting, without overwriting an existing graph', async () => {
    const graph = { '1': { class_type: 'KSampler', inputs: { seed: 7 } } };
    const withGraph = await createGeneration();
    const bytesWithGraph = await makePngWithChunks(64, 64, {
      colorType: 2,
      extraChunks: [{ type: 'tEXt', data: textChunkData('prompt', JSON.stringify(graph)) }],
    });
    await putOriginal(withGraph.generation.id, bytesWithGraph);
    await ageKeptGeneration(withGraph.generation.id, 31);
    const existingGraph = { '1': { class_type: 'KSampler', inputs: { seed: 999 } } };
    await setJobGraph(withGraph.job.id, existingGraph);

    const noGraph = await createGeneration();
    const bytesNoGraph = await makePngWithChunks(64, 64, {
      colorType: 2,
      extraChunks: [{ type: 'tEXt', data: textChunkData('prompt', JSON.stringify(graph)) }],
    });
    await putOriginal(noGraph.generation.id, bytesNoGraph);
    await ageKeptGeneration(noGraph.generation.id, 31);

    await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);

    const withGraphJob = await env.DB
      .prepare('SELECT graph FROM comfy_jobs WHERE id = ?')
      .bind(withGraph.job.id)
      .first<{ graph: string | null }>();
    expect(JSON.parse(withGraphJob!.graph!)).toEqual(existingGraph);

    const noGraphJob = await env.DB
      .prepare('SELECT graph, render_facts_json FROM comfy_jobs WHERE id = ?')
      .bind(noGraph.job.id)
      .first<{ graph: string | null; render_facts_json: string | null }>();
    expect(JSON.parse(noGraphJob!.graph!)).toEqual(graph);
    expect(noGraphJob!.render_facts_json).not.toBeNull();
  });

  it('ingest replay after conversion returns 200 and does not recreate original.png', async () => {
    const { generation, job } = await createGeneration();
    await putOriginal(generation.id, await makeOpaquePng(256));
    await ageKeptGeneration(generation.id, 31);

    const result = await recompressRetainedOriginals(RECOMPRESS_ENV, NOW, 10);
    expect(result.converted).toBe(1);

    const replay = await ingestGeneration(job.id, {
      seed: 123,
      original_filename: 'out_00001_.png',
      comfy_output_index: 0,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(generation.id);
    expect(await env.IMAGES.head(originalKey(generation.id))).toBeNull();
    expect(await env.IMAGES.head(webpKey(generation.id))).not.toBeNull();
  });
});
