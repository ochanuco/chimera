-- Batch を撤去する。Batch の情報は Request / Job / Generation の列と request_references に移し済み (0026)。
-- comfy_jobs.batch_id / generations.batch_id / experiment_runs.batch_id は外部キーつきの列で
-- ALTER TABLE DROP COLUMN が使えないため、3 表を作り直す。あわせて request_id を NOT NULL にする。
--
-- 外部キーは deferred にして COMMIT 時にまとめて検査する。DROP TABLE の暗黙の DELETE は
-- ON DELETE CASCADE を発火させるので、generations を落とす前に generation_tags と request_references を
-- _m27_ 表へ退避し、作り直した後に戻す。作り直す表は元の名前のまま CREATE する
-- (RENAME では deferred の違反カウンタが戻らず COMMIT で失敗する)。

PRAGMA defer_foreign_keys = true;

-- 前提の検査。generations.request_id / comfy_jobs.request_id に NULL が 1 件でもあれば、
-- 何も壊さないうちにここで止まる (エラー名が欠けている列を指す)。
CREATE TABLE _m27_guard (
  generations_request_id_must_not_be_null INTEGER NOT NULL CONSTRAINT generations_request_id_must_not_be_null CHECK (generations_request_id_must_not_be_null = 1),
  comfy_jobs_request_id_must_not_be_null INTEGER NOT NULL CONSTRAINT comfy_jobs_request_id_must_not_be_null CHECK (comfy_jobs_request_id_must_not_be_null = 1)
);
INSERT INTO _m27_guard VALUES (
  CASE WHEN EXISTS (SELECT 1 FROM generations WHERE request_id IS NULL) THEN 0 ELSE 1 END,
  CASE WHEN EXISTS (SELECT 1 FROM comfy_jobs WHERE request_id IS NULL) THEN 0 ELSE 1 END
);
DROP TABLE _m27_guard;

-- Batch の note を、対応する Request の最初の Generation の note へ追記する。
-- 最初の Generation の選び方は resolveRequestThumbnails (src/lib/db.ts) と同じ。
UPDATE generations
SET note = CASE WHEN generations.note IS NULL OR generations.note = '' THEN t.note ELSE generations.note || char(10) || char(10) || t.note END
FROM (
  SELECT gid, group_concat(note, char(10) || char(10)) AS note
  FROM (
    SELECT
      b.note AS note,
      (SELECT g.id FROM generations g JOIN comfy_jobs j ON j.id = g.comfy_job_id
        WHERE g.request_id = (SELECT g2.request_id FROM generations g2 WHERE g2.batch_id = b.id LIMIT 1)
        ORDER BY j.job_index ASC, g.comfy_output_index ASC, g.created_at ASC, g.id ASC LIMIT 1) AS gid
    FROM batches b
    WHERE b.note IS NOT NULL AND b.note != ''
  )
  WHERE gid IS NOT NULL
  GROUP BY gid
) t
WHERE generations.id = t.gid;

-- Batch 専用の表。batch_references は generations への CASCADE を持つので、generations を落とす前に消す。
DROP TABLE batch_tags;
DROP TABLE story_tags;
DROP TABLE batch_references;
DROP TABLE batch_relations;
DROP TABLE story_relations;

CREATE TABLE _m27_generation_tags AS SELECT id, generation_id, tag_id, created_by, created_at FROM generation_tags;
CREATE TABLE _m27_request_references AS
  SELECT id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at FROM request_references;
CREATE TABLE _m27_experiment_runs AS SELECT * FROM experiment_runs;
CREATE TABLE _m27_comfy_jobs AS SELECT * FROM comfy_jobs;
CREATE TABLE _m27_generations AS SELECT * FROM generations;

