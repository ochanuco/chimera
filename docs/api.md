# Management API

## Principles

APIは以下の利用者を想定します。

``` text
Python CLI  → Write / ingest
Claude Code → Read context / semantic update
Web GUI     → Read / user mutation
```

認証はCloudflare Accessで行い、アプリ独自認証は実装しません。

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
  "references": []
}
```

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
