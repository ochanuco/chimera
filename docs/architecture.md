# Architecture

## System Context

chimera は Generation Experiment Orchestrator です。semantic
な判断主体は Claude Code / Agent / Human のいずれでもよく、ComfyUI
workflow の構築・実行責務は chagama に残します。chimera
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
  └── Management API         resolution / Job / ingest / semantic

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
-   素材参照（Reference）と仕上げ元の意味を決定する。
-   必要に応じて生成画像を検品する。
-   `request.json` を組み立て、chimera の requests キューに積む。
-   後から Generation の semantic metadata を生成・更新する。
-   Experiment の override を提案・変更する。
-   evaluation・decision を記録する。
-   Promotion を提案する。

recipe のコードは直接書き換えません。chagama への反映は
Promotion として提案し、実際のコード変更は別途 chagama
側のPRとして行われます。

### worker（comfy-recipes）

実行と記録を担当します。semantic な意味を極力解釈しません。GPU 機で
`comfy-recipes watch` が requests 行を claim して動きます。

-   requests 行を claim し、`request.json` を検証する。
-   `recipe_ref` の recipe を checkout する。
-   pin された Preset の版を chimera から解決し、patches を畳んで受領時 lint をかける。
-   Management API に解決済みの値（resolution）を報告し、Job を作成する。
-   seed を生成する（明示 override がなければ）。
-   ComfyUI に Job を enqueue する。
-   ComfyUI Job ID、seed、output を記録する。
-   生成画像を Management API へ ingest する。
-   Discord へ Generation ID / canonical URL と画像を通知する。
-   リトライ・冪等性を担保する。
-   redraw（絵を変える1操作）/ deliver（切り抜きと飾り）などを requests 行から受けて実行する。

### Management API

-   D1 の整合性を管理する。
-   R2 へ画像を保存する。
-   Request / Generation / Tag 等を永続化する。
-   Experiment / ExperimentRun / Promotion を永続化し、提供する。
-   requests キュー（claim / heartbeat / 状態遷移）を提供する。判断はしない。
-   Preset（承認済み Generation から昇格した派生）の正本を持ち、版を管理する。base の
    pose 本文は chagama 側に残り、chimera は参照と patches だけを持つ。
-   canonical URL と Claude 向け semantic context を提供する。
-   Web GUI の Read / Mutation API を提供する。
-   LLM 固有処理は持たない。

### Web GUI

