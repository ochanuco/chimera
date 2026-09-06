-- Experiment が起点とする Generation (base_generation_id) の追加。
-- 各 Run の自動起票 request へ purpose=rebuild の Reference として渡される (docs/experiment-agent.md)。

ALTER TABLE experiments ADD COLUMN base_generation_id TEXT REFERENCES generations(id);
CREATE INDEX idx_experiments_base_generation_id ON experiments(base_generation_id);

-- 1 Batch は 1 Run にしか属さない。GET /api/v1/batches/{id} の experiment_run はこの一意性を前提に
-- batch_id から Run を引く。
CREATE UNIQUE INDEX idx_experiment_runs_batch_id_unique ON experiment_runs(batch_id) WHERE batch_id IS NOT NULL;
