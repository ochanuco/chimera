-- Batch 廃止: 外部キー付きの batch_id は ALTER TABLE DROP COLUMN で落とせないため、表を作り直して
-- batch_id を外部キーなし・NULL 可にする（列の削除は Batch の表と一緒に後の migration で行う）。
-- 旧コードは batch_id を書き続けるので、この状態は新旧どちらのコードとも両立する。
-- D1 は 1 回の migration の CPU 時間に上限があるため、作り直しは 1 表ずつ別の migration にする。
-- DROP TABLE の暗黙の DELETE が子表の外部キー違反を数えるので、検査は COMMIT まで遅らせ、
-- 同じ名前の表に行を戻して解消する。戻す行ごとに子表を引き直すので、索引（自己参照の
-- refines_generation_id を含む）は行を戻す前に作る。後に作ると子表の走査が全件になり CPU 上限を超える。
-- generations を参照する ON DELETE CASCADE の子表（generation_tags / request_references / batch_references）は
-- DROP で行が消えるので、退避して戻す。
PRAGMA defer_foreign_keys = true;

CREATE TABLE _m28_generation_tags AS SELECT * FROM generation_tags;
CREATE TABLE _m28_request_references AS SELECT * FROM request_references;
CREATE TABLE _m28_batch_references AS SELECT * FROM batch_references;
CREATE TABLE _m28_generations AS SELECT * FROM generations;
DROP TABLE generations;
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  batch_id TEXT,
  comfy_job_id TEXT NOT NULL REFERENCES comfy_jobs(id),
  character_id TEXT REFERENCES characters(id),
  seed INTEGER,
  original_filename TEXT,
  comfy_output_index INTEGER,
  r2_object_key TEXT NOT NULL,
  note TEXT,
  rating TEXT CHECK (rating IN ('bad', 'neutral', 'good')),
  bookmark INTEGER NOT NULL DEFAULT 0,
  semantic_schema_version INTEGER,
  summary TEXT,
  semantic_json TEXT,
  summary_status TEXT,
  summary_model TEXT,
  summary_updated_at TEXT,
  created_at TEXT NOT NULL,
  image_width INTEGER,
  image_height INTEGER,
  image_size INTEGER,
  original_purged_at TEXT,
  original_recompress_checked_at TEXT,
  request_id TEXT NOT NULL REFERENCES requests(id),
  refines_generation_id TEXT REFERENCES generations(id),
  UNIQUE (comfy_job_id, comfy_output_index)
);
CREATE INDEX idx_generations_batch_id ON generations(batch_id);
CREATE INDEX idx_generations_character_id ON generations(character_id);
CREATE INDEX idx_generations_rating ON generations(rating);
CREATE INDEX idx_generations_bookmark ON generations(bookmark);
CREATE INDEX idx_generations_created_at ON generations(created_at);
CREATE INDEX idx_generations_original_filename ON generations(original_filename);
CREATE INDEX idx_generations_request_id ON generations(request_id);
CREATE INDEX idx_generations_refines_generation_id ON generations(refines_generation_id);

INSERT INTO generations (id, short_id, batch_id, comfy_job_id, character_id, seed, original_filename, comfy_output_index, r2_object_key, note, rating, bookmark, semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at, created_at, image_width, image_height, image_size, original_purged_at, original_recompress_checked_at, request_id, refines_generation_id)
SELECT id, short_id, batch_id, comfy_job_id, character_id, seed, original_filename, comfy_output_index, r2_object_key, note, rating, bookmark, semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at, created_at, image_width, image_height, image_size, original_purged_at, original_recompress_checked_at, request_id, refines_generation_id
FROM _m28_generations;
INSERT INTO generation_tags SELECT * FROM _m28_generation_tags;
INSERT INTO request_references SELECT * FROM _m28_request_references;
INSERT INTO batch_references SELECT * FROM _m28_batch_references;
DROP TABLE _m28_generations;
DROP TABLE _m28_generation_tags;
DROP TABLE _m28_request_references;
DROP TABLE _m28_batch_references;
