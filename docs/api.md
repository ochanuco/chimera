# Management API

## Principles

APIは以下の利用者を想定します。

``` text
Python CLI  → Write / ingest
Claude Code → Read context / semantic update
Web GUI     → Read / user mutation
```

認証はCloudflare Accessで行い、アプリ独自認証は実装しません。

クライアント実装上の注意:

-   Cloudflare がライブラリ既定の User-Agent（Python urllib
    等）をブロックすることがあるため、明示的な User-Agent
    ヘッダーを送ること。
-   `references` / `refinement` / `story` は request.json
    と同様、キー省略と明示的な `null` のどちらも「該当なし」として受理する。

## Batch

### Create Batch

``` text
POST /api/v1/batches
```

request.json の内容、Git metadata、idempotency key を送ります。

同一 idempotency key の再送は既存Batchを返し、重複作成しません。

### Update Batch

``` text
PATCH /api/v1/batches/{id}
```

主にstatus更新に使用します。

status:

``` text
created
running
completed
partial
failed
```

### Get Batch

``` text
GET /api/v1/batches/{id-or-short-id}
```

既存のフィールド（`references` / `relations.outgoing` / `relations.incoming` /
`story_relations` など）に加え、GUIの「親・子・兄弟」表示向けに以下を追加で返します
（Web GUI 専用ではなく通常のBatch取得レスポンスの一部です）:

``` json
{
  "reference_children": [
    { "batch_id": "...", "source_generation_id": "...", "purpose": "composition", "aspect": "pose" }
  ],
  "siblings": [
    { "batch_id": "...", "via": "refinement", "shared_id": "..." },
    { "batch_id": "...", "via": "reference", "shared_id": "..." }
  ]
}
```

-   `reference_children`: このBatchのGenerationを材料として使った他Batchの一覧
-   `siblings`: 自分以外で親を共有するBatchの一覧。`via: "refinement"`
    は同じrefinement元Batchを持つBatch（`shared_id` はそのBatchのid）、
    `via: "reference"` は同じGenerationを材料に使ったBatch（`shared_id`
    はそのGenerationのid）

## ComfyJob

### Create Job

``` text
POST /api/v1/batches/{batch_id}/jobs
```

例:

``` json
{
  "idempotency_key": "...",
  "seed": 123456789,
  "index": 0
}
```

### Update Job

``` text
PATCH /api/v1/jobs/{job_id}
```

例:

``` json
{
  "status": "queued",
  "comfy_prompt_id": "a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df",
  "graph": { "3": { "class_type": "KSampler", "inputs": { "...": "..." } } }
}
```

`graph` は ComfyUI に POST した prompt グラフ全体（`/prompt` にそのまま再投稿できる形）です。
Job の記録単体で生成を再現できるようにするための保存であり、省略した場合は既存の値を保持します。

Job status:

``` text
created
queued
running
completed
ingested
failed
```

## Character

Character は検索の第一級属性であり、事前登録が必要です。Generation ingest
の `character_id` には登録済み Character の id を渡します。

``` text
POST /api/v1/characters
GET  /api/v1/characters
```

``` json
{
  "name": "結月ゆかり",
  "aliases": []
}
```

CLI / Claude は name で GET
して既存を解決し、なければ作成してから id を使います。

## Experiment

Experiment は検証テーマの単位です（詳細は `domain-model.md` の Experiment
/ ExperimentRun / ExperimentPromotion 参照）。`{id}` はUUID / short_id
のどちらでも受けます。

### Create Experiment

``` text
POST /api/v1/experiments
```

``` json
{
  "name": "黒タイツ+薄紫ソックスの分離",
  "description": "結月ゆかりの脚部で黒タイツと薄紫ソックスを安定して分離する",
  "base_recipe": "dq3",
  "character_id": "..."
}
```

`status` は常に `active` で作成されます。

### List Experiments

``` text
GET /api/v1/experiments
```

主なquery:

``` text
status
character   # idまたはname
bookmark
limit
offset
```

`status` に候補外の値を渡すと400です。

`updated_at` DESC順です。Run / Promotion の作成・更新でも Experiment
の `updated_at` が進みます。

``` json
{
  "items": [
    {
      "id": "...",
      "short_id": "abc123",
      "name": "...",
      "description": "...",
      "note": null,
      "status": "active",
      "base_recipe": "dq3",
      "character_id": "...",
      "bookmark": false,
      "created_at": "...",
      "updated_at": "...",
      "completed_at": null,
      "character": { "id": "...", "name": "結月ゆかり" },
      "run_count": 3,
      "latest_run": {
        "id": "...",
        "run_index": 3,
        "created_at": "...",
        "evaluation_overall": "fail"
      }
    }
  ]
}
```

