-- ワークベンチから 2 部分 を外し、6 フェーズ（1 描き直し / 2 部分 / 3 切り抜き・フチ / 4 背景 / 5 光 / 6 ボケ）を
-- 5 フェーズ（1 描き直し / 2 切り抜き・フチ / 3 背景 / 4 光 / 5 ボケ）にする。旧 3..6 を 2..5 に詰める。
-- 旧 2 に Generation の採用があれば、その部分描き直しの出力は 1 の候補になるので新 1 の採用にする
-- （旧 3 の入力がそれだったため、新 2 の入力が変わらない）。旧 2 がスキップなら旧 1 のまま。
-- json_patch は null の値のキーを消すので、無い採用は書かれない。
UPDATE workbenches SET picks_json = json_patch('{}', json_object(
  '1', CASE WHEN json_extract(picks_json, '$."2".generation_id') IS NOT NULL THEN json(json_extract(picks_json, '$."2"'))
            ELSE json(json_extract(picks_json, '$."1"')) END,
  '2', json(json_extract(picks_json, '$."3"')),
  '3', json(json_extract(picks_json, '$."4"')),
  '4', json(json_extract(picks_json, '$."5"')),
  '5', json(json_extract(picks_json, '$."6"'))
));
