# Use Cases

## UC-01: Seed違いで9枚生成する

人間:

``` text
結月ゆかりをseed違いで9枚作って
```

Claude Code は prompt を構築し `request.json` を作成します。

Python CLI:

1.  Requestの解決済みの値（recipe / parameters / 素材参照など）を報告
2.  seedを9件生成
3.  ComfyJobを9件作成（Requestに紐づく）
4.  ComfyUIへ順にenqueue
5.  各outputを取得
6.  R2へ保存
7.  Generationを9件登録
8.  Discordへ通知

結果:

``` text
Request R001
├─ Job J001 → G001
├─ Job J002 → G002
...
└─ Job J009 → G009
```

## UC-02: Seed違いGenerationをマッシュアップする

人間:

``` text
abc123 のポーズと xyz987 の服装を採用して9枚
```

Claude は canonical URL / context から semantic 情報を取得し prompt
を再構成します。

``` text
G abc123 -- pose ----\
                      > Request R002
G xyz987 -- outfit --/
```

R002には素材参照（request_references）が2件登録されます。

## UC-03: 3件以上をマッシュアップする

``` text
A -- pose --------\
B -- outfit -------+
C -- expression ---+--> Request X
D -- style --------/
```

Reference は `1..m` 件を許可します。親を2件に限定しません。

## UC-04: Claudeが自動的に再試行する

Claude が生成結果を検品し、改善が必要と判断します。

`derive_request` で前の Generation を素材参照にして、改善した Request を新しく積みます。

``` text
G001 -- 素材参照 --> Request R002
```

R001とR002は別Requestです。再試行専用の関係は持たず、素材参照で辿れます。

途中試行を削除せず、生成履歴として保持します。

## UC-05: 人間の追加指示で再試行する

人間:

``` text
もう少し表情を柔らかくして
```

Claude自動再試行と同じ経路で、改善した Request を新しく積みます。積んだのが人間の指示かClaudeの判断かは
Request の `created_by` で区別します。

## UC-06: 古いGenerationを現在の絵柄へrebuildする

過去Generationを検索します。

条件例:

``` text
character = 結月ゆかり
tag = outfit-good
date = 2026-01..2026-05
```

過去Experimentを再開せず、新しいRequestから過去Generationを参照します。

``` text
Old G123 -- purpose=reference / aspect=outfit --> New Request
```

現在の Python recipe / prompt
とマッシュアップし、最新の絵柄へ更新します。

## UC-10: Generationを検索してClaudeへ渡す

主な検索軸:

-   Character
-   Tag
-   Date
-   Rating
-   Bookmark

検索結果には canonical URL を含めます。

人間はClaudeへURLを渡すだけでGenerationを参照できます。

## UC-11: Generationを後からsemantic解析する

生成時にClaude検品をしなかったGenerationでも、Web GUI / Claude
Codeから後で画像を解析します。

生成対象:

-   summary
-   pose
-   expression
-   outfit
-   style
-   composition
-   strengths
-   defects
-   attributes

semantic schema は version 管理します。

## UC-12: 失敗画像を残す

Generationを原則物理削除しません。

例:

``` text
rating = bad
tags = [bad-hand, reject]
```

ComfyUI JOB IDとの対応と生成履歴を維持します。

## UC-13: Bookmarkする

Generation / Experiment を Bookmark できます。

Bookmark は品質評価ではなく「後から素早く呼び出す」ための導線です。

## UC-14: ComfyUI Job ID / filenameから逆引きする

既存の会話に以下のような参照が残っている場合:

``` text
JOB ID a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df
file yk-lineT3_00001_.png
```

`comfy_prompt_id` + `original_filename`
等からGenerationを検索できるようにします。

## UC-15: overrideを変えながら検証を反復する

人間 / Claude / Agent いずれかが検証テーマとして Experiment
を作成し、override を変えた Run の生成、評価、decision の記録を繰り返します。
次の Run は decision を踏まえて `parent_run_id` に前 Run を指定して作り、安定するまで繰り返します。

1周の流れは [experiment-agent.md「1サイクル」](experiment-agent.md#1サイクル)、
各エンドポイントは [api.md](api.md) を参照してください。

## UC-16: 安定した条件をcomfyui-recipesへ昇格する

反復の結果、条件が安定したらExperimentを`stabilized`にします。

``` text
PATCH /api/v1/experiments/{id}
```

``` json
{ "status": "stabilized" }
```

安定したRunをsource_run_idに指定し、Promotionを作成します。

``` text
POST /api/v1/experiments/{id}/promotions
```

comfyui-recipes側への反映後、commit SHA / PR URLを記録し、applied
に確定します。

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

## UC-17: AgentがExperimentサイクルを回す

Agent が Git リポジトリへの書き込み権限を持たなくても、過去 Run の読み取りから
Run の作成、生成結果の紐付け、evaluation / decision の記録、必要なら Promotion の提案
（`POST /api/v1/experiments/{id}/promotions`）までが chimera だけで完結します。

手順は [experiment-agent.md「1サイクル」](experiment-agent.md#1サイクル)、
Agent に許さない操作は [「生やさない操作」](experiment-agent.md#生やさない操作) を参照してください。
