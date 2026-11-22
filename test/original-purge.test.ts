import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, clearRequests, createGeneration, makeSolidPng, mcpToolCall, req } from './helpers';
import { generationCutoutPreviewR2Key, generationPreviewR2Key } from '../src/lib/generation-preview';
import { findPurgeCandidates, ORIGINAL_RETENTION_DAYS, purgeUnneededOriginals } from '../src/lib/original-purge';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const STALE = new Date(NOW - (ORIGINAL_RETENTION_DAYS + 1) * DAY_MS).toISOString();
const RECENT = new Date(NOW - (ORIGINAL_RETENTION_DAYS - 1) * DAY_MS).toISOString();

interface Node {
  id: string;
  short_id: string;
  originalKey: string;
}

/** An ingested Generation with a decodable original, created `createdAt`, optionally refining `parent`. */
async function node(opts: { parent?: Node; createdAt?: string; rating?: string } = {}): Promise<Node> {
  const { generation } = await createGeneration();
  const originalKey = `generations/${generation.id}/original.png`;
  await env.IMAGES.put(originalKey, await makeSolidPng(64, 64, [10, 20, 30]));
  await env.DB.prepare('UPDATE generations SET created_at = ?, refines_generation_id = ?, rating = ? WHERE id = ?')
    .bind(opts.createdAt ?? STALE, opts.parent?.id ?? null, opts.rating ?? null, generation.id)
    .run();
  return { id: generation.id, short_id: generation.short_id, originalKey };
}

async function candidates(): Promise<string[]> {
  return (await findPurgeCandidates(env.DB, NOW, 1000)).map((c) => c.id);
}

async function addAsset(generationId: string, role: string): Promise<string> {
  const form = new FormData();
  form.set('metadata', JSON.stringify({ role }));
  form.set('file', new File([await makeSolidPng(32, 32, [200, 0, 0])], `${role}.png`, { type: 'image/png' }));
  const res = await req(`/api/v1/generations/${generationId}/assets`, { method: 'POST', body: form });
  expect(res.status).toBe(201);
  const row = await env.DB.prepare('SELECT r2_object_key FROM generation_assets WHERE generation_id = ? AND role = ?')
    .bind(generationId, role)
    .first<{ r2_object_key: string }>();
  return row!.r2_object_key;
}

beforeEach(async () => {
  await clearGenerationData();
  await clearRequests();
});

