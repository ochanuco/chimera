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
```

Agent は `create_run` を呼ぶたびに意図した Run 1件につき1つの `idempotency_key`
を生成して渡すべきです。Run は削除できないため、レスポンスを失ってから
キーなしで再試行すると重複 Run が恒久的に残ります。

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
