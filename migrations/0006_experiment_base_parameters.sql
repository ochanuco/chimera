-- Experiment が検証中ずっと固定する生成条件 (base_parameters) の追加。
-- 語彙は comfyui-recipes のもので chimera は中身を検証しない（base_recipe と同じ扱い）。
-- See docs/experiment-agent.md.

ALTER TABLE experiments ADD COLUMN base_parameters_json TEXT;
