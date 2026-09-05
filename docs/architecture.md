# Architecture

## System Context

chimera は Generation Experiment Orchestrator です。semantic
な判断主体は Claude Code / Agent / Human のいずれでもよく、ComfyUI
workflow の構築・実行責務は comfyui-recipes に残します。chimera
は Experiment / provenance / evaluation / decision / promotion
を管理します。

``` text
Human
  ↓
brain（semantic 判断主体: Claude Code / Agent / Human）
  ↓ request.json を requests 行として積む      ← brain は chimera としか話さない
chimera = control plane
  Management API ──── D1（requests キュー / Experiment / provenance）
       │          └── R2
       │  Web GUI / MCP
       │  WorkerHub（Durable Object）── WebSocket push / 進捗中継（段階 3、正本は D1 のまま）
       ▲ claim / heartbeat / done（段階 2 は poll、段階 3 は WorkerHub の WebSocket）
       │
worker（GPU 機）
  comfy-recipes watch
  ├── ComfyUI localhost      ← worker からしか到達できない
  └── Management API         Batch / Job / ingest / semantic

Management API
  ↓ canonical URL
Discord
```

Mac から ComfyUI への経路は LAN でも持ちません。契約は
[worker-protocol.md](worker-protocol.md) にあります。

## Responsibilities

### Human

-   semantic 判断主体（Claude Code / Agent）と自然言語で対話する。
-   Discord / Web GUI で生成結果を確認する。
-   Rating、Tag、Bookmark、Note を必要に応じて編集する。
-   複数 Generation の「ポーズ」「服装」などを選択し、再生成を依頼する。

### semantic 判断主体（Claude Code / Agent / Human）

semantic な判断を担当します。

-   人間の生成意図を解釈する。
-   Generation canonical URL / context API を参照する。
-   過去 Generation の pose / outfit / style 等を選択する。
-   prompt を組み立てる。
-   Story transition、Batch refinement、Reference の意味を決定する。
-   必要に応じて生成画像を検品する。
-   `request.json` を組み立て、chimera の requests キューに積む。
-   後から Generation の semantic metadata を生成・更新する。
-   Experiment の override を提案・変更する。
-   evaluation・decision を記録する。
-   Promotion を提案する。

recipe のコードは直接書き換えません。comfyui-recipes への反映は
Promotion として提案し、実際のコード変更は別途 comfyui-recipes
側のPRとして行われます。

### worker（comfy-recipes）

実行と記録を担当します。semantic な意味を極力解釈しません。GPU 機で
`comfy-recipes watch` が requests 行を claim して動きます。

-   requests 行を claim し、`request.json` を検証する。
-   `recipe_ref` の recipe を checkout する。
-   Management API に Batch を作成する。
-   seed を生成する（明示 override がなければ）。
-   ComfyUI に Job を enqueue する。
-   ComfyUI Job ID、seed、output を記録する。
-   生成画像を Management API へ ingest する。
-   Discord へ Generation ID / canonical URL と画像を通知する。
-   リトライ・冪等性を担保する。
-   finalize（納品用の再実行）を requests 行から受けて実行する。

### Management API

-   D1 の整合性を管理する。
-   R2 へ画像を保存する。
-   Generation / Batch / Story / Tag 等を永続化する。
-   Experiment / ExperimentRun / Promotion を永続化し、提供する。
-   requests キュー（claim / heartbeat / 状態遷移）を提供する。判断はしない。
-   canonical URL と Claude 向け semantic context を提供する。
-   Web GUI の Read / Mutation API を提供する。
-   LLM 固有処理は持たない。

### Web GUI

-   Gallery / Batch / Generation を画像中心で閲覧する。
-   Character / Tag / Date / Rating / Bookmark で検索する。
-   Tag / Rating / Bookmark / Note を編集する。
-   Story / Provenance を必要なときだけ表示する。
-   複数 Generation の比較と Claude へ渡す参照情報の作成を支援する。
-   Experiment 一覧・詳細を閲覧する。
-   semantic 判断を伴わない再実行（finalize）を requests 行として積む。

chimera は ComfyUI へ到達しません。GUI が積んでよいのは semantic
判断を伴わない再実行（finalize）だけで、GUI が触るのは自分の D1 の requests
行のみです。

## Storage

### D1

構造化メタデータの正本です。

主な対象:

-   Experiment
-   ExperimentRun
-   ExperimentPromotion
-   Request（worker キュー）
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

Experiment の short ID は `/experiments/{short_id}` の形で使います。

ComfyUI の prompt/job ID は外部識別子として保持します。

## Authentication

Cloudflare Access を境界認証として利用します。

-   Human / Web GUI: Cloudflare Access login
-   worker（comfy-recipes）: Cloudflare Access Service Token
-   アプリ独自のユーザー認証は実装しない

Service Token は Git 管理せず、ローカル secret として扱います。

## Deployment Boundary

MVPでは Cloudflare Workers + D1 + R2 を前提とします。

GUI/API を単一 Worker
にまとめるか分離するか、具体的なフレームワーク選定は実装フェーズで決定可能です。ただし、上記の責務境界は維持します。

## Release Path

``` text
PR → main（ruleset: PR 必須、merge commit のみ、削除 / force push 禁止）
  ↓ push ごとに production release PR workflow
release/production := main の tree の snapshot
  ↓ 昇格 PR（ruleset: approval 1 + code owner + thread 解決 + required check "production deploy preflight"）
production
  ↓ Cloudflare Workers Builds（migrations apply → wrangler deploy）
chimera.chanu.co
```

昇格 PR の作成者は GitHub App（`APP_ID` / `APP_PRIVATE_KEY`）で、CODEOWNER が自分自身でも
self-approve の制限に当たらないようにします。`production` は昇格 PR の merge でしか
動かず、`release/production` は毎回作り直されるので release commit が main に戻ることは
ありません。rollback は Cloudflare の Workers versions から前バージョンを選ぶか、main を
戻して再昇格します。

`recipe_ref` の既定（wrangler var `REQUESTS_DEFAULT_RECIPE_REF`）は comfyui-recipes 側の
box が `production` を checkout した時点で `main` から `production` に戻します
（[worker-protocol.md](worker-protocol.md)）。
