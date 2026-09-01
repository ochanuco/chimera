-- ExperimentRun にも Batch / ComfyJob と同じ idempotency key 契約を持たせる。
-- Run を作った Agent がレスポンスを失っても、同じキーで安全に再送できるようにする
-- （Run は物理削除できないため、キーなしの再送は重複 Run を恒久的に残す）。
-- See docs/api.md の Idempotency 章。
--
-- batches.idempotency_key / comfy_jobs.idempotency_key は NOT NULL UNIQUE だが、
-- こちらは nullable にする。既存行に値がなく、かつ人間が GUI から作る Run や
-- 使い捨ての curl など、再送保護を必要としない作成経路は今後もキーなしのままで
-- よいため。SQLite の UNIQUE index は NULL 同士を区別するので、キーなしの行は
-- いくつあっても衝突しない。
ALTER TABLE experiment_runs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_experiment_runs_idempotency_key ON experiment_runs(idempotency_key);