describe('which Generations the purge picks', () => {
  it('picks unrated and bad leftovers once their whole tree has been idle for the retention period', async () => {
    const unrated = await node();
    const bad = await node({ rating: 'bad' });
    const recent = await node({ createdAt: RECENT });
    expect((await candidates()).sort()).toEqual([unrated.id, bad.id].sort());
    expect(await candidates()).not.toContain(recent.id);
  });

  it('keeps good, neutral, bookmarked and published Generations', async () => {
    const good = await node({ rating: 'good' });
    const neutral = await node({ rating: 'neutral' });
    const bookmarked = await node();
    await env.DB.prepare('UPDATE generations SET bookmark = 1 WHERE id = ?').bind(bookmarked.id).run();
    const published = await node();
    const publish = await req(`/api/v1/generations/${published.id}/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'x', url: 'https://x.com/example/status/1' }),
    });
    expect(publish.status).toBe(201);

    const picked = await candidates();
    for (const kept of [good, neutral, bookmarked, published]) expect(picked).not.toContain(kept.id);
  });

  it('keeps every ancestor of a valued picture and purges its abandoned branches', async () => {
    const root = await node();
    const redrawn = await node({ parent: root });
    const delivered = await node({ parent: redrawn, rating: 'good' });
    const abandoned = await node({ parent: root });

    const picked = await candidates();
    for (const kept of [root, redrawn, delivered]) expect(picked).not.toContain(kept.id);
    expect(picked).toContain(abandoned.id);
  });

  it('purges a whole abandoned tree, root included', async () => {
    const root = await node();
    const child = await node({ parent: root });
    expect((await candidates()).sort()).toEqual([root.id, child.id].sort());
  });

  it('leaves a tree alone while any of it is recent', async () => {
    const root = await node();
    await node({ parent: root, createdAt: RECENT });
    expect(await candidates()).not.toContain(root.id);
  });

  it('leaves a tree alone while its workbench was touched recently', async () => {
    const root = await node();
    await env.DB.prepare(`INSERT INTO workbenches (id, root_generation_id, picks_json, created_at, updated_at) VALUES (?, ?, '{}', ?, ?)`)
      .bind(crypto.randomUUID(), root.id, STALE, RECENT)
      .run();
    expect(await candidates()).not.toContain(root.id);
  });

  it.each([
    ['payload.generation_id', (n: Node) => ({ kind: 'deliver', payload: { generation_id: n.short_id }, reroll: null })],
    ['payload.options.photo', (n: Node) => ({ kind: 'stage', payload: { generation_id: crypto.randomUUID(), options: { photo: n.short_id } }, reroll: null })],
    ['payload.references[].generation_id', (n: Node) => ({ kind: 'generate', payload: { references: [{ generation_id: n.id, purpose: 'derive' }] }, reroll: null })],
    ['reroll_of_generation_id', (n: Node) => ({ kind: 'generate', payload: {}, reroll: n.id })],
  ])('leaves a tree alone while a queued request reads one of its pictures via %s', async (_label, build) => {
    const root = await node();
    const child = await node({ parent: root });
    const { kind, payload, reroll } = build(child);
    await env.DB.prepare(`INSERT INTO requests (id, short_id, kind, status, payload_json, payload_hash, idempotency_key, created_by, created_at, updated_at, reroll_of_generation_id)
      VALUES (?, ?, ?, 'queued', ?, 'h', ?, 'gui', ?, ?, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID().slice(0, 8), kind, JSON.stringify(payload), crypto.randomUUID(), RECENT, RECENT, reroll)
      .run();
    const picked = await candidates();
    expect(picked).not.toContain(root.id);
    expect(picked).not.toContain(child.id);
  });

  it('keeps imported photos', async () => {
    const { generation } = await createGeneration({
      requestOverrides: { kind: 'import', status: 'done', parameters: { kind: 'photo' }, idempotency_key: crypto.randomUUID() },
    });
    await env.DB.prepare('UPDATE generations SET created_at = ? WHERE id = ?').bind(STALE, generation.id).run();
    expect(await candidates()).not.toContain(generation.id);
  });

  it('keeps pinned pose references, superseded pins included', async () => {
    const pinned = await node();
    await env.DB.prepare(
      `INSERT INTO preset_references (id, recipe, kind, name, generation_id, source_generation_id, seed, created_by, created_at, superseded_at)
       VALUES (?, 'r', 'pose', 'p', ?, ?, 1, 'test', ?, ?)`,
    )
      .bind(crypto.randomUUID(), pinned.id, pinned.id, STALE, STALE)
      .run();
    expect(await candidates()).not.toContain(pinned.id);
  });
});

describe('purgeUnneededOriginals', () => {
  it('deletes the original and assets, keeps the row and a preview, and blocks redo with 409', async () => {
    const target = await node();
    const maskKey = await addAsset(target.id, 'mask');

    const result = await purgeUnneededOriginals(env, NOW);
    expect(result).toEqual({ purged: 1, skipped: 0 });

    expect(await env.IMAGES.head(target.originalKey)).toBeNull();
    expect(await env.IMAGES.head(maskKey)).toBeNull();
    expect(await env.IMAGES.head(generationPreviewR2Key(target.id))).not.toBeNull();
    const row = await env.DB.prepare('SELECT original_purged_at FROM generations WHERE id = ?').bind(target.id).first<{ original_purged_at: string | null }>();
    expect(row?.original_purged_at).not.toBeNull();
    const assets = await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_assets WHERE generation_id = ?').bind(target.id).first<{ n: number }>();
    expect(assets?.n).toBe(0);

    expect((await req(`/g/${target.short_id}/preview`)).status).toBe(200);
    expect((await req(`/g/${target.short_id}/image`)).status).toBe(410);
    expect(await candidates()).not.toContain(target.id);
  });

  it('moves a cutout preview to preview.webp so the transparent picture stays the thumbnail', async () => {
    const target = await node();
    await addAsset(target.id, 'cutout');

    await purgeUnneededOriginals(env, NOW);

    expect(await env.IMAGES.head(generationCutoutPreviewR2Key(target.id))).toBeNull();
    expect(await env.IMAGES.head(generationPreviewR2Key(target.id))).not.toBeNull();
    expect((await req(`/g/${target.short_id}/preview`)).status).toBe(200);
    const { isError } = await mcpToolCall('get_generation_image', { short_id: target.short_id });
    expect(isError).toBe(false);
  });

  it('respects the batch limit', async () => {
    await node();
    await node();
    expect(await purgeUnneededOriginals(env, NOW, 1)).toEqual({ purged: 1, skipped: 0 });
    expect(await candidates()).toHaveLength(1);
  });
});
