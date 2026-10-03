-- Batch 廃止: 外部キーを外した batch_id 列を消す。
DROP INDEX idx_comfy_jobs_batch_id;
ALTER TABLE comfy_jobs DROP COLUMN batch_id;
