-- PairwiseJudgment は Experiment / ExperimentRun の期限切れ削除の後も残る。experiment_id / baseline_run_id /
-- arm_run_id を NULL 可にし、Run を引かずに winner を導けるよう baseline 側の Generation を列に持つ。
-- 既存行の baseline_generation_id は API の winner と同じ規則（左の Generation が arm run の結果 Request
-- から出たか）で埋める。
CREATE TABLE _m56_pairwise_judgments AS SELECT * FROM pairwise_judgments;
DROP TABLE pairwise_judgments;
CREATE TABLE pairwise_judgments (
  id TEXT PRIMARY KEY,
  experiment_id TEXT REFERENCES experiments(id),
  baseline_run_id TEXT REFERENCES experiment_runs(id),
  arm_run_id TEXT REFERENCES experiment_runs(id),
  seed INTEGER NOT NULL,
  left_generation_id TEXT NOT NULL REFERENCES generations(id),
  right_generation_id TEXT NOT NULL REFERENCES generations(id),
  baseline_generation_id TEXT NOT NULL REFERENCES generations(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('left', 'right', 'tie')),
  judged_at TEXT NOT NULL,
  UNIQUE (baseline_run_id, arm_run_id, seed),
  CHECK (baseline_generation_id IN (left_generation_id, right_generation_id))
);
CREATE INDEX idx_pairwise_judgments_experiment_id ON pairwise_judgments(experiment_id);
CREATE INDEX idx_pairwise_judgments_arm_run_id ON pairwise_judgments(arm_run_id);

INSERT INTO pairwise_judgments
  (id, experiment_id, baseline_run_id, arm_run_id, seed, left_generation_id, right_generation_id, baseline_generation_id, verdict, judged_at)
SELECT j.id, j.experiment_id, j.baseline_run_id, j.arm_run_id, j.seed, j.left_generation_id, j.right_generation_id,
  CASE
    WHEN g.request_id = (SELECT x.id FROM requests x
                          WHERE x.run_id = j.arm_run_id AND x.status = 'done' AND x.kind IN ('generate', 'import')
                          ORDER BY x.created_at DESC, x.id DESC LIMIT 1)
      THEN j.right_generation_id
    ELSE j.left_generation_id
  END,
  j.verdict, j.judged_at
FROM _m56_pairwise_judgments j
JOIN generations g ON g.id = j.left_generation_id;
DROP TABLE _m56_pairwise_judgments;
