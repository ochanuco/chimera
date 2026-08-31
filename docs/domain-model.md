# Domain Model

## Overview

中心となる生成階層は以下です。

``` text
Batch
 └── ComfyJob
      └── Generation
```

Experiment は Batch を包含する階層ではなく、ExperimentRun を介して
Batch / Generation を参照します。

``` text
Experiment
  └── ExperimentRun ──▶ Batch / Generation
```

`batches.experiment_id` は引き続き存在しますが、Experiment
上の試行の主体は ExperimentRun です。

ただし、本システムの重要部分は階層そのものではなく、生成探索に存在する複数種類の
Relation を意味ごとに分離することです。

``` text
Batch ── BatchRelation ──▶ Batch
Generation ── BatchReference ──▶ Batch
Batch ── StoryRelation ──▶ Batch
```

## Experiment

1つの検証テーマです。例えば「結月ゆかりの脚部で黒タイツと薄紫ソックスを安定して分離する」のように、base
recipe に対する override を変えながら反復し、安定した条件を
comfyui-recipes へ昇格させるまでを1単位として扱います。

主な属性:

``` text
id
short_id
name
description
note
status
base_recipe
character_id
bookmark
created_at
updated_at
completed_at
```

status の候補と遷移:

``` text
active     → stabilized, abandoned
stabilized → promoted, active, abandoned
promoted   → active
abandoned  → active
```

`active` を離れた時点で `completed_at` が立ち、`active`
に戻すと消えます。`stabilized → promoted` では最初に完了した時刻を保ちます。許可されていない遷移は409です。

過去の生成系譜を辿るときは、過去の Experiment を「再開」するより、過去
Generation を Reference として新しい Experiment / Batch
に取り込み、現在の prompt / recipe で rebuild します。Experiment
自体の再開は、この rebuild とは別に、`abandoned` / `promoted` から
`active` への status 遷移として扱います。

Experiment は原則物理削除しません。

## ExperimentRun

Experiment 内の1回の試行です。`run_index` は Experiment
内で1から連番、`(experiment_id, run_index)` は一意です。

主な属性:

``` text
id
experiment_id
run_index
parent_run_id
batch_id
generation_id
overrides_json
objective
evaluation_json
decision_json
note
created_at
updated_at
```

`overrides` は base recipe に対する差分だけを保持し、recipe
全体は保存しません。`parent_run_id` は「どの Run を受けて次を試したか」を表します。

既存の Batch / Generation は ExperimentRun 側から参照します（Generation
/ Batch 側に experiment_run_id は持たせません）。

`overrides` / `evaluation` / `decision` は typed schema を持たない
JSON blob です。評価軸は Experiment や評価者ごとに変わるため、DB
カラムに分解しません。将来 typed schema を載せられるよう、API
境界では任意の JSON オブジェクトを受けます。

`overrides` の実際の語彙は comfyui-recipes の patch 形式
（`generation.patches` と同じもの）で、chimera はそれを検証も解釈もせず
そのまま保存・返却します。patch の意味づけとバリデーションは
comfyui-recipes 側の唯一の実装に集約され、chimera 側に翻訳層を持ちません。

overrides の例:

``` json
{
  "patches": [
    { "target": "prompt.positive", "op": "append", "value": ", light purple thighhigh socks", "reason": "ソックスの縁を明示する" },
    { "target": "prompt.negative", "op": "remove", "old": "bare legs", "reason": "..." },
    { "target": "render.cfg", "op": "set", "value": 4.5, "reason": "..." }
  ]
}
```

evaluation の例:

``` json
{
  "overall": "fail",
  "aspects": { "pose": "pass", "anatomy": "pass", "clothing": "fail", "composition": "pass" },
  "notes": ["sock/tights boundary is ambiguous"]
}
```

decision の例:

``` json
{
  "action": "retry",
  "reason": "legwear separation failed",
  "next_overrides": { "prompt": { "positive_append": ["distinct sock cuff"] } }
}
```

`action` は `retry` / `accept` / `stabilize` / `abandon` を想定しますが
enum化しません。

不変条件:

-   ExperimentRun は原則物理削除しません。
-   Batch / Generation が attach された Run の `overrides`
    は変更できません（409）。条件を変えるなら新しい Run を作ります。
-   attach 済みの Batch / Generation を別のものに付け替えることはできません（409）。同じ
    id の再送は冪等です。

## ExperimentPromotion

