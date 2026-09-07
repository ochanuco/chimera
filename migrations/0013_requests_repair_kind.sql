-- SQLite が CHECK 制約を ALTER できないため、requests テーブルを
-- kind IN ('generate', 'finalize', 'repair') で作り直す（列/他の制約は
-- migrations/0011_requests.sql と同一）。

CREATE TABLE requests_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'finalize', 'repair')),
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
  updated_at TEXT NOT NULL
);

INSERT INTO requests_new SELECT * FROM requests;

DROP TABLE requests;
ALTER TABLE requests_new RENAME TO requests;

CREATE INDEX idx_requests_status_created_at ON requests(status, created_at);
CREATE INDEX idx_requests_run_id ON requests(run_id);
CREATE INDEX idx_requests_worker_id ON requests(worker_id);
