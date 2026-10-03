-- Batch 廃止: 外部キーを外した batch_id 列を消す。
DROP INDEX idx_experiment_runs_batch_id;
DROP INDEX idx_experiment_runs_batch_id_unique;
ALTER TABLE experiment_runs DROP COLUMN batch_id;
