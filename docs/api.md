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

`graph` を伴う PATCH は、そのグラフから `render_facts`（version 2:
checkpoint / models（clip/vae） / sampler ごとの steps・cfg・denoise・seed・
prompt・latent / canvas / lora / controlnet / seed / output の構造化ファクト）
を抽出し `render_facts_json` に保存します。抽出ルール（`src/lib/render-facts.ts`）:

-   `version`: 抽出ロジックのバージョン。現在は `RENDER_FACTS_VERSION = 2`
-   `checkpoints`: `CheckpointLoaderSimple.inputs.ckpt_name` /
    `DiffusersLoader.inputs.model_path` / `UNETLoader.inputs.unet_name` を
    node id 順にすべて拾う（chain_pass のように複数チェックポイントを経由する
    グラフでは複数件になる）
-   `models`: `clip` は `CLIPLoader.inputs.clip_name` /
    `DualCLIPLoader.inputs.clip_name1`/`clip_name2` を node id 順にすべて拾う。
    `vae` は最初の `VAELoader.inputs.vae_name`
-   `samplers`: 全 `KSampler` / `KSamplerAdvanced` を node id 順に
    （`KSamplerAdvanced` は `denoise` を持たないので常に `null`）。各サンプラーは
    以下も持つ:
    -   `seed`: `KSampler.inputs.seed` / `KSamplerAdvanced.inputs.noise_seed`
    -   `prompt.positive` / `prompt.negative`: `inputs.positive` /
        `inputs.negative` をグラフに沿って解決したテキスト（深さ8まで、循環
        ガード付き）。`CLIPTextEncode` なら `inputs.text`
        （それ自体が参照なら1ホップだけ追って `inputs.text` /
        `inputs.value` / `inputs.string` を持つノードを見る）、
        `ControlNetApply` / `ControlNetApplyAdvanced` なら
        `inputs.conditioning`（Apply）または同じ極性の
        `inputs.positive`/`inputs.negative`（Advanced）、
        `ConditioningCombine` / `ConditioningConcat` /
        `ConditioningSetArea*` / `ConditioningSetTimestepRange` なら
        `inputs.conditioning_1`（無ければ `conditioning_to` /
        `conditioning`）を辿って再帰する。解決できなければ `null`
    -   `latent`: `inputs.latent_image` の解決結果。`EmptyLatentImage` なら
        `{kind:'empty', width, height}`、`LatentUpscale` /
        `LatentUpscaleBy` なら `{kind:'latent_upscale', ...}`、`VAEEncode`
        の `pixels` が `ImageScale` / `ImageScaleBy` なら
        `{kind:'image_upscale', ...}`。`upscale_method` /
        `scale_by`（`*By` 系のみ）に加えて、`samples` /
        `image` / `images` / `pixels` / `latent_image` を遡って見つけた
        直前の `KSampler`/`KSamplerAdvanced` の node id を `from_node_id`
        として持つ（複数passのチェーンを辿るのに使う）。認識できないノードは
        `{kind:'other', ...}`（それでも `from_node_id` は求める）、
        latent_image 自体が解決できなければ `null`
-   `canvas`: 最初の `EmptyLatentImage` の width/height と、`LatentUpscale` /
    `ImageScale`（リテラル）または `LatentUpscaleBy` / `ImageScaleBy`
    （`scale_by` 倍、四捨五入）のうち node id が最後のノードから求めた
    `final_size`
-   `loras`: 全 `LoraLoader` / `LoraLoaderModelOnly` を node id 順に
-   `controlnets`: 全 `ControlNetApplyAdvanced` / `ControlNetApply` を node id
    順に、`inputs.control_net` 参照（解決できなければ node id 順の位置対応）で
    `ControlNetLoader` の名前を引く。apply されていない Loader も
    strength null で1件として出す
-   `seed`: 最初の `KSampler.inputs.seed` または
    `KSamplerAdvanced.inputs.noise_seed`
-   `output.filename_prefix`: 最初の（node id 順）`SaveImage.inputs.filename_prefix`

ノード入力値が他ノードへの参照 `[node_id, output_index]` の場合、スカラー欄では
`null` 扱いになります（値そのものを解決するのは controlnet の参照 /
sampler ごとの prompt・latent だけ）。

