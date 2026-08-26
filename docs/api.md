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
  "comfy_prompt_id": "a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df"
}
```

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
  "name": "浜風",
  "aliases": []
}
```

CLI / Claude は name で GET
して既存を解決し、なければ作成してから id を使います。

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
    "name": "浜風"
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
character=hamakaze
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