### Get Experiment

``` text
GET /api/v1/experiments/{id-or-short-id}
```

List item と同じフィールドに加え、`tags` と `runs`（`run_index`
昇順。各 Run に `batch` / `generation` が付く）、`promotions` を返します。

``` json
{
  "id": "...",
  "short_id": "abc123",
  "name": "...",
  "description": "...",
  "note": null,
  "status": "active",
  "base_recipe": "dq3",
  "character_id": "...",
  "bookmark": false,
  "created_at": "...",
  "updated_at": "...",
  "completed_at": null,
  "character": { "id": "...", "name": "結月ゆかり" },
  "tags": ["legwear"],
  "run_count": 1,
  "runs": [
    {
      "id": "...",
      "experiment_id": "...",
      "run_index": 1,
      "parent_run_id": null,
      "batch_id": "...",
      "generation_id": "...",
      "overrides": { "pose": { "hip_rotation": 4 } },
      "objective": "...",
      "evaluation": null,
      "decision": null,
      "note": null,
      "created_at": "...",
      "updated_at": "...",
      "batch": { "id": "...", "short_id": "...", "thumbnail_url": "..." },
      "generation": { "id": "...", "short_id": "..." }
    }
  ],
  "promotions": []
}
```

### Update Experiment

``` text
PATCH /api/v1/experiments/{id-or-short-id}
```

``` json
{
  "status": "stabilized"
}
```

許可されていない status 遷移（`domain-model.md` の Experiment
遷移表参照）は409です。

## ExperimentRun

### Create Run

``` text
POST /api/v1/experiments/{id}/runs
```

``` json
{
  "overrides": { "prompt": { "positive_append": ["light purple thighhigh socks"] } },
  "objective": "ソックスとタイツの境界を明確にする",
  "parent_run_id": "..."
}
```

`batch_id` / `generation_id` はUUID / short_idのどちらでも受けます。`run_index`
は Experiment 内で自動採番されます。

### List Runs

``` text
GET /api/v1/experiments/{id}/runs
```

``` json
{ "items": [ /* Get Experimentの`runs`と同じ形 */ ] }
```

### Get Run

``` text
GET /api/v1/experiment-runs/{run_id}
```

Run の各フィールドに加え、`batch` / `generation` と以下を返します。

``` json
"experiment": {
  "id": "...",
  "short_id": "abc123",
  "name": "...",
  "status": "active",
  "base_recipe": "dq3",
  "character_id": "..."
}
```

### Update Run

``` text
PATCH /api/v1/experiment-runs/{run_id}
```

``` json
{
  "evaluation": {
    "overall": "fail",
    "aspects": { "pose": "pass", "anatomy": "pass", "clothing": "fail", "composition": "pass" },
    "notes": ["sock/tights boundary is ambiguous"]
  },
  "decision": {
    "action": "retry",
    "reason": "legwear separation failed",
    "next_overrides": { "prompt": { "positive_append": ["distinct sock cuff"] } }
  }
}
```

`batch_id` / `generation_id` はattach専用でnullを受けません。`evaluation`
/ `decision` は明示nullでクリアできます。

409のケース:

-   Batch / Generation がattach済みのRunで `overrides` を変更しようとした
-   既にattach済みの `batch_id` / `generation_id` を別のものへ付け替えようとした

## ExperimentPromotion

### Create Promotion

``` text
POST /api/v1/experiments/{id}/promotions
```

``` json
{
  "source_run_id": "...",
  "target_path": "recipes/yukari/legwear.py",
  "note": "..."
}
```

`target_repository` の既定値は `comfyui-recipes` です。`promoted_overrides`
省略時は `source_run_id` の Run の overrides をそのまま昇格対象とします。`status`
は常に `proposed` で作成されます。

### List Promotions

``` text
GET /api/v1/experiments/{id}/promotions
```

``` json
{ "items": [ /* Promotionの配列 */ ] }
```

### Get Promotion

``` text
GET /api/v1/promotions/{promotion_id}
```

### Update Promotion

``` text
PATCH /api/v1/promotions/{promotion_id}
```

``` json
{
  "status": "applied",
  "commit_sha": "a1b2c3d",
  "pull_request_url": "https://github.com/.../pull/12"
}
```