「この Experiment のこの条件を comfyui-recipes へ昇格させる」という意思決定と結果の記録です。chimera
が recipe を書き換えることを意味しません。

主な属性:

``` text
id
experiment_id
source_run_id
promoted_overrides_json
status
target_repository
target_path
commit_sha
pull_request_url
note
created_at
updated_at
completed_at
```

status の候補:

``` text
proposed
applied
rejected
```

`proposed` からのみ確定でき、`applied` / `rejected`
は終端です（409）。`commit_sha` / `pull_request_url`
は作成後に更新できます（作成時点では未定でよい）。

不変条件:

-   ExperimentPromotion は原則物理削除しません。
-   確定済み Promotion の `promoted_overrides` は変更できません（409）。

## Batch

**1生成リクエスト = 1 Batch** と定義します。

「seed 違いで9枚」は1 Batchです。Claude が結果を反芻し prompt
を修正して再度9枚生成した場合は別 Batch です。

主な属性:

``` text
id
experiment_id
raw_instruction
recipe
prompt
negative_prompt
parameters_json
git_commit
git_dirty
note
bookmark
status
created_at
```

status の候補:

``` text
created
running
completed
partial
failed
```

## ComfyJob

ComfyUI への実際の1リクエストです。

現在の運用では、9枚生成時にキューへ9回投入されるため、

``` text
1 Batch = 9 ComfyJobs
```

が基本です。

将来1 ComfyJobから複数outputが生成される可能性を許容します。

``` text
Batch 1:N ComfyJob
ComfyJob 1:N Generation
```

主な属性:

``` text
id
batch_id
comfy_prompt_id
seed
index
status
graph
created_at
updated_at
```

`graph` は ComfyUI に投稿した prompt グラフ（JSON）です。Job のレコード単体から
`/prompt` へ再投稿して生成を再現できるようにするために保存します。

## Generation

生成画像そのものの永続単位です。

1 Generation は必ず1 Batchに属します。別の Experiment / Story
で再利用しても、元の Batch 所属は変更しません。

MVPでは1 Generationにつき Character は0..1です。

主な属性:

``` text
id
short_id
batch_id
comfy_job_id
character_id
seed
original_filename
r2_object_key
note
rating
bookmark
semantic_schema_version
summary
semantic_json
summary_status
summary_model
summary_updated_at
created_at
```

Generation は原則物理削除しません。失敗画像も履歴として保持し、Tag /
status 等で扱います。

## GenerationAsset

Generation 本体（`r2_object_key` が指す完成画像 = composite）に対して、線画・マスク・分解レイヤー・PSD
等の**レイヤーアセット**を追加で紐付けます。

``` text
Generation 1:N GenerationAsset
```

主な属性:

``` text
id
generation_id
role
region
r2_object_key
content_type
size
created_at
updated_at
```

`role` はアセットの種類、`region` は体のどの部位かを表す任意区分です。両方とも自由文字列（enum
にしない）ですが、以下を推奨語彙とします。

role:

``` text
composite       完成画像。generations.r2_object_key が正であり、
                GenerationAsset には入れない
lineart-draft
lineart-inked
mask
layer
base
shadow
highlight
part
depth
meta
psd
```

region:

``` text
skin
hair
clothes
legs
tights
socks
shoes
face
```

region は自由文字列で、絵ごとに増えて構いません。

`region` が空文字（`''`）のとき「部位区分のない全体アセット」を表します。NULL
は使いません（SQLite の `UNIQUE` は NULL 同士を別値として扱うため、`region`
込みの一意性が壊れます）。API 境界ではキー省略・明示 `null`
のどちらも受理し、いずれも `''` に正規化します。レスポンスでは逆に `''` を
`null` に戻します。

`(generation_id, role, region)` は一意です。同じ組み合わせへの再投稿は新しい行を追加せず、既存行を**置換**します（最新版のみ保持）。Generation
本体に適用される「物理削除しない」不変条件は GenerationAsset
には適用しません — 置換は明示的な仕様です。

## Character

検索の第一級属性です。

``` text
id
name
aliases
```

MVPでは複数キャラクター画像を対象外とします。

## BatchReference

**新しい Batch を生成するために、過去 Generation
の何を参照したか**を表す強い provenance です。

``` text
Generation ──▶ Batch
```

例:

``` text
G123 -- pose ----\
                  > B200
G456 -- outfit --/
```

主な属性:

``` text
id
source_generation_id
target_batch_id
purpose
aspect
instruction
created_at
```

