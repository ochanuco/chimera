-- Layered assets (lineart, masks, decomposed layers, PSD, etc.) attached to a
-- Generation. See docs/domain-model.md for entity semantics.

CREATE TABLE generation_assets (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES generations(id),
  role TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  r2_object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (generation_id, role, region)
);

CREATE INDEX idx_generation_assets_generation_id ON generation_assets(generation_id);