`render_facts_json` は遅延抽出のキャッシュです。`NULL`、または保存されている
`version` が現在の `RENDER_FACTS_VERSION` 未満（v1 キャッシュのように
`version` フィールド自体が無い場合を含む）は「未抽出」を意味し、graph はある
がfactsがまだ無い（または古い）行は最初の読み取り時（Generation detail /
Batch detail / Experiment run のいずれか）に抽出してその場で書き戻します。

`render_facts` は以下の箇所に現れます:

-   `GET /api/v1/generations/{id}` の `comfy_job.render_facts`（同じレスポンスの
    `comfy_job.graph` は投稿された prompt グラフ全体、`batch.negative_prompt`
    は所属 Batch の negative prompt — どちらも `/g/` の Workflow セクション
    が「グラフから再現できる形」を組み立てる材料）
-   `GET /api/v1/batches/{id}` の各 `jobs[].render_facts`
-   ExperimentRun（`GET /api/v1/experiments/{id}` の `runs[]` /
    `GET /api/v1/experiments/{id}/runs` / `GET /api/v1/experiment-runs/{id}` /
    MCP `get_experiment` / `get_run`）の `render_facts`。Run の Batch に
    紐づく Job のうち、`job_index` が最小で graph を持つものから解決します

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
  "overrides": {
    "patches": [
      { "target": "prompt.positive", "op": "append", "value": ", light purple thighhigh socks", "reason": "ソックスの縁を明示する" }
    ]
  },
  "objective": "ソックスとタイツの境界を明確にする",
  "parent_run_id": "...",
  "idempotency_key": "..."
}
```

`batch_id` / `generation_id` はUUID / short_idのどちらでも受けます。`run_index`
は Experiment 内で自動採番されます。

`idempotency_key` は省略可能です。渡した場合、同じキーの再送は新規作成せず既存
Run を返します（新規作成は201、再送は200）。同じキーを別の Experiment へ渡すと
409です（そのキーは既に他所で使われています）。

`overrides` は `{}` か `{"patches": [...]}` のどちらかで、それ以外のキーが
トップレベルにあると400です。各 patch は `target` / `op` / `reason`
を持つオブジェクトで、いずれも非空文字列である必要があります（`value` /
`old` の有無・型は検証しません）。`pose` / `costume` のような生成パラメータは
overrides ではなく Experiment の `base_parameters` に属します。同じ検証は
PATCH /api/v1/experiment-runs/{id} と Promotion の `promoted_overrides`
にも適用されます。

`variables` は省略可能な、キー文字列 → `string | number` のフラットな
マップです（ネストしたオブジェクト・配列・真偽値・null は400）。プロンプトの
バリアント名など、グラフからは読み取れない要因を CLI / 人間が書き添えるための
注記で、`overrides` と違い Batch / Generation を attach した後でも
PATCH /api/v1/experiment-runs/{run_id} で変更できます（`variables: null`
でクリア）。Experiment View の facts テーブルでは `variables.<key>` という
追加列として表示されます。

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
/ `decision` / `variables` は明示nullでクリアできます。

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

## PairwiseJudgment

同じseedのbaseline run / arm runの生成結果を人間が盲検で対比較した結果です。
Web GUIの `/experiments/{id}/ab` (A/B Judge View, [ui.md](ui.md#a-b-judge-view)参照)
から作られます。

### Create Judgment

``` text
POST /api/v1/experiments/{id}/judgments
```

``` json
{
  "baseline_run_id": "...",
  "arm_run_id": "...",
  "seed": 12345,
  "left_generation_id": "...",
  "right_generation_id": "...",
  "verdict": "right"
}
```

`left_generation_id` / `right_generation_id`
はA/B画面が表示時にランダムに割り当てた向きで、`verdict`
はその向きに対する回答（`left` / `right` / `tie`）です。レスポンスは以下を返します。

``` json
{
  "id": "...",
  "experiment_id": "...",
  "baseline_run_id": "...",
  "arm_run_id": "...",
  "seed": 12345,
  "left_generation_id": "...",
  "right_generation_id": "...",
  "verdict": "right",
  "winner": "arm",
  "judged_at": "...",
  "reveal": {
    "left": { "run_id": "...", "run_index": 1, "role": "baseline" },
    "right": { "run_id": "...", "run_index": 2, "role": "arm" },
    "render_diff": [
      { "column": "checkpoint", "baseline": "yukari-v3", "arm": "yukari-v4" },
      {
        "column": "positive",
        "baseline": "1girl, outdoors",
        "arm": "1girl, outdoors, smiling",
        "delta": "+smiling"
      },
      { "column": "variables.prompt_variant", "baseline": null, "arm": "socks-v2" }
    ]
  }
}
```

`winner`は`verdict`と各Generationの所属batchから導いた`baseline` / `arm` /
`tie`です（`left_generation_id` / `right_generation_id`自体は向きを覚えているだけで、
どちらがbaselineかは表現しません）。

`reveal` は判定後（このレスポンスと、Judgment Summary の
`pairs[].render_diff`）にだけ現れます。A/B画面自体は判定前に確定情報を
一切埋め込みません（盲検を保つため）。`render_diff` は baseline run /
arm run それぞれの render_facts サマリ（`RENDER_FACT_COLUMNS` に続けて
`positive` / `negative`（pass 1 の prompt テキスト）、`variables` は
`variables.<key>` という列名で合流）を比較し、値が異なる列だけをこの順で
返します（`src/lib/render-facts.ts` の `diffFactSummaries`）。`positive` /
`negative` の列は `baseline` / `arm` の生テキストに加えて、
`promptDelta`（`src/lib/render-facts.ts`）が作るコンパクトなトークン差分を
`delta` に持ちます（追加トークンは `+token`、削除は `-token`、重み変化は
`w:(token before→after)`、両セクションは ` · ` で連結。差分が無ければ
`delta` フィールド自体を省略）。

400のケース:

-   `baseline_run_id` と `arm_run_id` が同じ
-   `baseline_run_id` / `arm_run_id` が別のExperimentのRun
-   baseline run と arm run が同じ batch を指している
-   `left_generation_id` / `right_generation_id`
    がbaseline runのbatchとarm runのbatchから一つずつになっていない
-   `left_generation_id` / `right_generation_id` の `seed` が `seed` フィールドと一致しない

409のケース:

-   `baseline_run_id` / `arm_run_id` のいずれかに `batch_id` が付いていない
-   同じ `(baseline_run_id, arm_run_id, seed)` に対する2回目のjudgment

### List Judgments

``` text
GET /api/v1/experiments/{id}/judgments
```

``` json
{ "items": [ /* Create Judgmentのレスポンスと同じ形の配列, judged_at昇順 */ ] }
```

### Judgment Summary

``` text
GET /api/v1/experiments/{id}/judgments/summary
```

``` json
{
  "pairs": [
    {
      "baseline_run_id": "...",
      "baseline_run_index": 1,
      "arm_run_id": "...",
      "arm_run_index": 2,
      "win": 3,
      "loss": 1,
      "tie": 0,
      "total": 4,
      "render_diff": [
        { "column": "checkpoint", "baseline": "yukari-v3", "arm": "yukari-v4" }
      ]
    }
  ],
  "runs": [
    {
      "run_id": "...",
      "run_index": 1,
      "batch_id": "...",
      "generation_count": 9,
      "rating": { "good": 4, "neutral": 3, "bad": 0, "unrated": 2 }
    }
  ]
}
```

`win` / `loss` / `tie` はarmから見た結果（`win` =
armが選ばれた数）です。`pairs`は実際にjudgmentがあるbaseline/armの組だけを持ちます。`runs`は
Experimentの全Run（`batch_id`未attachのRunも`generation_count: 0`
で含む）で、`rating`はそのRunのbatchに属する全Generationの評価内訳です（未評価は
`unrated`）。

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

ExperimentRun create の `idempotency_key` は任意です。Run
は物理削除できないため、Agent
がレスポンスを失って作成の成否が分からなくなった場合の再送手段として使います。
人間がGUIから作る場合や一回限りのcurlなど、再送保護を必要としない経路も
引き続きキーなしで使えるようにするため、他の3つと異なり必須にはしません。
