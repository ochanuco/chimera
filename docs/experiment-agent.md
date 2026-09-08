# Experiment Agent

Cloudflare OS 上の Agent が Experiment サイクルを回すための接続設計です。

PoC の目標は1サイクルを閉じることに絞ります。

``` text
Experiment → Run → override 決定 → ComfyUI 生成 → evaluation → decision
```

## 制約から導かれる構成

Cloudflare OS のサーバー側 Agent は Dynamic Worker 上で外部ネットワークを無効化された状態で動きます。`https://chimera.chanu.co` を直接 fetch する経路はありません。用意されている入口は型付きバインディングと MCP サーバーの2つで、外部アプリを繋ぐ場合は後者を使います。

権限は Gatekeeper が仲介します。Agent は権限ゼロから始まり、リソースと操作ごとに管理者が許可します。資格情報は Agent と生成コードから分離されます。

``` text
Cloudflare OS
  Agent Workspace
    └── MCP: chimera ──Gatekeeper──▶ chimera Worker /mcp
                                        └── D1 / R2

ComfyUI 実行機
  runner  ──REST + Access Service Token──▶ chimera /api/v1/*
     └── comfy-recipes generate ──▶ ComfyUI
```

Agent は生成を起動しません。Run を作るところまでを担当し、実行機がそれを拾います。Agent の外部ネットワークが無効である以上ここは分離するしかなく、「chimera は ComfyUI へ生成要求を送らない」という既存の不変条件とも一致します。

## 責務

  主体               持つもの                                                              持たないもの
  ------------------ --------------------------------------------------------------------- ----------------------------------------------
  chimera            Experiment / Run / evaluation / decision / promotion。MCP は既存ドメインの別インターフェース   ComfyUI workflow の詳細
  comfyui-recipes    recipe、workflow 構築、override 適用、ComfyUI 実行                     Experiment の意味論、評価履歴
  runner             overrides と parameters を持つ Run を実行して結果を返すこと            evaluation / decision / promotion / ライフサイクル
  Agent              override の決定、評価、次の一手                                        Git 書き込み、recipe の変更、履歴の破壊

runner が Run について知るのは機械的な範囲に留めます。ここを越えると comfyui-recipes 側に Experiment の意味論が漏れます。

## base_parameters

Experiment は検証中ずっと固定する生成条件を持ちます。

``` json
{ "pose": "lounge", "costume": "default", "count": 3 }
```

Run の `overrides.patches` が変える差分、Experiment の `base_parameters` が固定する土台です。これがないと Run 単体を実行できません。`overrides` に混ぜると差分という概念が濁るため分けます。

chimera は中身を検証しません。`base_recipe` と同じく、語彙は comfyui-recipes のものです。

## base_generation_id

Experiment はさらに、その検証が起点とする Generation を1つ持てます
（`base_generation_id`、nullable）。設定すると、Run 作成時に自動起票される
request.json（下記）に purpose `rebuild` の Reference として自動で乗ります。
Agent が個々の Run で参照を組み立てる必要はありません。

## 未実行 Run

``` text
GET /api/v1/experiment-runs?pending=true
```

`batch_id` が null で、かつ requests 行（status を問わない）を持たない Run を Experiment
横断で返します。

Run は作られた時点で「まだ実行されていない」状態であり、`batch_id` が付いた時点で実行済みになります。この2状態のために別のカラムは持ちません。実行の待機・実行中・失敗は Run ではなく requests 行の status が表します。

runner（worker）の作業キューはこのエンドポイントではなく requests
テーブルです。Run 作成時に chimera が `kind = generate` の requests 行を自動起票し、worker
はそれを claim します（[worker-protocol.md](worker-protocol.md)）。このエンドポイントは
「requests 行が付かなかった Run」（base_recipe の無い Experiment の Run など）を見つける
ための読み取りです。

## MCP サーバー

`/mcp` に stateless な Streamable HTTP エンドポイントを置きます。MCP protocol session も専用の Durable Object も持ちません。

`/api/v1/*` は Python CLI と runner のためにそのまま残します。MCP は同じドメインへの別インターフェースであり、ドメインロジックを二重に持ちません。

認証はアプリ内に実装しません。`/mcp` も Cloudflare Access の内側に置き、Service Token を Gatekeeper が保持します。

### tool

``` text
list_experiments(status?)
get_experiment(id)                       runs / overrides / evaluation / decision 込み
create_run(experiment_id, overrides, objective?, parent_run_id?, idempotency_key?)
get_run(run_id)                          batch と、その batch の generation 一覧
get_generation_image(short_id, width?)
attach_generation(run_id, generation_id)
set_evaluation(run_id, evaluation)
set_decision(run_id, decision)
create_request(kind, payload, recipe_ref?, idempotency_key)
get_request(id)
list_requests(status?, kind?, run_id?)
get_generation(generation_id)            GET /api/v1/generations/{id} と同じ形
list_batch(batch_id)                     jobs / generations (rating・tags・semantic・seed 込み) / references / relations / experiment_run
get_generation_lineage(generation_id, depth?)   Batch 単位の祖先・子孫 (reference / relation 両方)、depth 既定 5・上限 10
derive_request(from_generation_id, instruction, count?, seeds?, parameters?, patches?, replace_patches?, semantic, reference?, idempotency_key, recipe_ref?)
list_catalog(recipe_ref?)                公開済み recipe catalog の要約 (既定 "production")
get_catalog_pose(recipe, pose, recipe_ref?)   単一 pose のフルレコード
```