-- experiment_runs
DROP TABLE experiment_runs;
CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  run_index INTEGER NOT NULL,
  parent_run_id TEXT REFERENCES experiment_runs(id),
  generation_id TEXT REFERENCES generations(id),
  overrides_json TEXT NOT NULL DEFAULT '{}',
  objective TEXT,
  evaluation_json TEXT,
  decision_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  idempotency_key TEXT,
  variables_json TEXT,
  UNIQUE (experiment_id, run_index)
);
INSERT INTO experiment_runs (
  id, experiment_id, run_index, parent_run_id, generation_id, overrides_json, objective, evaluation_json,
  decision_json, note, created_at, updated_at, idempotency_key, variables_json
)
SELECT
  id, experiment_id, run_index, parent_run_id, generation_id, overrides_json, objective, evaluation_json,
  decision_json, note, created_at, updated_at, idempotency_key, variables_json
FROM _m27_experiment_runs;
CREATE INDEX idx_experiment_runs_experiment_id ON experiment_runs(experiment_id);
CREATE INDEX idx_experiment_runs_parent_run_id ON experiment_runs(parent_run_id);
CREATE INDEX idx_experiment_runs_generation_id ON experiment_runs(generation_id);
CREATE UNIQUE INDEX idx_experiment_runs_idempotency_key ON experiment_runs(idempotency_key);

-- comfy_jobs
DROP TABLE comfy_jobs;
CREATE TABLE comfy_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  comfy_prompt_id TEXT,
  seed INTEGER,
  job_index INTEGER,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'queued', 'running', 'completed', 'ingested', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  graph TEXT,
  render_facts_json TEXT,
  source_generation_id TEXT REFERENCES generations(id)
);
INSERT INTO comfy_jobs (
  id, request_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, graph,
  render_facts_json, source_generation_id
)
SELECT
  id, request_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, graph,
  render_facts_json, source_generation_id
FROM _m27_comfy_jobs;
CREATE INDEX idx_comfy_jobs_comfy_prompt_id ON comfy_jobs(comfy_prompt_id);
CREATE INDEX idx_comfy_jobs_request_id ON comfy_jobs(request_id);
CREATE INDEX idx_comfy_jobs_source_generation_id ON comfy_jobs(source_generation_id);

-- generations
DROP TABLE generations;
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
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
INSERT INTO generations (
  id, short_id, comfy_job_id, character_id, seed, original_filename, comfy_output_index, r2_object_key, note, rating,
  bookmark, semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at,
  created_at, image_width, image_height, image_size, original_purged_at, original_recompress_checked_at,
  request_id, refines_generation_id
)
SELECT
  id, short_id, comfy_job_id, character_id, seed, original_filename, comfy_output_index, r2_object_key, note, rating,
  bookmark, semantic_schema_version, summary, semantic_json, summary_status, summary_model, summary_updated_at,
  created_at, image_width, image_height, image_size, original_purged_at, original_recompress_checked_at,
  request_id, refines_generation_id
FROM _m27_generations;
CREATE INDEX idx_generations_character_id ON generations(character_id);
CREATE INDEX idx_generations_rating ON generations(rating);
CREATE INDEX idx_generations_bookmark ON generations(bookmark);
CREATE INDEX idx_generations_created_at ON generations(created_at);
CREATE INDEX idx_generations_original_filename ON generations(original_filename);
CREATE INDEX idx_generations_request_id ON generations(request_id);
CREATE INDEX idx_generations_refines_generation_id ON generations(refines_generation_id);

INSERT INTO generation_tags (id, generation_id, tag_id, created_by, created_at)
SELECT id, generation_id, tag_id, created_by, created_at FROM _m27_generation_tags;
INSERT INTO request_references (id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at)
SELECT id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at FROM _m27_request_references;

DROP TABLE _m27_generation_tags;
DROP TABLE _m27_request_references;
DROP TABLE _m27_experiment_runs;
DROP TABLE _m27_comfy_jobs;
DROP TABLE _m27_generations;

DROP TABLE batches;
DROP TABLE stories;
