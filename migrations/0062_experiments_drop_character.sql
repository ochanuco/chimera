-- characters を落とす前に、それを参照する experiments.character_id を外す。外部キー付きの列は
-- ALTER TABLE DROP COLUMN で落とせないので表を作り直す。DROP TABLE の暗黙の DELETE が子表の
-- 外部キー違反を数えるので検査は COMMIT まで遅らせ、ON DELETE CASCADE の子表（experiment_tags）は退避して戻す。
PRAGMA defer_foreign_keys = true;

CREATE TABLE _m62_experiment_tags AS SELECT * FROM experiment_tags;
CREATE TABLE _m62_experiments AS SELECT * FROM experiments;
DROP TABLE experiments;
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  bookmark INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  short_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stabilized', 'promoted', 'abandoned')),
  base_recipe TEXT,
  updated_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  base_parameters_json TEXT,
  base_generation_id TEXT REFERENCES generations(id)
);
CREATE UNIQUE INDEX idx_experiments_short_id ON experiments(short_id);
CREATE INDEX idx_experiments_status ON experiments(status);
CREATE INDEX idx_experiments_base_generation_id ON experiments(base_generation_id);

INSERT INTO experiments (id, name, note, bookmark, created_at, short_id, description, status, base_recipe, updated_at, completed_at, base_parameters_json, base_generation_id)
SELECT id, name, note, bookmark, created_at, short_id, description, status, base_recipe, updated_at, completed_at, base_parameters_json, base_generation_id
FROM _m62_experiments;
INSERT INTO experiment_tags SELECT * FROM _m62_experiment_tags;
DROP TABLE _m62_experiments;
DROP TABLE _m62_experiment_tags;