`pull_request_url` は `http` / `https` のみ受け付けます。保存値は Web GUI の
リンクとして描画されるため、実行可能なスキームを保存時点で弾きます。

409のケース:

-   `proposed` 以外からの status 遷移（`applied` / `rejected` は終端）
-   `proposed` 以外の状態で `promoted_overrides` を変更しようとした

Experiment の tag / bookmark は Tags / Bookmark 章の endpoint を使います。

## Generation Ingest

``` text
POST /api/v1/jobs/{job_id}/generations
Content-Type: multipart/form-data
```

metadata 例:

``` json
{
  "seed": 123456789,
  "original_filename": "yk-lineT3_00001_.png",
  "comfy_output_index": 0
}
```

画像binaryも同時に送信します。

Management API がR2へ保存し、D1へGenerationを登録します。

レスポンス例:

``` json
{
  "id": "uuidv7",
  "short_id": "abc123",
  "canonical_url": "https://example/g/abc123",
  "r2_object_key": "generations/uuidv7/original.png"
}
```

## Generation Assets

線画・マスク・分解レイヤー・PSD 等のレイヤーアセットを Generation
に紐付けます（詳細は `domain-model.md` の GenerationAsset 参照）。

### Ingest Asset

``` text
POST /api/v1/generations/{id}/assets
Content-Type: multipart/form-data
```

フィールド:

``` text
metadata  JSON文字列 { "role": "...", "region": "..."? }
file      アセット本体（バイナリ、1ファイル）
```

`content_type` は `file` パートの type を採用しますが、`metadata.content_type`
があればそれで上書きできます。

`region` はキー省略・明示 `null` のどちらも「部位区分のない全体アセット」として受理します。

`(generation_id, role, region)` は一意です。同じ組み合わせへの再投稿は既存行を**置換**し（id
は変わらず、`content_type` / `size` / `updated_at` を更新して R2 も同じ key
へ上書き）200 を返します。初回投稿は 201 です。

レスポンス例:

``` json
{
  "id": "uuidv7",
  "generation_id": "...",
  "role": "lineart-inked",
  "region": null,
  "content_type": "image/png",
  "size": 123456,
  "url": "https://example/g/abc123/assets/lineart-inked",
  "created_at": "...",
  "updated_at": "..."
}
```

### List Assets

``` text
GET /api/v1/generations/{id}/assets
```

``` json
{
  "assets": [ /* Ingest Asset と同じレスポンス形の配列。role, region順 */ ]
}
```

### Serve Asset

``` text
GET /g/{short_id}/assets/{role}
GET /g/{short_id}/assets/{role}?region={region}
```

`region` 省略時は `''`（全体アセット）を引きます。未知の `role` / `region`
の組み合わせは404です。

## Generation Context

Claude向けの軽量semantic representationです。

``` text
GET /api/v1/generations/{id-or-short-id}/context
```

例:

``` json
{
  "id": "abc123",
  "canonical_url": "https://example/g/abc123",
  "image": {
    "url": "https://example/g/abc123/image"
  },
  "character": {
    "id": "...",
    "name": "結月ゆかり"
  },
  "created_at": "...",
  "rating": "good",
  "bookmark": true,
  "tags": ["outfit-good"],
  "note": "...",
  "summary": "...",
  "semantic": {
    "schema_version": 1,
    "core": {
      "pose": "...",
      "expression": "...",
      "outfit": "...",
      "style": "...",
      "composition": "..."
    },
    "strengths": [],
    "defects": [],
    "attributes": {}
  },
  "batch": {
    "id": "..."
  },
  "references": [],
  "used_by": []
}
```

`references` はこのGenerationを材料として使ったBatch向けの
BatchReferenceそのもの（`target_batch_id`
を持つ）で、`used_by` は同じ行を `batch_id`
キーで返す簡易版です（どちらもこのGenerationを材料に使ったBatchの一覧）。

ComfyUI workflow全文、Git diff、詳細ログなどは返しません。

## Generation Search

``` text
GET /api/v1/generations
```

主なquery:

``` text
character
tag
from
to
rating
bookmark
comfy_prompt_id
original_filename
```

主な用途:

``` text
character=yukari
tag=outfit-good
bookmark=true
from=2026-01-01
to=2026-08-26
```

検索結果には short ID、canonical URL、thumbnail/image
URL、summary等の軽量情報を返します。

