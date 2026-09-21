-- comfyui-recipes が IL の recipe `yukari` / `yukari-sketch` を削除し、`yukari-anima` を
-- `yukari` に改名した。recipe 名を持つ列を同じ名前へ寄せる。
--
-- 順番が意味を持つ。先に IL 時代の `yukari` を `yukari-il` へ退避してから
-- `yukari-anima` を `yukari` にする。退避しないと、derive_request は親 Batch の recipe を
-- そのまま写すので IL の絵の派生が Anima で刷られ、(recipe, 'pose', name) の完全一致で
-- 引く pose の pin も IL 時代の seed を拾う。`yukari-il` は既存のどの行にも無い名前なので、
-- presets の UNIQUE (recipe, kind, name, version) と preset_references の current index は
-- どちらの段でも衝突しない。

UPDATE batches SET recipe = 'yukari-il' WHERE recipe = 'yukari';
UPDATE experiments SET base_recipe = 'yukari-il' WHERE base_recipe = 'yukari';
UPDATE presets SET recipe = 'yukari-il' WHERE recipe = 'yukari';
UPDATE preset_references SET recipe = 'yukari-il' WHERE recipe = 'yukari';
UPDATE observations SET recipe = 'yukari-il' WHERE recipe = 'yukari';
UPDATE requests SET payload_json = json_set(payload_json, '$.generation.recipe', 'yukari-il')
WHERE json_extract(payload_json, '$.generation.recipe') = 'yukari';

UPDATE batches SET recipe = 'yukari' WHERE recipe = 'yukari-anima';
UPDATE experiments SET base_recipe = 'yukari' WHERE base_recipe = 'yukari-anima';
UPDATE presets SET recipe = 'yukari' WHERE recipe = 'yukari-anima';
UPDATE preset_references SET recipe = 'yukari' WHERE recipe = 'yukari-anima';
UPDATE observations SET recipe = 'yukari' WHERE recipe = 'yukari-anima';
UPDATE requests SET payload_json = json_set(payload_json, '$.generation.recipe', 'yukari')
WHERE json_extract(payload_json, '$.generation.recipe') = 'yukari-anima';

-- finalize から消えた option を finalize profile の本文から外す。本文は strict な
-- finalizeOptionsSchema で読み戻すので、残っていると profile を並べるページごと落ちる。
UPDATE presets
SET body_json = json_remove(
  body_json,
  '$.options.sketch_redraw',
  '$.options.lora_strength',
  '$.options.handdrawn',
  '$.options.toe_guard'
)
WHERE kind = 'finalize';
