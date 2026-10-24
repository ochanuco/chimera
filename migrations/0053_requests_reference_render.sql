-- requests.kind に 'reference_render'（参考画像の解析結果から選んだタグで描く）を足す。手順は 0052 と同じ: 外部キーの検査を COMMIT まで遅らせ、requests を同じ名前で作り直す。
-- request_references は ON DELETE CASCADE なので退避して戻す。0039 の reroll_of_generation_id と 0051 の payload の generation_id の index も作り直す。
PRAGMA defer_foreign_keys = true;

CREATE TABLE _m53_request_references AS SELECT * FROM request_references;
CREATE TABLE _m53_requests AS SELECT * FROM requests;

DROP TABLE requests;

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'finalize', 'redraw', 'repair', 'masked_redraw', 'deliver', 'dof', 'lens', 'photo', 'stage', 'lighting', 'saturation', 'reference', 'reference_render', 'import')),
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
  git_dirty INTEGER,
  reroll_of_generation_id TEXT
);

INSERT INTO requests SELECT
  id, kind, status, payload_json, payload_hash, recipe_ref, run_id, worker_id, attempt, max_attempts,
  claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at,
  short_id, recipe, raw_instruction, parameters_json, patches_json, pose_fingerprint, preset_versions_json,
  git_commit, git_dirty, reroll_of_generation_id
FROM _m53_requests;

CREATE INDEX idx_requests_status_created_at ON requests(status, created_at);
CREATE INDEX idx_requests_run_id ON requests(run_id);
CREATE INDEX idx_requests_worker_id ON requests(worker_id);
CREATE UNIQUE INDEX idx_requests_short_id ON requests(short_id);
CREATE INDEX idx_requests_reroll_of ON requests(reroll_of_generation_id) WHERE reroll_of_generation_id IS NOT NULL;
CREATE INDEX idx_requests_payload_generation_id ON requests(json_extract(payload_json, '$.generation_id'));

INSERT INTO request_references SELECT * FROM _m53_request_references;
DROP TABLE _m53_request_references;
DROP TABLE _m53_requests;
