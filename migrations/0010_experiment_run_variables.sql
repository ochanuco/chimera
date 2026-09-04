-- CLI が書き込む自由形式のフラットな factor マップ。グラフ (render_facts) に
-- 表れない要因 (prompt variant のラベルなど) を Run に付記するための注記であり、
-- overrides と違って batch/generation 付与後も変更できる。
ALTER TABLE experiment_runs ADD COLUMN variables_json TEXT;
