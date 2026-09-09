-- base は pose の本文を埋め込むのをやめ、comfyui-recipes 側の pose への参照
-- ({ recipe_pose: name }) だけを持つ (docs/domain-model.md「Preset」body の形)。
-- base_fingerprint は昇格時点の組み立て済み本文の digest を記録し、base が指す先が
-- あとから動いても「昇格時と今の食い違い」を使う前に検出できるようにする
-- (docs/domain-model.md「Preset」base が動くことへの備え)。
ALTER TABLE presets ADD COLUMN base_fingerprint TEXT;

-- promote の入力は Batch 行から取る。semantic.attributes.patches は生成後に MCP
-- クライアントから書き換わりうる場所で正本になれないため
-- (docs/domain-model.md「Preset」不変条件)、worker が Batch 作成時に実際へ適用した
-- patches と、そのとき組み立てた本文の digest を Batch 側に記録させる。
ALTER TABLE batches ADD COLUMN patches_json TEXT;
ALTER TABLE batches ADD COLUMN pose_fingerprint TEXT;

-- どの preset 版を pin して解決したかは worker ではなく chimera 自身が知っている
-- (request 作成時の pinPresets)。request が done になった時点でその pin を Batch に
-- 書き移し、あとから「何が描かれたか」を (git_commit, 解決済みの preset の版) の組で
-- 再構成できるようにする (docs/domain-model.md「Preset」base が動くことへの備え)。
ALTER TABLE batches ADD COLUMN preset_versions_json TEXT;

-- import 由来の pose 行を新しい参照形へ移す。costume / expression は catalog が
-- 名前の配列でしか publish しておらず、取り込んだ行は中身を持たない
-- (docs/domain-model.md「Preset」body の形)。まだどの request からも参照されていない
-- ので、誤った取り込みを残さず消す。
UPDATE presets SET body_json = json_object('recipe_pose', name) WHERE source = 'import' AND kind = 'pose';
DELETE FROM presets WHERE source = 'import' AND kind IN ('costume', 'expression');
