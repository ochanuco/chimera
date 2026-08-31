-- Experiment を「1つの検証テーマ」として扱うためのライフサイクル拡張と、
-- ExperimentRun / ExperimentPromotion の追加。
-- 既存 experiments 行は short_id を採番し、status='active' /
-- updated_at=created_at にバックフィルされる。
-- See docs/domain-model.md for entity semantics.

ALTER TABLE experiments ADD COLUMN short_id TEXT;
ALTER TABLE experiments ADD COLUMN description TEXT;
ALTER TABLE experiments ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'stabilized', 'promoted', 'abandoned'));
ALTER TABLE experiments ADD COLUMN base_recipe TEXT;
ALTER TABLE experiments ADD COLUMN character_id TEXT REFERENCES characters(id);
ALTER TABLE experiments ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN completed_at TEXT;

-- hex(randomblob(...)) は [0-9a-f] を返すので、アプリ側 short_id の
-- 文字集合 [a-z0-9]{6} に収まる。
UPDATE experiments SET short_id = lower(substr(hex(randomblob(4)), 1, 6)) WHERE short_id IS NULL;
UPDATE experiments SET updated_at = created_at WHERE updated_at = '';

CREATE UNIQUE INDEX idx_experiments_short_id ON experiments(short_id);
CREATE INDEX idx_experiments_status ON experiments(status);
CREATE INDEX idx_experiments_character_id ON experiments(character_id);

CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  run_index INTEGER NOT NULL,
  parent_run_id TEXT REFERENCES experiment_runs(id),
  batch_id TEXT REFERENCES batches(id),
  generation_id TEXT REFERENCES generations(id),
  overrides_json TEXT NOT NULL DEFAULT '{}',
  objective TEXT,
  evaluation_json TEXT,
  decision_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (experiment_id, run_index)
);

CREATE INDEX idx_experiment_runs_experiment_id ON experiment_runs(experiment_id);
CREATE INDEX idx_experiment_runs_parent_run_id ON experiment_runs(parent_run_id);
CREATE INDEX idx_experiment_runs_batch_id ON experiment_runs(batch_id);
CREATE INDEX idx_experiment_runs_generation_id ON experiment_runs(generation_id);

CREATE TABLE experiment_promotions (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  source_run_id TEXT REFERENCES experiment_runs(id),
  promoted_overrides_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'applied', 'rejected')),
  target_repository TEXT NOT NULL,
  target_path TEXT,
  commit_sha TEXT,
  pull_request_url TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_experiment_promotions_experiment_id ON experiment_promotions(experiment_id);
CREATE INDEX idx_experiment_promotions_source_run_id ON experiment_promotions(source_run_id);
CREATE INDEX idx_experiment_promotions_status ON experiment_promotions(status);
