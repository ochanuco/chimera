-- pose の「基準 render」の pin (docs/domain-model.md「Preset」基準 render の pin)。
-- Preset (0016) は版 (recipe, kind, name, version) ごとの本文を持つが、この行が指すのは
-- 名前そのもの — バージョンは patches の積み重ねを表し、pin はその pose がどう見えるべきかの
-- 基準となる render を表すので、両者は別の軸。
--
-- generation_id は呼び出し側が指した Generation（finalize/repair の出力でもよい）、
-- source_generation_id は resolveDerivationSource (lib/requests.ts) で遡った raw Generation。
-- seed はその raw Generation を作った comfy_job の seed。
--
-- 行は物理削除しない。再設定は現行行を superseded_at で閉じてから新しい行を挿む
-- (履歴を残す — docs/domain-model.md「Preset」不変条件と同じ考え方)。
CREATE TABLE preset_references (
  id TEXT PRIMARY KEY,
  recipe TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  generation_id TEXT NOT NULL REFERENCES generations(id),
  source_generation_id TEXT NOT NULL REFERENCES generations(id),
  seed INTEGER NOT NULL,
  idempotency_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_at TEXT
);

CREATE UNIQUE INDEX idx_preset_references_current ON preset_references (recipe, kind, name) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX idx_preset_references_idempotency_key ON preset_references (idempotency_key);
CREATE INDEX idx_preset_references_generation ON preset_references (generation_id);
