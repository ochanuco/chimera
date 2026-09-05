-- worker (GPU 機) が claim / heartbeat / 状態遷移するジョブキュー。
-- 契約の正本は docs/worker-protocol.md。

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'finalize')),
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

CREATE INDEX idx_requests_status_created_at ON requests(status, created_at);
CREATE INDEX idx_requests_run_id ON requests(run_id);
CREATE INDEX idx_requests_worker_id ON requests(worker_id);

-- Backfill: batch_id が付いていない既存 Run のうち、Experiment が base_recipe を
-- 持ち active / stabilized なものについて requests 行を起票する
-- (docs/worker-protocol.md「ExperimentRun 由来の generate」の移行手順)。
-- id は UUIDv7 ではなく `bf-{run_id}` — 一度きりの backfill 行だけの例外
-- (docs/worker-protocol.md の requests テーブル節に注記)。
-- payload_hash は TS 側の SHA-256 (kind + "\n" + canonical JSON) を SQL では
-- 再現できないため 'backfill' を入れ、createRequest が再送時に
-- payload_json から都度ハッシュを計算して比較する (src/lib/requests.ts)。
INSERT INTO requests (
  id, kind, status, payload_json, payload_hash, recipe_ref, run_id, worker_id, attempt, max_attempts,
  claimed_at, heartbeat_at, finished_at, error, result_json, idempotency_key, created_by, created_at, updated_at
)
SELECT
  'bf-' || r.id,
  'generate',
  'queued',
  json_object(
    'schema_version', 1,
    'request', json_object(
      'instruction', COALESCE(r.objective, 'run #' || r.run_index || ' of ' || e.name),
      'count', COALESCE(json_extract(e.base_parameters_json, '$.count'), 1)
    ),
    'generation', json_object(
      'recipe', e.base_recipe,
      'parameters', json(COALESCE(json_remove(e.base_parameters_json, '$.count'), '{}'))
    ),
    'semantic', json_object(
      'summary', COALESCE(r.objective, 'run #' || r.run_index || ' of ' || e.name)
    ),
    'experiment', json_object(
      'experiment_id', e.id,
      'run_id', r.id,
      'overrides', json(r.overrides_json)
    )
  ),
  'backfill',
  'production',
  r.id,
  NULL,
  0,
  3,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'run:' || r.id,
  'system',
  r.created_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM experiment_runs r
JOIN experiments e ON e.id = r.experiment_id
WHERE r.batch_id IS NULL AND e.base_recipe IS NOT NULL AND e.status IN ('active', 'stabilized');