-   Gallery / Generation を画像中心で閲覧する。
-   Character / Tag / Date / Rating / Bookmark で検索する。
-   Tag / Rating / Bookmark / Note を編集する。
-   Provenance（親・子・兄弟）を必要なときだけ表示する。
-   複数 Generation の比較と Claude へ渡す参照情報の作成を支援する。
-   Experiment 一覧・詳細を閲覧する。
-   semantic 判断を伴わない再実行（redraw / deliver）を requests 行として積む。
-   リロール（[ui.md](ui.md#リロール)）: 元絵の generate payload を seed だけ変えて 4 枚振り直す
    `kind = generate` を requests 行として積む。recipe も prompt も触らない。
-   絵柄チェック（[ui.md](ui.md#絵柄チェック)）: 全ポーズの pin のドリフトを一覧し、pin を今のカタログ既定で
    もう一度描く plain render を requests 行として積む。結果を good にして pin を差し替えることもできる。GUI は prompt を書かない。
    `/check?sweep=` は MCP `sweep_patch` が積んだ pose ごとの Run の結果を pin の隣に出すだけで、GUI は patches を書かない。
-   参考画像（[ui.md](ui.md#参考画像references)）: 画像を渡して解析の `kind = reference` を、解析結果の候補から選んだタグ・pose・seed で
    `kind = reference_render` を requests 行として積む。GUI は prompt を書かず、選べるのは worker が抽出した候補だけ。generate を組むのは worker。

chimera は ComfyUI へ到達しません。GUI が積んでよいのは semantic
判断を伴わない再実行（redraw / deliver / saturation / stage / lighting / dof）と、リロール、pin の再描画（絵柄チェック）、参考画像の
reference / reference_render だけで、GUI が
触るのは自分の D1 の requests 行と、写真ページ（[ui.md](ui.md#写真photos)）とワークベンチの背景フェーズがアップロードする写真（`kind = import`
の Request・Job・Generation と R2 の original）と、参考画像ページがアップロードする参考画像（R2 の `references/{request_id}`）のみです。

## Storage

### D1

構造化メタデータの正本です。

主な対象:

-   Experiment
-   ExperimentRun
-   ExperimentPromotion
-   Request（worker キュー）
-   ComfyJob
-   Generation
-   Character
-   Tag
-   素材参照（request_references）
-   Rating / Bookmark / Note / Semantic metadata

### R2

生成画像の正本です。

推奨 object key:

``` text
generations/{generation_id}/original.png
generations/{generation_id}/original.webp
generations/{generation_id}/preview.webp
generations/{generation_id}/preview-cutout.webp
references/{request_id}
```

ComfyUI の filename は object key に利用せず、DB 上の metadata
として保存します。

`preview.webp`（長辺1024px以下）は `GET /g/{short_id}/preview` への初回リクエスト時に
original から生成・保存されるサムネイルで、正本ではありません。
cutout asset（role `cutout`、region 空）を持つ Generation は、original（緑背景の絵）ではなく
cutout から作った透明の WebP を別 key の `preview-cutout.webp` に保存し、`/preview` はそちらを返します
（cutout が付く前に保存済みの `preview.webp` は消さず、使わなくなるだけです。cutout を差し替えると
`preview-cutout.webp` を消して次の要求で作り直します）。worker は ingest の後に asset を付けてから
request を終えるため、生成元の request が `done` / `failed` / `cancelled` になるまでの `/preview` は
`Cache-Control: no-store` で返し、ブラウザに緑背景の preview を残しません。GUI/API の
サムネイル用途はすべてこちらを指します（`docs/api.md`「Generation Search」）。

`original.png` は削除しません（redraw / deliver が元の絵の original を読むため）。
過去に削除済みの行は `original_purged_at` が非 NULL のまま、preview で表示されます。

`references/{request_id}` は例外で、消すための一時領域です。kind `reference` の Request の参考画像を
`POST /api/v1/references` が置き（D1 INSERT → R2 PUT の順）、worker が読み終えたら消します。chimera も
その Request が done / failed / cancelled になった時点で消し（retry で queued に戻るときは残す）、
cron trigger `0 * * * *` の `scheduled` ハンドラが置かれてから 24 時間を過ぎたものを消します
（`src/lib/reference-images.ts`）。参考画像は Generation にならず、画像そのものもハッシュも D1 に残しません
（[worker-protocol.md「reference」](worker-protocol.md#reference)）。

ingest が保存する original は `original.png` です。古い Generation には lossless WebP の
`original.webp` を original に持つものがあり、original を読む側は両方を受け付けます
（`docs/domain-model.md`「original の保持」）。

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
Request     UUIDv7
ComfyJob    UUIDv7
Generation  UUIDv7
Experiment  UUIDv7
```

UI / Discord / Claude で扱いやすい short ID を別途持ち、canonical URL
に利用できます。

``` text
/g/abc123
/b/def456    # Request の short_id。最初の Generation の /g/ へリダイレクト
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
  ↓ GitHub Actions の deploy workflow を手動実行（ref: main または main 上の SHA）
Environment production の承認
  ↓ scripts/deploy.sh production（wrangler deploy）
chimera.chanu.co
```

PR ごとの preview は Cloudflare Workers Builds の Preview Builds が作ります。Workers Builds の
production build は `wrangler versions upload` でバージョンを上げるだけで、本番へは反映しません。
D1 migration はデプロイでは適用せず、migration を含む PR ごとに手で適用します。
rollback は Cloudflare の Workers versions から前バージョンを選ぶか、main を戻して再デプロイします。

`recipe_ref` の既定（wrangler var `REQUESTS_DEFAULT_RECIPE_REF`）は `production` です。
chagama 側の box は `production` を checkout して動きます
（[worker-protocol.md](worker-protocol.md)）。
