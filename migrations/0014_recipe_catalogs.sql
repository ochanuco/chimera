-- comfyui-recipes 側の recipe カタログのスナップショット。worker が起動時に
-- PUT /api/v1/catalogs/{recipe_ref} で公開する。recipe_ref 単位で最新の1件だけを持つ
-- (履歴は持たない、常に上書き)。

CREATE TABLE recipe_catalogs (
  recipe_ref TEXT PRIMARY KEY,
  catalog_json TEXT NOT NULL,
  git_commit TEXT,
  git_branch TEXT,
  worker_id TEXT,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