## Semantic Update

``` text
PUT /api/v1/generations/{id}/semantic
```

Claude Codeが画像を解析した結果を保存します。

Management API自身はLLM APIを呼びません。

例:

``` json
{
  "schema_version": 1,
  "summary": "...",
  "core": {
    "pose": "...",
    "expression": "...",
    "outfit": "...",
    "style": "...",
    "composition": "..."
  },
  "strengths": [],
  "defects": [],
  "attributes": {},
  "generated_by": {
    "provider": "anthropic",
    "model": "..."
  }
}
```

## Batch Reference

``` text
POST /api/v1/batches/{id}/references
```

``` json
{
  "source_generation_id": "abc123",
  "purpose": "composition",
  "aspect": "pose",
  "instruction": "..."
}
```

## Batch Relation

``` text
POST /api/v1/batches/{target_batch_id}/relations
```

``` json
{
  "source_batch_id": "B001",
  "type": "refinement",
  "actor": "claude",
  "reason": "..."
}
```

## Story Relation

``` text
POST /api/v1/stories/{story_id}/relations
```

``` json
{
  "source_batch_id": "B010",
  "target_batch_id": "B020",
  "label": "海辺へ移動",
  "description": "...",
  "raw_instruction": "..."
}
```

## Graph

生成履歴全体をBatch単位のノードとして返します。`/graph`
のGraph View SSRが内部で利用しますが、外部からも利用可能です。

``` text
GET /api/v1/graph
```

``` json
{
  "nodes": [
    {
      "id": "...",
      "short_id": "...",
      "raw_instruction": "先頭60文字",
      "status": "...",
      "created_at": "...",
      "generation_count": 3,
      "thumbnail_generation_short_id": "... or null"
    }
  ],
  "edges": [
    {
      "type": "reference",
      "source_batch_id": "...",
      "target_batch_id": "...",
      "label": "pose (abc123)",
      "source_generation_short_id": "abc123",
      "aspect": "pose"
    },
    {
      "type": "relation",
      "source_batch_id": "...",
      "target_batch_id": "...",
      "label": "refinement / human",
      "relation_type": "refinement",
      "actor": "human"
    },
    {
      "type": "story",
      "source_batch_id": "...",
      "target_batch_id": "...",
      "label": "<story name>: <relation label>",
      "story_id": "..."
    }
  ]
}
```

`edges[].type`はBatchReference / BatchRelation /
StoryRelationに対応し、統合しません（Relation Separation、`domain-model.md`
参照）。reference エッジは、Generation起点のBatchReferenceをsource
Generationが属するBatchへ集約したものです。source/targetが同一Batchになるものは除外します。

## Tags

対象別endpointを使用します。

``` text
POST   /api/v1/generations/{id}/tags
DELETE /api/v1/generations/{id}/tags/{tag_id}

POST   /api/v1/batches/{id}/tags
DELETE /api/v1/batches/{id}/tags/{tag_id}

POST   /api/v1/stories/{id}/tags
DELETE /api/v1/stories/{id}/tags/{tag_id}

POST   /api/v1/experiments/{id}/tags
DELETE /api/v1/experiments/{id}/tags/{tag_id}
```

Tag本体はrename/delete可能です。

## Bookmark

``` text
PUT    /api/v1/generations/{id}/bookmark
DELETE /api/v1/generations/{id}/bookmark

PUT    /api/v1/batches/{id}/bookmark
DELETE /api/v1/batches/{id}/bookmark

PUT    /api/v1/stories/{id}/bookmark
DELETE /api/v1/stories/{id}/bookmark

PUT    /api/v1/experiments/{id}/bookmark
DELETE /api/v1/experiments/{id}/bookmark
```

## Rating

MVPではGenerationのみ。

``` text
PUT /api/v1/generations/{id}/rating
```

``` json
{
  "rating": "good"
}
```

## Notes

主要エンティティの通常PATCHで編集します。

## Canonical Routes

人間向け:

``` text
/g/{short_id}
/b/{short_id}
```

Experiment の人間向けパスは `/experiments/{short_id}` です。

Claudeはcanonical URLを受け取った後、context
APIへ解決可能な設計とします。

## Idempotency

以下は必須です。

-   Batch create
-   ComfyJob create
-   Generation ingest

ネットワークエラー後の再送で重複レコードを作らないこと。

Generation ingest はGeneration ID / R2
keyを決定的に扱い、R2成功・D1失敗等から再実行可能にします。
