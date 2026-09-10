-- Publication: 1回分の納品（Xへの投稿）を表す行。1 Generation は複数の Publication を
-- 持てる (docs/domain-model.md#publication)。idempotency_key は POST /api/v1/generations/{id}/publications
-- と MCP record_publication の再送保護用（既存レコードとの対応は src/lib/publications.ts）。
-- created_by は Publication の作成元を表す: 'gui'（GUI の「公開を記録」）、'mcp'
-- （MCP tool record_publication）、'api'（REST 直叩き）、'system'（下の BACKFILL による移行）。
CREATE TABLE generation_publications (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES generations(id),
  url TEXT,
  published_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('gui', 'mcp', 'api', 'system')),
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_generation_publications_generation_id ON generation_publications(generation_id);
CREATE INDEX idx_generation_publications_published_at ON generation_publications(published_at);

-- 既存の `publish` タグを Publication へ変換する。url は分からないので NULL、published_at は
-- generation_tags の付与時刻（無ければ Generation 自体の created_at）。id は uuidv7() 形式では
-- ないが src/lib/uuidv7.ts の isUuid() は書式(8-4-4-4-12 hex)しか見ないので読み取り側は通る。
-- test/publications.test.ts「backfill」がこの3文を直接再実行して検証する
-- (BACKFILL: マーカーはそのテストが文を切り出す目印)。
-- BACKFILL:
INSERT INTO generation_publications (id, generation_id, url, published_at, created_by, created_at, updated_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  gt.generation_id,
  NULL,
  COALESCE(gt.created_at, g.created_at),
  'system',
  COALESCE(gt.created_at, g.created_at),
  COALESCE(gt.created_at, g.created_at)
FROM generation_tags gt
JOIN tags t ON t.id = gt.tag_id
JOIN generations g ON g.id = gt.generation_id
WHERE t.name = 'publish';

DELETE FROM generation_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = 'publish');

DELETE FROM tags
WHERE name = 'publish'
  AND id NOT IN (SELECT tag_id FROM generation_tags)
  AND id NOT IN (SELECT tag_id FROM batch_tags)
  AND id NOT IN (SELECT tag_id FROM story_tags)
  AND id NOT IN (SELECT tag_id FROM experiment_tags);