purpose 例:

``` text
composition
reference
rebuild
continuity
```

aspect は Core semantic と揃えつつ拡張可能です。

``` text
pose
expression
outfit
style
composition
other
```

## BatchRelation

生成試行としての Batch 間関係です。

``` text
B001 -- refinement --> B002
```

Claude
の自動再試行と、人間の追加指示による再試行を同じモデルで表現し、actor
で区別します。

``` text
id
source_batch_id
target_batch_id
type
actor
reason
raw_instruction
created_at
```

actor:

``` text
human
claude
```

type 例:

``` text
refinement
retry
variation
```

## Story

生成 provenance とは独立した、作品・世界観上の連続性です。

Story は独立エンティティとして扱います。Tag は分類用途であり、Story の
sequence / branch / merge を Tag 階層に押し込みません。

主な属性:

``` text
id
name
description
note
bookmark
created_at
```

## StoryRelation

Story 上の Batch 間の遷移です。

分岐・合流を許す DAG とします。

``` text
B010
 ├── "海へ行く" ──▶ B020
 └── "帰宅する" ──▶ B021
```

主な属性:

``` text
id
story_id
source_batch_id
target_batch_id
raw_instruction
label
description
generated_by
created_at
updated_at
```

`label` / `description` は原則 Claude
が会話から自動生成して即時保存し、人間は必要な場合のみ後編集します。

Story は「何の続きか」を表し、BatchReference
は「何を材料にしたか」を表します。両者を混同しません。

## Tag

Tag 名は自由入力です。ただし UI / Claude とも既存 Tag
の再利用を推奨します。

``` text
tags
- id
- name
- description
- created_at
- updated_at
```

FK 整合性を維持するため、assignment は対象ごとに分けます。

``` text
generation_tags
batch_tags
story_tags
experiment_tags
```

Tag は rename / delete 可能です。

assignment には可能なら以下を保持します。

``` text
created_by: human | claude
created_at
```

## Rating

MVPでは Generation のみ3段階評価を持ちます。

``` text
bad
neutral
good
```

Tag と Rating は別概念です。

運用基準:

``` text
bad      失敗。破綻しており材料にもならない
neutral  惜しい・判断保留（デフォルト）
good     採用圏
```

4段階以上には拡張しません。「超気に入った」は Bookmark で表現します。
「惜しい」の理由は Rating ではなく Tag（`#pose-good` / `#hand-bad` 等）と
semantic metadata の strengths / defects が担います。Claude は
「neutral + defects の記述」から惜しさの内容を読み取れるため、
Rating は粗いフィルタ軸に徹します。

Rating を付けるのは人間のみです。Claude は人間の Rating と semantic
metadata を読んで改善案を設計する側であり、Rating を書き込みません
（Claude による画像検品は、人間がどうしても判断できない場合の
フォールバックに限ります）。

## Bookmark

Bookmark は「後から素早く呼び出す」ための状態です。

以下すべてに対応します。

``` text
Generation
Batch
Story
Experiment
```

Favorite ではなく Bookmark と呼びます。品質評価の段階ではありません。
「超気に入った」Generation は再利用したい Generation と実質同じ集合なので、
Rating を4段階に増やす代わりに Bookmark で表現します。

## Note / Summary

各主要エンティティは人間用 `note` を持てます。

Generation はさらに Claude が生成する `summary` / semantic metadata
を持ちます。

Bookmark にメモを付与せず、メモは対象エンティティ自身に保持します。

## Semantic Metadata

Core は固定し、拡張属性を許可します。

``` json
{
  "schema_version": 1,
  "summary": "...",
  "core": {
    "pose": null,
    "expression": null,
    "outfit": null,
    "style": null,
    "composition": null
  },
  "strengths": [],
  "defects": [],
  "attributes": {}
}
```

Core は Claude / API 間の安定した共通語彙です。判断不能な値は `null`
とします。

`attributes` は lighting、camera angle、stockings
等、将来追加される任意の semantic 情報を保持します。

schema version を必須とし、将来の変更時に過去 Generation 全件を強制
migration しない設計とします。

## Relation Separation

以下の3種類を統合してはいけません。

  Relation         意味
  ---------------- ----------------------------------------------
  BatchReference   過去Generationの何を生成材料として利用したか
  BatchRelation    前Batchを受けてどう再試行したか
  StoryRelation    作品・世界観としてどう続くか

この分離は本システムの重要な設計制約です。
