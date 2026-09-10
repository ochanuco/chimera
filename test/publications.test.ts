import { env } from 'cloudflare:test';
import { afterAll, describe, expect, it } from 'vitest';
import { createGeneration, del, getJson, postJson, req } from './helpers';

interface Publication {
  id: string;
  generation_id: string;
  url: string | null;
  published_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Publication CRUD', () => {
  it('creates a publication with a url, lists newest first, and updates/deletes it', async () => {
    const { generation } = await createGeneration();

    const first = await postJson<Publication>(`/api/v1/generations/${generation.id}/publications`, {
      url: 'https://x.com/example/status/1',
    });
    expect(first.status).toBe(201);
    expect(first.body.url).toBe('https://x.com/example/status/1');
    expect(first.body.created_by).toBe('gui');
    expect(UUID_RE.test(first.body.id)).toBe(true);

    const second = await postJson<Publication>(`/api/v1/generations/${generation.id}/publications`, { url: null });
    expect(second.status).toBe(201);

    const list = await getJson<{ items: Publication[] }>(`/api/v1/generations/${generation.id}/publications`);
    expect(list.body.items.map((p) => p.id)).toEqual([second.body.id, first.body.id]);

    const patched = await postJson<Publication>(`/api/v1/publications/${second.body.id}`, { url: 'https://x.com/example/status/2' }, 'PATCH');
    expect(patched.status).toBe(200);
    expect(patched.body.url).toBe('https://x.com/example/status/2');

    const cleared = await postJson<Publication>(`/api/v1/publications/${second.body.id}`, { url: null }, 'PATCH');
    expect(cleared.status).toBe(200);
    expect(cleared.body.url).toBeNull();

    const deleted = await del(`/api/v1/publications/${first.body.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await getJson<{ items: Publication[] }>(`/api/v1/generations/${generation.id}/publications`);
    expect(afterDelete.body.items.map((p) => p.id)).toEqual([second.body.id]);
  });

  it('creates a publication without a url', async () => {
    const { generation } = await createGeneration();
    const res = await postJson<Publication>(`/api/v1/generations/${generation.id}/publications`, {});
    expect(res.status).toBe(201);
    expect(res.body.url).toBeNull();
  });

  it('rejects a non-https url', async () => {
    const { generation } = await createGeneration();
    const res = await req(`/api/v1/generations/${generation.id}/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://x.com/example/status/1' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s posting to an unknown generation', async () => {
    const res = await req('/api/v1/generations/does-not-exist/publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('404s PATCH/DELETE on an unknown publication id', async () => {
    const patch = await postJson(`/api/v1/publications/${crypto.randomUUID()}`, { url: null }, 'PATCH');
    expect(patch.status).toBe(404);
    const deleted = await del(`/api/v1/publications/${crypto.randomUUID()}`);
    expect(deleted.status).toBe(404);
  });

  it('is idempotent via idempotency_key: resend returns the same row with 200', async () => {
    const { generation } = await createGeneration();
    const key = crypto.randomUUID();

    const first = await postJson<Publication>(`/api/v1/generations/${generation.id}/publications`, {
      url: 'https://x.com/example/status/3',
      idempotency_key: key,
    });
    expect(first.status).toBe(201);

    const replay = await postJson<Publication>(`/api/v1/generations/${generation.id}/publications`, {
      url: 'https://x.com/example/status/999-different',
      idempotency_key: key,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.url).toBe('https://x.com/example/status/3');

    const list = await getJson<{ items: Publication[] }>(`/api/v1/generations/${generation.id}/publications`);
    expect(list.body.items).toHaveLength(1);
  });
});

describe('Generation Search / detail: published', () => {
  it('published filter and list item field', async () => {
    const { generation: publishedGen } = await createGeneration();
    const { generation: unpublishedGen } = await createGeneration();
    await postJson(`/api/v1/generations/${publishedGen.id}/publications`, {});

    const onlyPublished = await getJson<{ items: { short_id: string; published: boolean }[] }>(
      '/api/v1/generations?published=true&limit=200',
    );
    const publishedIds = onlyPublished.body.items.map((i) => i.short_id);
    expect(publishedIds).toContain(publishedGen.short_id);
    expect(publishedIds).not.toContain(unpublishedGen.short_id);
    expect(onlyPublished.body.items.find((i) => i.short_id === publishedGen.short_id)?.published).toBe(true);

    const onlyUnpublished = await getJson<{ items: { short_id: string; published: boolean }[] }>(
      '/api/v1/generations?published=false&limit=200',
    );
    const unpublishedIds = onlyUnpublished.body.items.map((i) => i.short_id);
    expect(unpublishedIds).toContain(unpublishedGen.short_id);
    expect(unpublishedIds).not.toContain(publishedGen.short_id);
  });

  it('detail includes publications', async () => {
    const { generation } = await createGeneration();
    const created = await postJson<Publication>(`/api/v1/generations/${generation.id}/publications`, {
      url: 'https://x.com/example/status/4',
    });

    const detail = await getJson<{ publications: Publication[] }>(`/api/v1/generations/${generation.id}`);
    expect(detail.body.publications).toHaveLength(1);
    expect(detail.body.publications[0]?.id).toBe(created.body.id);
    expect(detail.body.publications[0]?.url).toBe('https://x.com/example/status/4');
  });
});

describe('tag "publish"', () => {
  // migrations/0021 backfill below inserts its own 'publish' tags row directly and needs the name
  // free beforehand (tags.name is UNIQUE, and D1 state carries across tests in this file).
  afterAll(async () => {
    await env.DB.prepare("DELETE FROM generation_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = 'publish')").run();
    await env.DB.prepare("DELETE FROM tags WHERE name = 'publish'").run();
  });

  it('POST /generations/{id}/tags with name "publish" creates an ordinary Tag, not a Publication', async () => {
    const { generation } = await createGeneration();

    const created = await postJson<{ id: string; name: string }>(`/api/v1/generations/${generation.id}/tags`, {
      name: 'publish',
      created_by: 'claude',
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('publish');

    const context = await getJson<{ tags: string[] }>(`/api/v1/generations/${generation.id}/context`);
    expect(context.body.tags).toEqual(['publish']);

    const publications = await getJson<{ items: Publication[] }>(`/api/v1/generations/${generation.id}/publications`);
    expect(publications.body.items).toHaveLength(0);
  });

  it('GET /generations?tag=publish filters by the tag only, not by Publication', async () => {
    const { generation: tagged } = await createGeneration();
    await postJson(`/api/v1/generations/${tagged.id}/tags`, { name: 'publish' });

    const { generation: publishedOnly } = await createGeneration();
    await postJson(`/api/v1/generations/${publishedOnly.id}/publications`, {});

    const byTag = await getJson<{ items: { short_id: string }[] }>('/api/v1/generations?tag=publish&limit=200');
    const shortIds = byTag.body.items.map((i) => i.short_id);
    expect(shortIds).toContain(tagged.short_id);
    expect(shortIds).not.toContain(publishedOnly.short_id);
  });
});

describe('migrations/0021 backfill (exercised directly: migrations run once per test DB, before any publish tag exists)', () => {
  // これらの3文は migrations/0021_generation_publications.sql の `-- BACKFILL:` 以下と
  // 同一内容を保つこと。マイグレーションは1テストDBにつき一度しか流れないため、ここでは
  // 「移行前の publish タグ付き行」を直接組み立ててから同じ SQL を再実行し、変換結果を検証する。
  // tags.name は UNIQUE なので、両シナリオは (前段が 'publish' 行を消してから) 1つの test 内で
  // 順に走らせる — テスト間で D1 の状態がリセットされないため、'publish' 行を同時に2つ作れない。
  async function runBackfill(): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO generation_publications (id, generation_id, url, published_at, created_by, created_at, updated_at)
       SELECT
         lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
         gt.generation_id, NULL, COALESCE(gt.created_at, g.created_at), 'system', COALESCE(gt.created_at, g.created_at), COALESCE(gt.created_at, g.created_at)
       FROM generation_tags gt JOIN tags t ON t.id = gt.tag_id JOIN generations g ON g.id = gt.generation_id
       WHERE t.name = 'publish'`,
    ).run();
    await env.DB.prepare("DELETE FROM generation_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = 'publish')").run();
    await env.DB.prepare(
      `DELETE FROM tags WHERE name = 'publish'
         AND id NOT IN (SELECT tag_id FROM generation_tags)
         AND id NOT IN (SELECT tag_id FROM batch_tags)
         AND id NOT IN (SELECT tag_id FROM story_tags)
         AND id NOT IN (SELECT tag_id FROM experiment_tags)`,
    ).run();
  }

  it('converts a publish-tagged generation into a Publication, removes the tag when unreferenced, but keeps it when another table still references it', async () => {
    // Phase 1: only generation_tags references the 'publish' tag -> the tag row itself is deleted too.
    const { generation: g1 } = await createGeneration();
    const tag1Id = crypto.randomUUID();
    const linkCreatedAt = '2025-01-02T03:04:05.000Z';
    await env.DB.prepare("INSERT INTO tags (id, name, description, created_at, updated_at) VALUES (?, 'publish', NULL, ?, ?)")
      .bind(tag1Id, linkCreatedAt, linkCreatedAt)
      .run();
    await env.DB.prepare(
      "INSERT INTO generation_tags (id, generation_id, tag_id, created_by, created_at) VALUES (?, ?, ?, 'claude', ?)",
    )
      .bind(crypto.randomUUID(), g1.id, tag1Id, linkCreatedAt)
      .run();

    await runBackfill();

    const publications1 = await getJson<{ items: Publication[] }>(`/api/v1/generations/${g1.id}/publications`);
    expect(publications1.body.items).toHaveLength(1);
    const pub1 = publications1.body.items[0]!;
    expect(pub1.url).toBeNull();
    expect(pub1.created_by).toBe('system');
    expect(pub1.published_at).toBe(linkCreatedAt);
    expect(UUID_RE.test(pub1.id)).toBe(true);

    expect(await env.DB.prepare('SELECT 1 FROM tags WHERE id = ?').bind(tag1Id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM generation_tags WHERE tag_id = ?').bind(tag1Id).first()).toBeNull();

    // Phase 2: a fresh 'publish' tag (the name is free again after phase 1's delete), this time
    // also referenced by batch_tags -> the generation_tags link is still removed, but the tag row survives.
    const { generation: g2 } = await createGeneration();
    const tag2Id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO tags (id, name, description, created_at, updated_at) VALUES (?, 'publish', NULL, ?, ?)")
      .bind(tag2Id, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO generation_tags (id, generation_id, tag_id, created_by, created_at) VALUES (?, ?, ?, 'claude', ?)",
    )
      .bind(crypto.randomUUID(), g2.id, tag2Id, now)
      .run();
    const batch = await postJson<{ id: string }>('/api/v1/batches', { idempotency_key: crypto.randomUUID(), prompt: 'x' });
    await env.DB.prepare("INSERT INTO batch_tags (id, batch_id, tag_id, created_by, created_at) VALUES (?, ?, ?, 'claude', ?)")
      .bind(crypto.randomUUID(), batch.body.id, tag2Id, now)
      .run();

    await runBackfill();

    const publications2 = await getJson<{ items: Publication[] }>(`/api/v1/generations/${g2.id}/publications`);
    expect(publications2.body.items).toHaveLength(1);
    expect(await env.DB.prepare('SELECT 1 FROM tags WHERE id = ?').bind(tag2Id).first()).not.toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM generation_tags WHERE tag_id = ?').bind(tag2Id).first()).toBeNull();
  });
});
