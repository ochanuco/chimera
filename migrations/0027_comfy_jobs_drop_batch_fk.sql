-- Batch 廃止: 外部キー付きの batch_id は ALTER TABLE DROP COLUMN で落とせないため、表を作り直して
-- batch_id を外部キーなし・NULL 可にする（列の削除は Batch の表と一緒に後の migration で行う）。
-- 旧コードは batch_id を書き続けるので、この状態は新旧どちらのコードとも両立する。
-- D1 は 1 回の migration の CPU 時間に上限があるため、作り直しは 1 表ずつ別の migration にする。
-- DROP TABLE の暗黙の DELETE が子表の外部キー違反を数えるので、検査は COMMIT まで遅らせ、
-- 同じ名前の表に行を戻して解消する。
PRAGMA defer_foreign_keys = true;

CREATE TABLE _m27_comfy_jobs AS SELECT * FROM comfy_jobs;
DROP TABLE comfy_jobs;
CREATE TABLE comfy_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
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
INSERT INTO comfy_jobs (id, batch_id, request_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, graph, render_facts_json, source_generation_id)
SELECT id, batch_id, request_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, graph, render_facts_json, source_generation_id
FROM _m27_comfy_jobs;
DROP TABLE _m27_comfy_jobs;
CREATE INDEX idx_comfy_jobs_batch_id ON comfy_jobs(batch_id);
CREATE INDEX idx_comfy_jobs_comfy_prompt_id ON comfy_jobs(comfy_prompt_id);
CREATE INDEX idx_comfy_jobs_request_id ON comfy_jobs(request_id);
CREATE INDEX idx_comfy_jobs_source_generation_id ON comfy_jobs(source_generation_id);
