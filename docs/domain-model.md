# Domain Model

## Overview

中心となる生成階層は以下です。

``` text
Experiment
  └── Batch
       └── ComfyJob
            └── Generation
```

ただし、本システムの重要部分は階層そのものではなく、生成探索に存在する複数種類の
Relation を意味ごとに分離することです。

``` text
Batch ── BatchRelation ──▶ Batch
Generation ── BatchReference ──▶ Batch
Batch ── StoryRelation ──▶ Batch
```

## Experiment

一連の生成試行を後からまとめて見るための軽量なコンテナです。

長寿命なプロジェクトとしては扱いません。過去の Experiment
を「再開」するより、過去 Generation を Reference として新しい Experiment
/ Batch に取り込み、現在の prompt / recipe で rebuild します。

主な属性:

``` text
id
name
note
bookmark
created_at
```

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
created_at
updated_at
```

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

## Bookmark

Bookmark は「後から素早く呼び出す」ための状態です。

以下すべてに対応します。

``` text
Generation
Batch
Story
Experiment
```

Favorite ではなく Bookmark と呼びます。品質評価とは無関係です。

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
