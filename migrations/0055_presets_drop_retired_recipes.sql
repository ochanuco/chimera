-- yukari-il と yukari-sketch のレシピは worker から消え、production の catalog にも無い。
-- 両レシピの preset と基準 render の pin を消す。presets を指す外部キーは無い (0036 と同じ)。
DELETE FROM preset_references WHERE recipe IN ('yukari-il', 'yukari-sketch');
DELETE FROM presets WHERE recipe IN ('yukari-il', 'yukari-sketch');
