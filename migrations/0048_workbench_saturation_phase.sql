-- ワークベンチに 3 彩度 を挟み、5 フェーズ（1 描き直し / 2 フチ / 3 背景 / 4 光 / 5 ボケ）を
-- 6 フェーズ（1 描き直し / 2 フチ / 3 彩度 / 4 背景 / 5 光 / 6 ボケ）にする。旧 3..5 を 4..6 に送る。旧 3 を持つ行は、新 4 の入力が 2 の採用のままになるよう 3 をスキップにする。
-- json_patch は null の値のキーを消すので、無い採用は書かれない。
UPDATE workbenches SET picks_json = json_patch('{}', json_object(
  '1', json(json_extract(picks_json, '$."1"')),
  '2', json(json_extract(picks_json, '$."2"')),
  '3', CASE WHEN json_extract(picks_json, '$."3"') IS NOT NULL THEN json('{"skip":true}') END,
  '4', json(json_extract(picks_json, '$."3"')),
  '5', json(json_extract(picks_json, '$."4"')),
  '6', json(json_extract(picks_json, '$."5"'))
));
