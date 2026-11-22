-- generations から character_id（characters への外部キー）と note を外す。外部キー付きの列は
-- ALTER TABLE DROP COLUMN で落とせないので表を作り直す。D1 は 1 回の migration の CPU 時間に上限があるので
-- この表だけをこの migration で扱う。DROP TABLE の暗黙の DELETE が子表の外部キー違反を数えるので検査は
-- COMMIT まで遅らせ、ON DELETE CASCADE の子表（generation_tags / request_references）は退避して戻す。
-- 戻す行ごとに子表を引き直すので、索引（自己参照の refines_generation_id を含む）は行を戻す前に作る。
PRAGMA defer_foreign_keys = true;

CREATE TABLE _m63_generation_tags AS SELECT * FROM generation_tags;
CREATE TABLE _m63_request_references AS SELECT * FROM request_references;
CREATE TABLE _m63_generations AS SELECT * FROM generations;
DROP TABLE generations;
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  comfy_job_id TEXT NOT NULL REFERENCES comfy_jobs(id),
  seed INTEGER,
  original_filename TEXT,
  comfy_output_index INTEGER,
  r2_object_key TEXT NOT NULL,
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
  request_id TEXT NOT NULL REFERENCES requests(id),
  refines_generation_id TEXT REFERENCES generations(id),
  model_family TEXT,
  UNIQUE (comfy_job_id, comfy_output_index)
);
CREATE INDEX idx_generations_rating ON generations(rating);
CREATE INDEX idx_generations_bookmark ON generations(bookmark);
CREATE INDEX idx_generations_created_at ON generations(created_at);
CREATE INDEX idx_generations_original_filename ON generations(original_filename);
CREATE INDEX idx_generations_request_id ON generations(request_id);
CREATE INDEX idx_generations_refines_generation_id ON generations(refines_generation_id);

INSERT INTO generations (id, short_id, comfy_job_id, seed, original_filename, comfy_output_index, r2_object_key, rating, bookmark, semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at, created_at, image_width, image_height, image_size, original_purged_at, request_id, refines_generation_id, model_family)
SELECT id, short_id, comfy_job_id, seed, original_filename, comfy_output_index, r2_object_key, rating, bookmark, semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at, created_at, image_width, image_height, image_size, original_purged_at, request_id, refines_generation_id, model_family
FROM _m63_generations;
INSERT INTO generation_tags SELECT * FROM _m63_generation_tags;
INSERT INTO request_references SELECT * FROM _m63_request_references;
DROP TABLE _m63_generations;
DROP TABLE _m63_generation_tags;
DROP TABLE _m63_request_references;