Run の代表 Generation を選ぶだけでなく、その Generation を見て次の一手を決める段になったら `get_generation` / `list_batch` / `get_generation_lineage` を使います。Experiment を経由しない単発の派生 (「この Generation のポーズを少し変えて3枚」) には `derive_request` を使い、`create_run` は Experiment のサイクルに乗せる場合に使い分けます。

`get_generation` / `list_batch` は REST の `GET /api/v1/generations/{id}` /
`GET /api/v1/batches/{id}` と同じ `src/lib/generations.ts` /
`src/lib/batches.ts` を呼ぶ薄い別窓口です（`list_batch` は UI 向けの
siblings 等を持たない subset）。

`get_generation_lineage` は Batch 単位で祖先・子孫を辿ります。祖先は
「このBatchが材料に使った Generation の Batch」(`via: "reference"`、
`purpose_or_kind` は Reference の purpose) と「このBatchの直接の起点
Batch」(`via: "relation"`、`purpose_or_kind` は BatchRelation の type、
例えば `refinement`) の両方を含み、子孫はその逆方向です。同じ Batch を
二度訪れず、`depth` 段目で階層が尽きればそこで止まります。

`derive_request` は既存の Generation を起点に `kind: "generate"` の
requests 行を積みます。`from_generation_id` が finalize / repair 済みの
Generation なら、その元になった raw の Generation まで遡ってから起点にします
（finalize / repair の Batch は `parameters` が仕上げ payload で generate
parameters ではないため）。起点 Batch の `recipe` / `parameters` /
（起点 Generation の `semantic.attributes.patches` にある）`patches` を
引き継ぎ、`parameters` は上書きマージ、`patches` は既定で追記、
`replace_patches: true` なら丸ごと置き換えます。起点 Batch が recipe を
持たない graph-mode の Batch なら 409 です。`reference` は起点 Generation への
purpose `"derive"` の Reference として payload に載り、遡った場合は指定した
Generation への purpose `"derive"` / aspect `"finalized"` の Reference も
併せて載ります。レスポンスの `derived_from` に、指定した Generation と
実際の起点 Generation の両方（id / short_id）が入ります。

`list_catalog` / `get_catalog_pose` は
[api.md「Recipe Catalog」](api.md#recipe-catalog)で公開する recipe catalog
の読み取り側です。`list_catalog` は pose / costume / expression の名前と
`parameters`、`patches` の語彙、git 情報だけを返し（prompt 本文は含まない）、
特定の pose の中身が要るときだけ `get_catalog_pose` でフルレコードを引きます。
どちらも recipe_ref を省略すると `"production"` を見ます。

Agent は `create_run` を呼ぶたびに意図した Run 1件につき1つの `idempotency_key`
を生成して渡すべきです。Run は削除できないため、レスポンスを失ってから
キーなしで再試行すると重複 Run が恒久的に残ります。

`create_run` の結果は `run.request_id` を含みます。Experiment に `base_recipe`
があり status が active / stabilized なら、Run 作成と同じトランザクションで
requests 行が自動起票され（[worker-protocol.md](worker-protocol.md)
「ExperimentRun 由来の generate」）、その id が入ります。base_recipe が無ければ
`null` で、Agent は `create_request(kind: "generate", ...)` で明示的に積む必要が
あります。`create_request` / `get_request` / `list_requests` は
`POST /api/v1/requests` などと同じ `src/lib/requests.ts` を呼ぶ薄い別窓口で、
`created_by` は `mcp` に固定されます。

この自動起票 payload は、Experiment に `base_generation_id` があれば
`references: [{ generation_id, purpose: "rebuild" }]` を持ちます
（[generation-request.md](generation-request.md#references)）。

`get_generation_image` は元画像そのものではなく、Images binding で縮小・JPEG
再エンコードした画像を返します。MCP クライアント側がレスポンス全体を 1MiB
に制限しており、生成物の元 PNG（1MB 台）は base64 化するとほぼ必ずこの上限を
超えるためです。構図確認には十分な解像度ですが、ピクセル単位の確認には向きません。

`create_run` の `overrides` は `{"patches": [...]}` 形の diff のみを受け付け、
`{"pose": "...", "costume": "...", "count": 1}` のような base_parameters
形のオブジェクトを渡すと400で拒否します（tool error として返ります）。
生成パラメータは Experiment 作成時の `base_parameters` に属し、Run ごとには
変わりません。

生やさないもの:

``` text
Experiment / Run / Promotion の削除
attach 済み Batch / Generation の付け替え
attach 後の overrides 変更
recipe への書き込み
```

Run の代表 Generation は、その Run 自身の Batch に属するものだけを選べます。Batch が未 attach の Run への attach と、別 Batch の Generation の attach はいずれも 409 です。Run 作成時に同じ組を渡す経路にも同じ規則が適用されます。

API 側は同じ操作を 409 / 404 で拒みます。tool として存在しないことと合わせて防御が二重になります。

## 1サイクル

``` text
人間      Experiment を作る（base_recipe / base_parameters / テーマ）

Agent     list_experiments → get_experiment で過去 Run を読む
          override を決めて create_run
              ↓ 未実行 Run として滞留
worker    requests 行を claim → request.json → comfy-recipes generate → ComfyUI
              ↓ done を PATCH、chimera が batch_id を Run へ紐付ける
Agent     get_run で生成物を見る
          get_generation_image で画像を確認
          attach_generation で代表を選ぶ
          set_evaluation / set_decision
              ↓ decision を受けて次の create_run
```

Agent 側は Cloudflare OS のスケジュール実行で再入します。待ち合わせのために chimera 側へ追加するものはありません。

## PoC のスコープ外

``` text
Promotion（1サイクルの外）
Agent による自動反復。1周ごとに人間が確認する
comfyui-recipes への自動 commit / PR 作成
```
