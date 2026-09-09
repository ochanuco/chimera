-- comfyui-recipes の experiments/<character>/<pose>.jsonl を写した索引
-- (docs/domain-model.md「Observation」)。正本は JSONL 側で、このテーブルは
-- append-only。id は元レコードの正規化 JSON の SHA-256 なので、同じレコードを
-- 何度 sync しても同じ行に収束する。pose / component の少なくとも一方が無い
-- 行は Observation の語彙に乗らないため、テーブルにも入れない。

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  character TEXT NOT NULL,
  pose TEXT,
  component TEXT,
  parameter TEXT NOT NULL,
  value TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  seed INTEGER,
  render_id TEXT,
  generation_ids_json TEXT,
  recipe TEXT,
  observed_at TEXT,
  supersedes_id TEXT REFERENCES observations(id),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (pose IS NOT NULL OR component IS NOT NULL),
  CHECK (outcome IN ('accepted', 'rejected', 'inconclusive'))
);

CREATE INDEX idx_observations_pose ON observations (character, pose);
CREATE INDEX idx_observations_component ON observations (character, component);
CREATE INDEX idx_observations_parameter ON observations (parameter);
CREATE INDEX idx_observations_outcome ON observations (outcome);
