-- Batch 廃止: 外部キー付きの batch_id は ALTER TABLE DROP COLUMN で落とせないため、表を作り直して
-- batch_id を外部キーなし・NULL 可にする（列の削除は Batch の表と一緒に後の migration で行う）。
-- 旧コードは batch_id を書き続けるので、この状態は新旧どちらのコードとも両立する。
-- D1 は 1 回の migration の CPU 時間に上限があるため、作り直しは 1 表ずつ別の migration にする。
-- DROP TABLE の暗黙の DELETE が子表の外部キー違反を数えるので、検査は COMMIT まで遅らせ、
-- 同じ名前の表に行を戻して解消する。戻す行ごとに子表を引き直すので、索引は行を戻す前に作る。
PRAGMA defer_foreign_keys = true;

CREATE TABLE _m29_experiment_runs AS SELECT * FROM experiment_runs;
DROP TABLE experiment_runs;
CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  run_index INTEGER NOT NULL,
  parent_run_id TEXT REFERENCES experiment_runs(id),
  generation_id TEXT REFERENCES generations(id),
  batch_id TEXT,
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
CREATE INDEX idx_experiment_runs_experiment_id ON experiment_runs(experiment_id);
CREATE INDEX idx_experiment_runs_parent_run_id ON experiment_runs(parent_run_id);
CREATE INDEX idx_experiment_runs_generation_id ON experiment_runs(generation_id);
CREATE INDEX idx_experiment_runs_batch_id ON experiment_runs(batch_id);
CREATE UNIQUE INDEX idx_experiment_runs_batch_id_unique ON experiment_runs(batch_id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX idx_experiment_runs_idempotency_key ON experiment_runs(idempotency_key);

INSERT INTO experiment_runs (id, experiment_id, run_index, parent_run_id, generation_id, batch_id, overrides_json, objective, evaluation_json, decision_json, note, created_at, updated_at, idempotency_key, variables_json)
SELECT id, experiment_id, run_index, parent_run_id, generation_id, batch_id, overrides_json, objective, evaluation_json, decision_json, note, created_at, updated_at, idempotency_key, variables_json
FROM _m29_experiment_runs;
DROP TABLE _m29_experiment_runs;
