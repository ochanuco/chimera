-- pose / costume / expression の本文の正本 (docs/domain-model.md「Preset」)。
-- catalog スナップショット (0014) と違い版を持ち、行は物理削除しない。
-- recipe_ref では分けず、(recipe, kind, name, version) で一意。

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  recipe TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL,
  source_generation_id TEXT REFERENCES generations(id),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (recipe, kind, name, version)
);

CREATE INDEX idx_presets_lookup ON presets (recipe, kind, name, version DESC);
