-- ワークベンチを 5 フェーズ（1 描き直し / 2 光 / 3 部分 / 4 納品 / 5 ボケ）から 6 フェーズ（1 描き直し / 2 部分 / 3 切り抜き・フチ /
-- 4 背景 / 5 光 / 6 ボケ）に組み替える。光の redraw は描き直しの方法の一つになるので、新しい 1 は旧 2（採用していれば）か旧 1。
-- 旧 3 → 2、旧 4 → 3、旧 5 → 6。旧 5 を持つ行は、間の 4 と 5 をスキップにする（6 の入力が 3 の採用になるように）。
-- json_patch は null の値のキーを消すので、無い採用は書かれない。
UPDATE workbenches SET picks_json = json_patch('{}', json_object(
  '1', CASE WHEN json_extract(picks_json, '$."2".generation_id') IS NOT NULL THEN json(json_extract(picks_json, '$."2"'))
            ELSE json(json_extract(picks_json, '$."1"')) END,
  '2', json(json_extract(picks_json, '$."3"')),
  '3', json(json_extract(picks_json, '$."4"')),
  '4', CASE WHEN json_extract(picks_json, '$."5"') IS NOT NULL THEN json('{"skip":true}') END,
  '5', CASE WHEN json_extract(picks_json, '$."5"') IS NOT NULL THEN json('{"skip":true}') END,
  '6', json(json_extract(picks_json, '$."5"'))
));
