-- 同 seed の baseline / arm ペアを人間が盲検で対比較した結果。left / right は
-- 表示時にランダムに割り当てた向きで、verdict はその向きに対する回答。
-- どちらが arm だったかは left_generation_id / right_generation_id と各 run の
-- batch から導く（API の winner フィールド）。
CREATE TABLE pairwise_judgments (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  baseline_run_id TEXT NOT NULL REFERENCES experiment_runs(id),
  arm_run_id TEXT NOT NULL REFERENCES experiment_runs(id),
  seed INTEGER NOT NULL,
  left_generation_id TEXT NOT NULL REFERENCES generations(id),
  right_generation_id TEXT NOT NULL REFERENCES generations(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('left', 'right', 'tie')),
  judged_at TEXT NOT NULL,
  UNIQUE (baseline_run_id, arm_run_id, seed)
);
CREATE INDEX idx_pairwise_judgments_experiment_id ON pairwise_judgments(experiment_id);
