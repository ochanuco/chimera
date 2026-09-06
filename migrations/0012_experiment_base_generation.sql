-- Experiment が起点とする Generation (base_generation_id) の追加。
-- 各 Run の自動起票 request へ purpose=rebuild の Reference として渡される (docs/experiment-agent.md)。

ALTER TABLE experiments ADD COLUMN base_generation_id TEXT REFERENCES generations(id);
CREATE INDEX idx_experiments_base_generation_id ON experiments(base_generation_id);
