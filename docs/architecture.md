# Architecture

## System Context

``` text
Human
  ↓
Claude Code
  ↓ request.json
Python CLI / comfyui-recipes
  ├── ComfyUI API
  └── Management API
        ├── D1
        └── R2
             ↓
          Web GUI

Management API
  ↓ canonical URL
Discord
```

## Responsibilities

### Human

-   Claude Code と自然言語で対話する。
-   Discord / Web GUI で生成結果を確認する。
-   Rating、Tag、Bookmark、Note を必要に応じて編集する。
-   複数 Generation の「ポーズ」「服装」などを選択し、Claude
    に再生成を依頼する。

### Claude Code

semantic な判断を担当します。

-   人間の生成意図を解釈する。
-   Generation canonical URL / context API を参照する。
-   過去 Generation の pose / outfit / style 等を選択する。
-   prompt を組み立てる。
-   Story transition、Batch refinement、Reference の意味を決定する。
-   必要に応じて生成画像を検品する。
-   `request.json` を生成し Python CLI を実行する。
-   後から Generation の semantic metadata を生成・更新する。

### Python CLI

実行と記録を担当します。semantic な意味を極力解釈しません。

-   `request.json` を検証する。
-   Management API に Batch を作成する。
-   seed を生成する（明示 override がなければ）。
-   ComfyUI に Job を enqueue する。
-   ComfyUI Job ID、seed、output を記録する。
-   生成画像を Management API へ ingest する。
-   Discord へ Generation ID / canonical URL と画像を通知する。
-   リトライ・冪等性を担保する。

### Management API

-   D1 の整合性を管理する。
-   R2 へ画像を保存する。
-   Generation / Batch / Story / Tag 等を永続化する。
-   canonical URL と Claude 向け semantic context を提供する。
-   Web GUI の Read / Mutation API を提供する。
-   LLM 固有処理は持たない。

### Web GUI

-   Gallery / Batch / Generation を画像中心で閲覧する。
-   Character / Tag / Date / Rating / Bookmark で検索する。
-   Tag / Rating / Bookmark / Note を編集する。
-   Story / Provenance を必要なときだけ表示する。
-   複数 Generation の比較と Claude へ渡す参照情報の作成を支援する。

## Storage

### D1

構造化メタデータの正本です。

主な対象:

-   Experiment
-   Batch
-   ComfyJob
-   Generation
-   Character
-   Tag
-   BatchReference
-   BatchRelation
-   Story
-   StoryRelation
-   Rating / Bookmark / Note / Semantic metadata

### R2

生成画像の正本です。

推奨 object key:

``` text
generations/{generation_id}/original.png
```

ComfyUI の filename は object key に利用せず、DB 上の metadata
として保存します。

## Ingest Flow

``` text
ComfyUI generation completed
  ↓
Python retrieves image
  ↓
Management API ingest
  ├── R2 PUT
  └── D1 Generation registration
  ↓
canonical URL becomes available
  ↓
Discord notification
```

R2 と D1 は単一トランザクションにはできないため、Generation ID / R2 key
を先に確定させ、再実行可能にします。

## Identity

内部 ID は UUIDv7 を使用します。

``` text
Batch       UUIDv7
ComfyJob    UUIDv7
Generation  UUIDv7
Story       UUIDv7
Experiment  UUIDv7
```

UI / Discord / Claude で扱いやすい short ID を別途持ち、canonical URL
に利用できます。

``` text
/g/abc123
/b/def456
```

ComfyUI の prompt/job ID は外部識別子として保持します。

## Authentication

Cloudflare Access を境界認証として利用します。

-   Human / Web GUI: Cloudflare Access login
-   Python CLI: Cloudflare Access Service Token
-   アプリ独自のユーザー認証は実装しない

Service Token は Git 管理せず、ローカル secret として扱います。

## Deployment Boundary

MVPでは Cloudflare Workers + D1 + R2 を前提とします。

GUI/API を単一 Worker
にまとめるか分離するか、具体的なフレームワーク選定は実装フェーズで決定可能です。ただし、上記の責務境界は維持します。
