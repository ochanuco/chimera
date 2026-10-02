-- Batch 廃止の段階 1 (docs/batch-removal.md): Request / ComfyJob / Generation に Batch 由来の列を足し、
-- request_references を新設して、既存の Batch から backfill する。以降の書き込みは
-- src/lib/batch-request-sync.ts が Batch と同時に新しい列へ書く。

-- SQLite は CHECK 制約を ALTER できないため requests を作り直し、kind に 'import' を足す
-- (0013 / 0015 と同じ手順。requests を参照する外部キーは無い)。
CREATE TABLE requests_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'finalize', 'repair', 'masked_redraw', 'import')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  recipe_ref TEXT NOT NULL DEFAULT 'production',
  run_id TEXT REFERENCES experiment_runs(id),
  worker_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  claimed_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  error TEXT,
  result_json TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL CHECK (created_by IN ('brain', 'mcp', 'gui', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  short_id TEXT,
  recipe TEXT,
  raw_instruction TEXT,
  parameters_json TEXT,
  patches_json TEXT,
  pose_fingerprint TEXT,
  preset_versions_json TEXT,
  git_commit TEXT,
  git_dirty INTEGER
);

INSERT INTO requests_new (
  id, kind, status, payload_json, payload_hash, recipe_ref, run_id, worker_id, attempt, max_attempts,
  claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at
)
SELECT
  id, kind, status, payload_json, payload_hash, recipe_ref, run_id, worker_id, attempt, max_attempts,
  claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at
FROM requests;

DROP TABLE requests;
ALTER TABLE requests_new RENAME TO requests;

CREATE INDEX idx_requests_status_created_at ON requests(status, created_at);
CREATE INDEX idx_requests_run_id ON requests(run_id);
CREATE INDEX idx_requests_worker_id ON requests(worker_id);
CREATE UNIQUE INDEX idx_requests_short_id ON requests(short_id);

ALTER TABLE comfy_jobs ADD COLUMN request_id TEXT REFERENCES requests(id) ON DELETE SET NULL;
ALTER TABLE comfy_jobs ADD COLUMN source_generation_id TEXT REFERENCES generations(id);
ALTER TABLE generations ADD COLUMN request_id TEXT REFERENCES requests(id) ON DELETE SET NULL;
ALTER TABLE generations ADD COLUMN refines_generation_id TEXT REFERENCES generations(id);

CREATE TABLE request_references (
  id TEXT PRIMARY KEY,
  source_generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  target_request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  purpose TEXT,
  aspect TEXT,
  instruction TEXT,
  created_at TEXT NOT NULL
);

-- BACKFILL
-- test/batch-request-sync.test.ts は BACKFILL から END BACKFILL までを文単位で実行する。この区間の文字列に ; を含めない。

-- Batch -> Request の対応: idempotency_key が 'request:' || requests.id の Batch はその Request、
-- それ以外は下で id = batch.id の Request を補う。
UPDATE requests
SET short_id = b.short_id,
    recipe = b.recipe,
    raw_instruction = b.raw_instruction,
    parameters_json = b.parameters_json,
    patches_json = b.patches_json,
    pose_fingerprint = b.pose_fingerprint,
    preset_versions_json = b.preset_versions_json,
    git_commit = b.git_commit,
    git_dirty = b.git_dirty
FROM batches b
WHERE requests.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END;

INSERT INTO requests (
  id, kind, status, payload_json, payload_hash, recipe_ref, run_id, idempotency_key, created_by, created_at,
  updated_at, finished_at, short_id, recipe, raw_instruction, parameters_json, patches_json, pose_fingerprint,
  preset_versions_json, git_commit, git_dirty
)
SELECT
  b.id,
  CASE
    WHEN json_extract(b.parameters_json, '$.kind') IN ('repair', 'masked_redraw') THEN json_extract(b.parameters_json, '$.kind')
    WHEN b.refines_generation_id IS NOT NULL THEN 'finalize'
    WHEN json_extract(b.parameters_json, '$.kind') IS NOT NULL THEN 'import'
    ELSE 'generate'
  END,
  'done',
  json_object('schema_version', 1, 'legacy_batch_id', b.id),
  'backfill',
  'production',
  (SELECT er.id FROM experiment_runs er WHERE er.batch_id = b.id),
  'batch:' || b.id,
  'system',
  b.created_at,
  b.updated_at,
  b.updated_at,
  b.short_id,
  b.recipe,
  b.raw_instruction,
  b.parameters_json,
  b.patches_json,
  b.pose_fingerprint,
  b.preset_versions_json,
  b.git_commit,
  b.git_dirty
FROM batches b
WHERE NOT EXISTS (
  SELECT 1 FROM requests x
  WHERE x.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END
);

UPDATE comfy_jobs
SET request_id = (
      SELECT COALESCE((SELECT x.id FROM requests x WHERE x.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END), b.id)
      FROM batches b WHERE b.id = comfy_jobs.batch_id
    ),
    source_generation_id = (SELECT b.refines_generation_id FROM batches b WHERE b.id = comfy_jobs.batch_id);

UPDATE generations
SET request_id = (
      SELECT COALESCE((SELECT x.id FROM requests x WHERE x.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END), b.id)
      FROM batches b WHERE b.id = generations.batch_id
    ),
    refines_generation_id = (SELECT b.refines_generation_id FROM batches b WHERE b.id = generations.batch_id);

INSERT INTO request_references (id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at)
SELECT
  br.id,
  br.source_generation_id,
  COALESCE((SELECT x.id FROM requests x WHERE x.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END), b.id),
  br.purpose,
  br.aspect,
  br.instruction,
  br.created_at
FROM batch_references br
JOIN batches b ON b.id = br.target_batch_id
WHERE br.purpose IS NOT 'rebuild';

-- END BACKFILL

CREATE INDEX idx_comfy_jobs_request_id ON comfy_jobs(request_id);
CREATE INDEX idx_comfy_jobs_source_generation_id ON comfy_jobs(source_generation_id);
CREATE INDEX idx_generations_request_id ON generations(request_id);
CREATE INDEX idx_generations_refines_generation_id ON generations(refines_generation_id);
CREATE INDEX idx_request_references_source_generation_id ON request_references(source_generation_id);
CREATE INDEX idx_request_references_target_request_id ON request_references(target_request_id);
