-- Batch 廃止: 外部キーを外した batch_id 列を消す。
DROP INDEX idx_generations_batch_id;
ALTER TABLE generations DROP COLUMN batch_id;
