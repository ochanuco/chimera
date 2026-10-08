-- 生成時間の計測。時刻は worker 機の epoch ミリ秒 (docs/worker-protocol.md「Timings」)。
-- (request_id, attempt, version) の 1 行が 1 回の試行で、PUT /requests/{id}/timings が子行ごと置き換える。
CREATE TABLE request_attempt_timings (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  attempt INTEGER NOT NULL,
  version TEXT NOT NULL CHECK (version IN ('v1', 'v2')),
  source TEXT NOT NULL CHECK (source IN ('worker', 'comfy_history', 'requests')),
  status TEXT NOT NULL CHECK (status IN ('done', 'failed', 'cancelled', 'released')),
  claimed_at INTEGER,
  finished_at INTEGER,
  env_json TEXT,
  cold_load INTEGER CHECK (cold_load IN (0, 1)),
  worker_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (request_id, attempt, version)
);

CREATE TABLE prompt_timings (
  id TEXT PRIMARY KEY,
  attempt_timing_id TEXT NOT NULL REFERENCES request_attempt_timings(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES requests(id),
  prompt_id TEXT NOT NULL,
  comfy_job_id TEXT REFERENCES comfy_jobs(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  resumed INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER,
  execution_start_at INTEGER,
  execution_end_at INTEGER,
  outputs_ready_at INTEGER,
  ingested_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'interrupted', 'unknown'))
);

CREATE TABLE node_timings (
  prompt_timing_id TEXT NOT NULL REFERENCES prompt_timings(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  class_type TEXT NOT NULL,
  role TEXT,
  cached INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER,
  steps_total INTEGER,
  step_ms_json TEXT,
  PRIMARY KEY (prompt_timing_id, node_id)
);

CREATE INDEX idx_request_attempt_timings_request_id ON request_attempt_timings(request_id);
CREATE INDEX idx_prompt_timings_attempt_timing_id ON prompt_timings(attempt_timing_id);
CREATE INDEX idx_prompt_timings_request_id ON prompt_timings(request_id);
CREATE INDEX idx_prompt_timings_prompt_id ON prompt_timings(prompt_id);
CREATE INDEX idx_node_timings_role ON node_timings(role);
