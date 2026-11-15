-- ワークベンチの 4 背景 と 光 の間に 5 軌跡 を挟み、6 フェーズ（… / 4 背景 / 5 光 / 6 ボケ）を
-- 7 フェーズ（… / 4 背景 / 5 軌跡 / 6 光 / 7 ボケ）にする。旧 6 を 7 に、旧 5 を 6 に送る。旧 5 か 6 を持つ行は、新 6 以降の入力が 4 の採用のままになるよう 5 をスキップにする。
-- json_patch は null の値のキーを消すので、無い採用は書かれない。
UPDATE workbenches SET picks_json = json_patch('{}', json_object(
  '1', json(json_extract(picks_json, '$."1"')),
  '2', json(json_extract(picks_json, '$."2"')),
  '3', json(json_extract(picks_json, '$."3"')),
  '4', json(json_extract(picks_json, '$."4"')),
  '5', CASE WHEN json_extract(picks_json, '$."5"') IS NOT NULL OR json_extract(picks_json, '$."6"') IS NOT NULL THEN json('{"skip":true}') END,
  '6', json(json_extract(picks_json, '$."5"')),
  '7', json(json_extract(picks_json, '$."6"'))
));
