-- finalize は redraw と deliver に分かれ、profile (preset kind 'finalize') は deliver の option を指す
-- kind 'deliver' に置き換わった。finalize の preset とその基準 render の pin を消す。
-- presets を指す外部キーは無い (preset_references は kind / name の文字列で結ぶ) ので、行を消すだけでよい。
DELETE FROM preset_references WHERE kind = 'finalize';
DELETE FROM presets WHERE kind = 'finalize';
