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
    `refinement` と `story` は値の形を問わず受理して無視する（Story と再試行の関係は廃止済み）。

代表的な流れ:

``` text
POST /api/v1/requests                     # 生成リクエスト登録（idempotency_key 必須）
PUT  /api/v1/requests/{id}/resolution     # worker が解決済みの値を報告
POST /api/v1/requests/{id}/jobs           # ComfyJob 登録
POST /api/v1/jobs/{id}/generations        # 画像 ingest（multipart: metadata + image）
GET  /api/v1/generations?character=...    # 検索
GET  /api/v1/generations/{id}/context     # Claude 向け軽量 context
PUT  /api/v1/generations/{id}/semantic    # semantic metadata 保存
POST /api/v1/experiments/{id}/runs        # 検証試行の記録（overrides / evaluation / decision）
POST /api/v1/experiments/{id}/promotions  # 安定条件を comfyui-recipes へ昇格する記録
```

Request / Job 作成と ingest は冪等で、同一 idempotency_key / 同一 (job, output_index)
の再送は既存を返します。この Write / ingest を呼ぶのは、chimera の requests
キューから request を claim した worker（GPU 機の `comfy-recipes watch`）が起動する
comfyui-recipes の `comfy-recipes generate` CLI（`comfyui_recipes` パッケージ、
`request.json` 契約は [generation-request.md](generation-request.md)、requests
キューとの関係は [worker-protocol.md](worker-protocol.md) 参照）です。

## ComfyJob

### Create Job

``` text
POST /api/v1/requests/{request_id}/jobs
```

例:

``` json
{
  "idempotency_key": "...",
  "seed": 123456789,
  "index": 0
}
```

redraw / deliver / dof / repair / masked_redraw の Request では、仕上げ元の Generation を
`source_generation_id` に渡します（[Request](#request)）。

201（新規作成）は `{ id, request_id, seed, index, status, comfy_prompt_id: null, source_generation_id, generations: [] }`
を返します。同一 idempotency key の再送は200で、当該 Job の `comfy_prompt_id` /
ingest 済み `generations[]` を含みます（[worker-protocol.md](worker-protocol.md#再送レスポンスに含めるもの)）。

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
Experiment run のいずれか）に抽出してその場で書き戻します。

original が保持期間を過ぎて再圧縮の対象になった Generation（過去に purge された Generation を含む）は、original の
PNG が持つ `prompt` text chunk から `comfy_job.graph` を救出済みなので
（[domain-model.md](domain-model.md#original-の再圧縮)）、その original が既に消えて
いても（PNG が WebP に変わっていても）`comfy_job.graph` はそのまま読めます。

`render_facts` は以下の箇所に現れます:

-   `GET /api/v1/generations/{id}` の `comfy_job.render_facts`（同じレスポンスの
    `comfy_job.graph` は投稿された prompt グラフ全体、`request.negative_prompt`
    は所属 Request の先頭 Job の negative prompt — どちらも `/g/` の Workflow セクション
    が「グラフから再現できる形」を組み立てる材料）
-   ExperimentRun（`GET /api/v1/experiments/{id}` の `runs[]` /
    `GET /api/v1/experiments/{id}/runs` / `GET /api/v1/experiment-runs/{id}` /
    MCP `get_experiment` / `get_run`）の `render_facts`。Run の結果 Request に
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
  "base_generation_id": "...",
  "character_id": "..."
}
```

`status` は常に `active` で作成されます。`base_generation_id`
はUUID / short_idのどちらでも受け、保存するのはUUIDです。存在しなければ404です。

`base_parameters` は語彙を解釈しないJSONオブジェクトですが、`seeds` だけは検証します。
`seeds` は0以上の整数1〜16個の配列で、指定するとこのExperimentの全Runが同じseedで描画され
（自動起票するrequestの `request.seeds` にこの配列、`request.count` にその件数が入り、
generation.parametersには入りません）、`count` を併記する場合は `seeds` の件数と
一致させます。形が違う、または件数が食い違う場合は、作成・PATCHとも400です。

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
      "base_generation_id": "...",
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
昇順。各 Run に `request` / `generation` が付く）、`promotions` を返します。

``` json
{
  "id": "...",
  "short_id": "abc123",
  "name": "...",
  "description": "...",
  "note": null,
  "status": "active",
  "base_recipe": "dq3",
  "base_generation_id": "...",
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
      "generation_id": "...",
      "overrides": { "pose": { "hip_rotation": 4 } },
      "objective": "...",
      "evaluation": null,
      "decision": null,
      "note": null,
      "created_at": "...",
      "updated_at": "...",
      "request": { "id": "...", "short_id": "...", "thumbnail_url": "...", "thumbnail_generation_short_id": "..." },
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

`base_generation_id` はUUID / short_idのどちらでも受け、存在しなければ404です。
明示 `null` でクリアできます。

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

`run_index` は Experiment 内で自動採番されます。Run の結果の Request は `requests.run_id` で引きます。
`batch_id` は受け付けず、渡すと 400 です（`batch_id is no longer supported; runs link to requests via run_id`）。
作成時点の Run にはまだ結果の Request が無いので、`generation_id` を渡すと 409 です。

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
注記で、`overrides` と違い結果が付いた後でも
PATCH /api/v1/experiment-runs/{run_id} で変更できます（`variables: null`
でクリア）。Experiment View の facts テーブルでは `variables.<key>` という
追加列として表示されます。

レスポンスは Run の各フィールドに加え `request_id` を含みます。Experiment に
`base_recipe` があり status が active / stabilized なら、この Run 作成と同じ
トランザクションで chimera が `kind = generate` の requests 行を自動起票し、
その id が入ります。それ以外は `null` です
（[worker-protocol.md](worker-protocol.md)「ExperimentRun 由来の generate」）。

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

Run の各フィールドに加え、`request` / `generation` と以下を返します。

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

`generation_id` はUUID / short_idのどちらでも受け、attach専用でnullを受けません。`batch_id` は受け付けず400です。`evaluation`
/ `decision` / `variables` は明示nullでクリアできます。

409のケース:

-   結果の Request が付いた、または Generation がattach済みのRunで `overrides` を変更しようとした
-   既にattach済みの `generation_id` を別のものへ付け替えようとした
-   結果の Request が無い Run、または結果の Request に属さない Generation へ `generation_id` を付けようとした

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

## Request

worker（GPU 機）が claim / heartbeat / 状態遷移するジョブキューです。契約の正本は
[worker-protocol.md](worker-protocol.md)（テーブル定義、状態遷移、payload の形、
`recipe_ref`、idempotency の導出）で、ここではルーティングとクエリパラメータだけ
挙げます。

``` text
POST   /api/v1/requests            kind/payload/recipe_ref?/idempotency_key/created_by を積む。201 / 200(再送) / 409(同じキーで別内容) / 409(original_purged)。kind は generate / redraw / deliver / dof / repair / masked_redraw / import で、finalize は 400（redraw か deliver を使う）。kind=import は status: "done" と解決済みの値を平置きで渡す（payload は任意、Run の結果なら run_id）
GET    /api/v1/requests            ?status=&kind=&run_id=&generation_id=&worker_id=&pending=true&limit=&offset=（kind は import も受ける）
GET    /api/v1/requests/summary    ナビの queue pill 用の集計。詳細は下記
POST   /api/v1/requests/claim      { worker_id, kinds? } → 200 (claim した行) / 204 (queued が無い)
GET    /api/v1/requests/{id}
PUT    /api/v1/requests/{id}/resolution  worker が解決済みの値（recipe / parameters / patches / pose_fingerprint / preset_versions / git_commit / git_dirty / references）を報告。200（再送・Job 作成前の上書き）/ 409（Job 作成後に別の値）。応答は { id, short_id, status, jobs[] }
POST   /api/v1/requests/{id}/jobs  { idempotency_key, seed, index, source_generation_id? }。201 / 200(再送) / 409(resolution 前)。redraw・deliver・dof・repair・masked_redraw（と古い finalize）は source_generation_id 必須
PATCH  /api/v1/requests/{id}       worker: running(heartbeat) / queued(release) / done / failed。brain・GUI: cancelled
```

`GET` のクエリパラメータ:

-   `status` / `kind`: 完全一致。`kind` には作れなくなった `finalize` と、`import`（worker を通らず登録側が `done` で作る Request）も指定できる
-   `run_id`: `kind = generate` の行のみ持つ
-   `generation_id`: `kind = redraw` / `deliver` / `dof` / `repair` / `masked_redraw`（と古い `finalize`）の行を対象に、その
    `payload.generation_id` が渡した値（UUID / short_id どちらでも可）と一致するものを返す
-   `worker_id`: claim した worker
-   `pending=true`: `status=queued` の別名

レスポンスは全カラムを含み、`payload` / `result` は JSON object にパースして返します
（`payload_hash` は内部実装なので含めません）。`short_id` は生成前に worker が解決値を報告するまで `null` です。

`kind = redraw` / `deliver` / `dof` / `repair` / `masked_redraw` の作成は、`payload.generation_id` が指す
Generation の original が purge 済み（`original_purged_at` 非 null）なら 409
（`code: "original_purged"`）で拒否します（original の purge は止めてあるので、対象は過去に purge された行だけです）。worker はその Generation 自身の画像を読むため
（[worker-protocol.md](worker-protocol.md)）、original が無いと実行できません。既存の
idempotency_key での再送（新規作成ではない）はこのチェックの対象外です。`generate` /
derive request は対象外です。

### Summary

`GET /api/v1/requests/summary` は queued / running の全件と、直近24hに failed
になった件のみを対象に、仕上げ元 Generation が属する Request（redraw/deliver/dof/repair/masked_redraw、古い finalize も）または
Experiment（generate、`run_id` があるとき）単位にまとめて返します。仕上げ元が解決できない行と、`run_id` の無い
generate は request 単体のグループです。GUI ナビの queue pill 専用で、他のフィルタは
持ちません。

``` json
{
  "counts": { "queued": 3, "running": 1, "failed_24h": 1 },
  "workers": [{ "worker_id": "w1", "kinds": ["deliver"], "connected_at": "2026-09-11T00:00:00.000Z" }],
  "groups": [
    {
      "key": "request:...",
      "request": { "id": "...", "short_id": "b_7k2m9q", "thumbnail_generation_short_id": "g_..." },
      "experiment": null,
      "href": "/g/g_...",
      "kinds": { "deliver": 2 },
      "counts": { "queued": 1, "running": 1, "failed": 0 },
      "latest_at": "2026-09-11T00:00:00.000Z"
    }
  ]
}
```

-   `workers` は [WorkerHub](#websocket) の `GET /state` をそのまま渡したもの。DO への
    fetch が失敗しても `workers: []` で 200 を返します
-   `groups` は最大20件。running を含むグループを先頭に、次いで `latest_at`（グループ内の
    `claimed_at` / `finished_at` / `created_at` の最大値）降順
-   `request` / `experiment` / `href` は解決できないとき（generate で `run_id` が無い行など）null。`request` は仕上げ元の
    Request で、`thumbnail_generation_short_id` はその最初の Generation、`href` はその `/g/{short_id}`
-   generate かつ `run_id` があるグループは `experiment` に所属 Experiment の `id` / `short_id`
    を持ち、`href` はその詳細ページ（`/experiments/{short_id}`）

### Generic masked redraw

MCP の `masked_redraw_generation` は、既存 Generation を変更せずに任意の矩形領域を
inpaint する `kind = masked_redraw` request を積みます。REST からも同じ payload を
`POST /api/v1/requests` へ渡せます。

``` json
{
  "kind": "masked_redraw",
  "payload": {
    "generation_id": "xbbw2y",
    "options": {
      "regions": [[0.18, 0.42, 0.86, 0.96]],
      "prompt_patch": "replace only the waist-to-hem garment with a qwdgne-like long loose A-line mid-calf dress",
      "denoise": 0.48,
      "mask_padding": 24,
      "mask_feather": 8
    }
  },
  "recipe_ref": "production",
  "idempotency_key": "mcp:masked-redraw:xbbw2y:...",
  "created_by": "mcp"
}
```

`regions` は width/height に対する分数 `[x0, y0, x1, y1]` の1件以上の配列で、値は
0..1、x0<x1、y0<y1、矩形同士の重複なしを要求します。`prompt_patch` は空でない
instruction / prompt patch、`denoise` は (0, 0.75]（低〜中程度は0.2〜0.65を推奨）、
`mask_padding` / `mask_feather` は pixel 数です。`pad` / `feather` は API の短縮 alias
で、受け付け後はそれぞれ canonical key に正規化して request payload に保存されます。
canonical key と同時には指定できません。

worker は source Generation を変更せず、source を仕上げ元（`refines_generation_id`）とする
新しい Generation を作ります。request payload と Request の `parameters` / Job の graph
には patch、regions、denoise、padding、feather を残し、再現可能性を保ちます。chimera
自体は ComfyUI graph を実行せず、comfyui-recipes の masked-img2img / inpaint adapter
境界を worker protocol として公開します（詳細は
[worker-protocol.md](worker-protocol.md#masked_redraw)）。既存の `repair_generation`
（hands / feet 専用）は別 kind のままです。

## Preset

承認済みの Generation から作られる、名前の付いた派生の正本です
（[domain-model.md](domain-model.md#preset)）。base となる pose の本文は comfyui-recipes
側に残り、Preset が持つのはその pose への参照と patches の列です。版を持ち、履歴が残り、
`recipe_ref` では分けません。

``` text
GET  /api/v1/presets                                    名前ごとの最新版の一覧（record 本文なし）
GET  /api/v1/presets/{recipe}/{kind}/{name}             その名前の全版（record 本文なし）
GET  /api/v1/presets/{recipe}/{kind}/{name}/{version}   解決済みの本文。無ければ404
POST /api/v1/presets/import                             catalog の pose 名を参照として取り込む（冪等）
POST /api/v1/presets/promote                            rating good の Generation から新しい版を足す（pose/costume/expression）
POST /api/v1/presets/promote-profile                    rating good の deliver 結果から新しい deliver プロファイルの版を足す
```

`kind` は `pose` / `costume` / `expression` / `deliver` です。一覧は既定で `status = active` の版だけを
返し、`?include_deprecated=1` で全部返します。`deliver` は他の3つと body の形が違います
（下記）。

解決済みの本文は `base` の連鎖を根まで辿った結果です。`patches` は常に配列で、空でも
キーを省きません。`record` は根の pose への参照で、本文ではありません。参照を本文に解決して patches を畳むのは worker 側の graph compiler で、
`parameters.costume` の上書きはそこで今まで通り効きます。

`reference` は `(recipe, kind, name)` の現行の基準 render の pin
（[domain-model.md](domain-model.md#基準-render-の-pin)）で、一覧・全版・単体のどの読み出しにも
付きます。pin が無ければ `null` です。書き込みは MCP `set_pose_reference`、または
[Pose Reference Pin](#pose-reference-pin)（`POST /api/v1/generations/{id}/pose-reference`、
GUI 用に `recipe`/`pose` を Generation から推測する薄いラッパー）が行います。

``` json
{
  "id": "0199...",
  "recipe": "yukari",
  "kind": "pose",
  "name": "lounge",
  "version": 8,
  "status": "active",
  "source": "promote",
  "source_generation_id": "abc123",
  "base_fingerprint": "sha256:...",
  "note": null,
  "record": { "recipe_pose": "lounge" },
  "patches": [{ "target": "pose", "op": "append", "reason": "...", "value": "..." }],
  "created_at": "...",
  "reference": { "generation_id": "0199...", "short_id": "5gmzy0", "seed": 737373737 }
}
```

`POST /api/v1/presets/promote` の body は次の通りです。`kind` の既定は `pose`。`name` が
既存なら次の版、新しい名前ならその名前の version 1 になります。

``` json
{ "generation_id": "abc123", "name": "lounge", "kind": "pose", "base_version": 7, "note": "...", "idempotency_key": "..." }
```

base になる版は、その Generation を作った generate request が pin していた版です。pin が無い
Generation（段階 B より前のもの）では `base_version` が要ります。どちらも無ければ 409
（`no pinned preset for this generation; pass base_version`）で、chimera は base を推測しません。

起点 Generation の rating が good でなければ 409（`promote requires rating good`）、起点 Request が
recipe を持たない graph-mode なら 409、Request が patches を持たなければ 409
（`promote requires a request with patches`）です。patches と `base_fingerprint` は Request 行から
取ります。既存の版は書き換えません。`idempotency_key` の再送は、既に作られた版をそのまま
200 で返します。

`POST /api/v1/presets/import` は `recipe_catalogs` に publish 済みの catalog の pose 名を
`{ "recipe_pose": "<name>" }` の参照として `source = import` の version 1 で取り込みます
（body は `{ "recipe_ref": "production" }`）。同じ `(recipe, kind, name)` が既にあれば飛ばす
ので、何度呼んでも同じ結果です。ただし既存の最新 active 版の根が別の recipe pose（例: gao の
上の patches として昇格した `anyo`）なら、自名の `{ "recipe_pose": "<name>" }` を根にした版を
追記して付け替え、レスポンスの `rerooted` に載せます（レスポンスは
`{ imported, rerooted, skipped }`）。取り込むのは pose だけで、catalog の `costumes` /
`expressions` は名前の配列でしか publish されておらず、参照にしても何も足しません。移行の段は
[worker-protocol.md](worker-protocol.md#preset-の移行)。

### deliver プロファイル (kind = deliver)

deliver request の `options` をまとめて一発で選ぶための Preset です
（[domain-model.md](domain-model.md#deliver-プロファイル)、
[worker-protocol.md](worker-protocol.md#deliver-profile)）。pose/costume/expression と
違い、`record` は `{ options }` そのもので、`patches` は常に `[]` です。

``` json
{
  "id": "0199...",
  "recipe": "yukari",
  "kind": "deliver",
  "name": "daily",
  "version": 2,
  "status": "active",
  "source": "promote",
  "source_generation_id": "abc123",
  "base_fingerprint": null,
  "note": null,
  "record": { "options": { "keep_legwear": "on", "backdrop": "dots" } },
  "patches": [],
  "created_at": "..."
}
```

`POST /api/v1/presets/promote-profile` の body:

``` json
{ "generation_id": "abc123", "name": "daily", "note": "...", "idempotency_key": "..." }
```

`generation_id` は `rating = good` かつ、所属 Request が `kind = deliver` である Generation でなければならず、それ以外は409
（`generation is not a deliver-kind result; nothing to promote from`）。body はその
deliver request が queued した時点の `payload.options`（profile 展開後、word はそのまま）を
複製します。`name` が既存なら次の版、新しい名前なら version 1。rating が good でなければ
409（`promote requires rating good`）。既存の版は書き換えません。`idempotency_key` の再送は
既に作られた版をそのまま 200 で返します。

deliver request の payload に `profile: { name, version? }` を渡すと、chimera がその版を
解決して `options` の下敷きにします（明示した `options` の同じキーが勝つ、明示 `null` も
含めて勝つ）。未知の profile は 404 で、queued 行は作りません
（[worker-protocol.md](worker-protocol.md#deliver-profile)）。

## Observation

comfyui-recipes の `experiments/` を写した索引です（[domain-model.md](domain-model.md#observation)）。
正本は JSONL 側で、chimera は引くための索引に徹します。

``` text
GET  /api/v1/observations          ?character= &pose= &component= &parameter= &outcome= &q=
GET  /api/v1/observations/{id}     1件。無ければ404
POST /api/v1/observations/sync     レコードの配列を冪等に upsert する
POST /api/v1/observations          MCP / GUI から1件書く（idempotency_key 必須）
```

`q` は `parameter` / `value` / `reason` の部分一致です。`AGENTS.md` が JSONL に対して
求めている grep の代わりになる粒度にします。

`POST /api/v1/observations/sync` の body はファイル単位です。行番号を送り手に明示させる
のは、空行や並び順で番号がずれないようにするためです。

``` json
{
  "files": [
    {
      "path": "experiments/yukari/stand.jsonl",
      "records": [{ "line": 1, "record": { "character": "yukari", "pose": "stand", "...": "..." } }]
    }
  ]
}
```

`line` はファイル先頭を 1 とする物理行番号で、空行も数えます。送り手が明示する以上、
数え方が揃っていないと同じファイルから別の `id` が出て全行が重複します。

`record` がそれ自身では持たない `character` と `component` を、送り手が同じ要素に添え
られます。chimera はパスから推測しません。`experiments/yukari/` の下にあるから
`character` は `yukari` だ、`delivery_style.jsonl` だから `component` は `delivery_style` だ、
という推測はどちらも当たりません。実際 `delivery_style.jsonl` は `delivery_style` /
`delivery` / `recolor` / `refinement_graph` の4種類の観測を持ちます。

``` json
{ "line": 48, "character": "yukari", "component": "prompt_style", "record": { "axis": "...", "arms": {} } }
```

添えた値は `record` 自身が同じキーを持たないときだけ使われます。

chimera が `{ path, line, record }` を正規化して SHA-256 を取り、それを `id` にして upsert
します。添えた `character` と `component` は `id` に入りません。同じ行に後から正しい値を
付け直しても、新しい行にはなりません。同じ行は何度送っても同じ Observation になるので、JSONL 全体を毎回丸ごと送って
構いません。payload に無い既存行は消しません。レスポンスは `{ inserted, unchanged, skipped }`
で、`skipped` には受理しなかったレコードとその理由が入ります。

`GET /api/v1/observations` は `{ items, total }` を返します。`total` は絞り込み条件に
一致する全件数で、ページングの外側の数です。

受理しないのは次の2つです。`pose` と `component` のどちらも無いレコード（Observation の
語彙に乗らない実装メモが混ざるため）と、`outcome` が語彙外のものです。ただし
`"not adopted"` は `rejected` に正規化します（README の `rejected` の定義が
"lost a sweep" を含み、該当レコードの `reason` もすべて「同じ seed で別のアームが
選ばれた」であるため）。

実験のアーム（生成単位と seed の組を持つ形）は Observation ではなく Experiment /
ExperimentRun に入ります。`sync` はそれらを `skipped` として返します。

`POST /api/v1/observations` は `idempotency_key` を必須にします。`id` はそこから作り、
内容からは作りません。内容から作ると、同期側と同じ理由で再測定が黙って消えます。同じ
観測を測り直して同じ結果が出たら独立した行になるべきで、再送と区別できるのは呼び出し側の
key だけです。同じ key の再送は既にある行をそのまま 200 で返します。

## Recipe Catalog

comfyui-recipes 側の recipe（pose / costume / expression の一覧、patches の語彙、
git 情報）を worker が起動のたびに公開するスナップショットです。recipe_ref
単位で最新の1件だけを持ち（履歴は持ちません）、chimera は語彙を検証も解釈もせず
そのまま保存・返却します。pose 名に加えて recipe ごとの `parameters` の可否、`patches` の
語彙、model、canvas を運ぶ capability document でもあるため、Preset の導入後も残ります。

``` text
PUT  /api/v1/catalogs/{recipe_ref}   カタログ全体を丸ごと差し替える。200 (要約を返す)
GET  /api/v1/catalogs                公開済みカタログの一覧（各件 prompt 本文なしの要約 + published_at / updated_at）
GET  /api/v1/catalogs/{recipe_ref}   カタログ全体（prompt 本文込み）。無ければ404
```

`recipe_ref` は requests の `recipe_ref` と同じ形式検証（origin のブランチ名相当）を
使います。`PUT` の body は封筒だけを検証します：

``` json
{
  "schema_version": 1,
  "recipes": [{ "name": "...", "poses": [...] }],
  "patches": {},
  "git_commit": "...",
  "git_branch": "...",
  "generated_at": "..."
}
```

`schema_version` は 1・2・3 です。`recipes[].poses` 以外のキー（`costumes` / `expressions` / `parameters` など）は
recipe ごとに自由です。`PUT` のレスポンスと `GET /api/v1/catalogs` の一覧、および
MCP `list_catalog` は pose / costume / expression の名前、recipe が持つ場合は
`parts`（prompt のパーツ名）と `identity_tags`、`parameters`、`patches` の語彙、`dials`、
`deliver`（`defaults` / `outlines` / `stroke_light` / `backdrop_color`）と `redraw`（`light` / method ごとの `defaults`）、最上位の `dof`（`f_number` の範囲と刻み / `scope` の既定 / `viewfinder` / `focus` の説明 / `guide_radius_per_f`）、git
情報だけを返し、prompt 本文は含めません（パーツ単位の patch は
[worker-protocol.md](worker-protocol.md)「prompt のパーツ単位 patch」）。特定の pose の
中身（prompt 込み）が要るときは `GET /api/v1/catalogs/{recipe_ref}` で全体を取るか、
MCP `get_catalog_pose` で1件だけ引きます。`get_catalog_pose` のレスポンスにも Preset と
同じ形の `reference`（pin が無ければ `null`）が付きます。Agent はまず `list_catalog` で
pose 名を確かめ、名前のある look は `plain_render` が pin の seed で再現し、派生はこの
`reference` の Generation から `derive_request` を起こします。既存の Generation がどの pose を
描いたかとその pin は `get_generation` の `request.drawn_pose`
（[Generation Context](#generation-context)）で分かります。

`dials` は `{ redraw?: {optionKey: {word: number}}, deliver?: {...}, repair?: {...}, patches?: {...} }` の
形で、redraw / deliver / repair の options にある dial-able キーごとの word → number です
（[worker-protocol.md](worker-protocol.md#deliver-profile)）。chimera は語彙も数値も
検証せず、GUI がボタンに出す表示にだけ使います。worker へは number に解決せず word を
そのまま渡し、word の実在確認と number への解決は worker の責務です。

`backdrops` は recipe とは独立なカタログ全体のキーで、`[{ name, label, thumbnail }]`
（`thumbnail` は `data:image/png;base64,...` の 120x192 PNG）です。deliver の
`backdrop` optionが取れるパターン名の一覧で、GUIのワークベンチの納品フェーズはこれをサムネイル
ピッカーとして描画します。このキーが無い（旧workerが公開したカタログ）場合、GUIは
サムネイル無しの`stripes`カード1枚にフォールバックします。`PUT`のレスポンス・
`GET /api/v1/catalogs`の一覧・MCP `list_catalog`は`backdrops`をname/labelだけの
配列に要約し（thumbnail は含めない。キーが無いカタログでは`backdrops`自体を省略）、
`GET /api/v1/catalogs/{recipe_ref}`だけがthumbnail込みの全体を返します：

``` text
GET /api/v1/catalogs/{recipe_ref}/backdrops/{name}.png
```

`name`はcatalogの`backdrops[].name`。thumbnailを`image/png`でデコードして返します
（catalog / nameのどちらかが無ければ404）。URLはcatalogが変わらない限り同じ画像を
指すので`Cache-Control: public, max-age=31536000, immutable`で返します。GUIは
`?v=<catalogのupdated_at>`をクエリに付けて参照し、republishのたびにこのURLを変えて
古いキャッシュを踏ませません。

## WebSocket

段階3の push / 進捗中継（WorkerHub、Durable Object）。契約の正本は
[worker-protocol.md](worker-protocol.md#段階-3-workerhub)（メッセージの型、broadcast の規則、
alarm、再接続）です。

``` text
GET /api/v1/worker/ws      worker 用アップグレード
GET /api/v1/requests/ws    GUI viewer 用アップグレード
```

socket は通知路で、正本は変わらず D1 です。claim / PATCH の HTTP 契約（上記 Request 節）は
push の有無に関わらず同じままです。

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

`winner`は`verdict`と各Generationの所属Requestから導いた`baseline` / `arm` /
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
-   baseline run と arm run が同じ request を指している
-   `left_generation_id` / `right_generation_id`
    がbaseline runのrequestとarm runのrequestから一つずつになっていない
-   `left_generation_id` / `right_generation_id` の `seed` が `seed` フィールドと一致しない

409のケース:

-   `baseline_run_id` / `arm_run_id` のいずれかに結果の Request（`requests.run_id` がその Run を指す done の generate Request）が無い
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
      "request_id": "...",
      "generation_count": 9,
      "rating": { "good": 4, "neutral": 3, "bad": 0, "unrated": 2 }
    }
  ]
}
```

`win` / `loss` / `tie` はarmから見た結果（`win` =
armが選ばれた数）です。`pairs`は実際にjudgmentがあるbaseline/armの組だけを持ちます。`runs`は
Experimentの全Run（結果のRequestが無いRunも`request_id: null`、`generation_count: 0`
で含む）で、`rating`はそのRunの結果Requestに属する全Generationの評価内訳です（未評価は
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

同じ `(comfy_job_id, comfy_output_index)` への再送（既存行の replay）は既存行を200で返します。
その Generation の original が過去の保持期間ジョブで既に purge 済み（`original_purged_at` 非
null）なら、replay は original を R2 へ書き戻しません — purge 済みのまま200を返します。

レスポンス例:

``` json
{
  "id": "uuidv7",
  "short_id": "abc123",
  "canonical_url": "https://example/g/abc123",
  "r2_object_key": "generations/uuidv7/original.png"
}
```

ingest 時点では常に `original.png` です。再圧縮ジョブが後から `original.webp` に
差し替えることがありますが（[domain-model.md](domain-model.md#original-の再圧縮)）、それは
この ingest レスポンスには現れません。

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

`(generation_id, role, region)` は一意です。同じ組み合わせへの再投稿は既存行を置換し（id
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
  "request": {
    "id": "...",
    "short_id": "...",
    "kind": "generate",
    "recipe": "yukari",
    "raw_instruction": "...",
    "prompt": "...",
    "negative_prompt": "...",
    "parameters": { "pose": "lounge" },
    "patches": [],
    "preset_versions": [{ "kind": "pose", "name": "lounge", "version": 1 }],
    "git_commit": "...",
    "git_dirty": false,
    "drawn_pose": { "recipe": "yukari", "pose": "lounge", "reference": null }
  },
  "generations": [
    { "id": "...", "short_id": "abc123", "image_width": 832, "image_height": 1216, "comfy_output_index": 0 }
  ],
  "references": [],
  "used_by": []
}
```

`request` はこの Generation が属する Request で、所属が無ければ `null` です。
`kind` は `generate` / `redraw` / `deliver` / `dof` / `repair` / `masked_redraw` / `import` のいずれか（古い行は `finalize` もある）、
`parameters` / `patches` / `preset_versions` は未報告なら `null` です。
`prompt` / `negative_prompt` は Request の先頭 Job（`job_index` が最小で graph を持つもの）の
`render_facts` の先頭 sampler から取ります。Job に graph が無ければ `null` です。
`generations` は同じ Request に属する全 Generation（この Generation 自身を含む）で、
`comfy_output_index` 順ではなく作成順です。worker は仕上げ元の
recipe と parameters（`kind` / `base_generation` を含む）と各 Generation の
`short_id` / `image_width` / `image_height` を読みます。

`references` はこのGenerationを素材として使った Request への素材参照（`request_references`）で、
`{ id, target_request_id, purpose, aspect, instruction, created_at }` を返します。`used_by` は同じ行を
`request_id` キーで返す簡易版です（どちらもこのGenerationを素材に使った Request の一覧）。

ComfyUI workflow全文、Git diff、詳細ログなどは返しません。

`GET /api/v1/generations/{id}` はこの内容に `comfy_job`（`graph` / `render_facts`）、
`original_filename`、`siblings`（同じ Request の他の Generation。`generations` から自分自身を除いたもの）、
`refines_generation`（`generations.refines_generation_id`が指す
redraw / deliver / repair / masked_redraw前のGeneration `{ "id", "short_id", "rating" }`、rawなら
`null`）、`publications`（[Publication](#publication)の一覧、
新しい順）、`pose_reference`（このGenerationが現行の pose 基準 render として pin
されていれば `{ "recipe": "...", "pose": "..." }`、無ければ `null`。
[Pose Reference Pin](#pose-reference-pin)参照）を加えたフルの detail です。ロジックは
`src/lib/generations.ts` の `getGenerationDetail` に一本化されており、MCP
`get_generation` もここを呼ぶ同じ形を返します。

`request.drawn_pose` は `{ "recipe": "...", "pose": "...", "reference": {...} | null }` で、
この Generation の Request が描いた pose（`preset_versions` の pose pin、無ければ
`parameters.pose`）と、その pose の現行の基準 render の pin（[Preset](#preset) の `reference`
と同じ `{ generation_id, short_id, seed }`、pin が無ければ `null`）です。Request が recipe か
pose を持たなければ（graph-mode、redraw / deliver / repair の Request）`drawn_pose` 自体が `null` です。
`pose_reference` が「この Generation 自身が pin か」を答えるのに対し、`drawn_pose` は
「同じ pose の基準はどこか」を答えます。Agent の手順は catalog（`list_catalog`）で pose 名を確かめ、名前のある look は
`plain_render` で pin の seed から再現し、派生は pin の Generation から `derive_request` を
起こす順です（[experiment-agent.md](experiment-agent.md)）。

`comfy_job.prompt_not_reusable` は、render_facts の prompt を generate に流用してはいけない
Generation で `{ "reason": ..., "message": ... }` になり、それ以外は `null` です。所属 Request の
`parameters.kind` から決めます。

  reason            Request の parameters
  ----------------- ---------------------------------------------
  repair            `kind: "repair"`
  masked_redraw     `kind: "masked_redraw"`
  finalize_repair   `kind: "hires-chain"` かつ `repair` を持つ（古い finalize の出力）

どれもマスク領域用に顔・髪・フードのタグを落とした prompt で描いているので、全身の generate
に流すとキャラクターの目や髪の指定が消えます。この Generation から作り直すときは
MCP `derive_request` を使います（raw の起点まで遡って recipe を引き継ぎます）。

## Generation Search

``` text
GET /api/v1/generations
```

主なquery:

``` text
character
tag
published
reference
from
to
rating
bookmark
comfy_prompt_id
original_filename
origin
exclude_rating
ids
cursor
after
created_before
```

`cursor`は古い方向、`after`は新しい方向のカーソルで、`after=<カーソル>`はそのカーソルが指す
Generationより新しいものを`limit`件、新しい順で返します。`created_before=<UTC ISO>`は`created_at`が
その時刻より前のものだけを返す先頭ページです（`cursor` / `after`があるときは無視）。`created_before`
または`after`を指定したとき、新しい方向に続きがあれば`newer_cursor`（無ければ`null`）に、返したページの
先頭を指す`after`用のカーソルを返します。

主な用途:

``` text
character=yukari
tag=outfit-good
bookmark=true
from=2026-01-01
to=2026-08-26
```

検索結果には short ID、canonical URL、thumbnail/image
URL、summary、`refines_generation_short_id`（この Generation が redraw/deliver/repair/
masked_redraw で仕上げた元の Generation の short_id、raw なら null）、`request_id`、`published`
（[Publication](#publication)を1件以上持つか）、`reference`（現行の pose 基準 render として
pin されていれば `{ "recipe": "...", "pose": "..." }`、無ければ `null`。
[Pose Reference Pin](#pose-reference-pin)参照）、`refinement_request`
等の軽量情報を返します。

`thumbnail_url` は `GET /g/{short_id}/preview`（長辺1024px以下のWebP。初回リクエスト時に
元画像から生成しR2へ保存する）、`image_url` は `GET /g/{short_id}/image`（元画像そのもの）
です。サムネイル用途は必ず前者を使います。保持期間（30日）を過ぎた古い Generation では
再圧縮ジョブ（[domain-model.md](domain-model.md#original-の再圧縮)）が原本を lossless
WebP に変換していることがあり、その場合 `image_url` は `Content-Type: image/webp` を
返します。画素は元の PNG と同一です。

`original_purged_at` は過去の保持期間ジョブがその original を削除した時刻（ジョブは廃止済みで、新たに削除されることはない）
（[domain-model.md](domain-model.md#original-の保持)）。null なら未削除で、`image_url`
がそのまま使えます。非 null な Generation を `image_url` で読むと 410 です — `thumbnail_url`
（preview）を使ってください。この欄は `image_url` を返すすべての Generation
表現（Generation Search / Context / MCP の対応する出力）に付きます。

`refinement_request`（redraw / deliver / dof / repair /
masked_redraw と古い finalize のすべてを対象にする）は、この Generation を対象にした最新の
[Request](#request)（`payload.generation_id` がこの Generation の UUID /
short_id のどちらかと一致する行のうち、最新の1件）です。無ければ `null`。

``` json
{ "id": "...", "kind": "deliver", "status": "running", "result_short_id": null }
```

`result_short_id` は `status = done` のときだけ `result.generation_ids[0]` を short_id に
解決した値で、それ以外は `null` です（GUIの進捗ピル、[ui.md](ui.md#gallery)）。ページ内の
全件を1クエリで解決するため、`GET /g/{short_id}?partial=card`（[ui.md](ui.md#gallery)の
Gallery live insertion カードフラグメント）も同じフィールドを同じ形で返します。

`published=true|false` は Publication の有無で絞り込みます。

`reference=true|false` は、いずれかの pose の現行の基準 render として pin されているか
（`preset_references` の `superseded_at IS NULL` 行）で絞り込みます
（[Pose Reference Pin](#pose-reference-pin)参照）。

`origin=raw|refined` は raw Generation（`refines_generation_short_id` が null）/ 仕上げ済み
（redraw / deliver / repair / masked_redraw / 古い finalize）の出力のどちらかに絞ります。省略時は両方を返します。

`exclude_rating=bad|neutral|good` はその rating を除外します（未評価の行は残ります）。

`ids=` は Generation の short_id / UUID をカンマまたは空白区切りで並べたもので、指定すると
それらのみを返します（最大100件、超過は400）。`ids` は `character` などの他フィルタと
組み合わせられます。

`cursor=` は newest-first のkeysetページングを進めるための不透明な文字列です。指定すると
`offset` は無視されます。並び順はいずれの場合も `created_at DESC, id DESC`
（タイブレークまで固定）です。レスポンスには次ページがあるときだけ非nullになる
`next_cursor` を追加で含みます（`total` は引き続き cursor と無関係にフィルタ全体の件数）。
不正な `cursor` は400です。

### Generation Tree

``` text
GET /api/v1/generations/{id}/tree
```

`{id}` は UUID / short_id のどちらでもよく、`refines_generation_id` を raw Generation までさかのぼって元絵を求め、
元絵から下の全 Generation を返します。どのノードの id を渡しても同じ木です。

``` json
{
  "root_id": "<元絵の id>",
  "nodes": [
    {
      "id": "...", "short_id": "abc123", "refines_generation_id": "<親の id。元絵は null>",
      "kind": "redraw", "method": "hires", "phase": 1,
      "options": { "method": "hires", "hires": 3072 },
      "rating": "good", "delivered": false,
      "image_width": 3072, "image_height": 3072, "image_size": 9437184, "created_at": "..."
    }
  ],
  "pending": [
    {
      "request_id": "...", "kind": "deliver", "method": null, "phase": 4, "options": { "backdrop": null },
      "source_generation_id": "<入力の id>", "status": "running", "created_at": "..."
    }
  ]
}
```

-   `kind`: その Generation を作った Request の kind（元絵は `generate`、import した元絵は `import`）
-   `method`: kind が `redraw` のときの `options.method`（`canvas` / `hires` / `light`）、それ以外は `null`
-   `phase`: ワークベンチのフェーズ。redraw の `canvas` / `hires` = 1、`light` = 2、`repair` / `masked_redraw` = 3、
    `deliver` = 4、`dof` = 5。元絵と対応しない kind は `null`
-   `options`: 作った Request の `payload.options`（元絵と options の無い kind は `null`）
-   `delivered`: 納品の絵か（`dof` の出力を含む。[worker-protocol.md](worker-protocol.md#dof)）
-   `image_width` / `image_height` / `image_size`: 画像の寸法（px）とバイト数。未記録の行は `null`
-   `nodes` は `created_at` の古い順
-   `pending`: `status` が `queued` / `running` の redraw / repair / masked_redraw / deliver / dof で、`payload.generation_id` が
    この木のどれかを指すもの。処理中の候補を画面の再読み込み後に出すために使う。`source_generation_id` は入力の id

不明な `{id}` は404です。

### Workbench

``` text
GET /api/v1/workbenches/{rootId}
PUT /api/v1/workbenches/{rootId}
```

ワークベンチは元絵（raw Generation）1 枚につき 1 行で、フェーズごとの採用とスキップを保存します。`{rootId}` は UUID /
short_id のどちらでもよく、raw Generation でなければ 400（不明なら 404）です。

``` json
{
  "root_generation_id": "<元絵の id>",
  "picks": { "1": { "generation_id": "<id>" }, "2": { "skip": true } },
  "updated_at": "2026-10-08T00:00:00.000Z"
}
```

`GET` は行が無いと `picks: {}`、`updated_at: null` を返します。`PUT` の body は `{ "picks": { ... } }` で、`picks` を丸ごと
置き換え、保存後の同じ形を返します。キーは `"1"`〜`"5"`（フェーズ番号）、値は `{ "generation_id": "<id か short_id>" }`
（元絵から下の木に含まれる Generation。保存は id）か `{ "skip": true }` です。違反は 400 で、何も保存しません。

### Generation Timeline

``` text
GET /api/v1/generations/timeline
```

Generation Searchと同じ絞り込みquery（`character` / `tag` / `published` / `reference` / `from` /
`to` / `rating` / `bookmark` / `comfy_prompt_id` / `original_filename` / `origin` /
`exclude_rating` / `ids`）を受け取り、条件に合う枚数をJST（UTC+9）の15分枠ごとに新しい順で返します。
`cursor` / `after` / `created_before` / `limit`は使いません。枠のないものは含みません。

``` json
{ "slots": [ { "slot": "2026-10-06T21:45", "count": 12 }, { "slot": "2026-10-06T21:30", "count": 3 } ] }
```

`slot`はJSTの壁時計で表した枠の開始時刻（`YYYY-MM-DDTHH:MM`、分は00 / 15 / 30 / 45）です。
Galleryのタイムライン（[ui.md](ui.md#gallery-timeline)）が見出しの枚数とレールの位置に使います。

### Gallery Slot Range

``` text
GET /gallery?partial=1&slot_from=2026-10-06T21:30&slot_to=2026-10-06T21:45
```

Galleryのスケルトンを実カードで置き換えるためのUIルートです（[ui.md](ui.md#gallery-timeline)）。
`slot_from`（古い方の枠）から`slot_to`（新しい方の枠）まで、両端を含む枠のキー
（[Generation Timeline](#generation-timeline)の`slot`と同じ形式）に`created_at`が入るGenerationを、
見出しやリンクを付けず`.card`だけのHTMLとして新しい順に返します。`GET /gallery`と同じ絞り込み
（`view` / `bad` / `tag` / `rating` / `bookmark` / `published` / `reference`）を受け取り、
`GET /api/v1/generations/timeline`の同じ絞り込みの枚数と一致します。枚数が多くても切り詰めず
全件（上限2000件）を返します。`partial=1`がないとき・`ids`があるときは無視します。`slot_from` / `slot_to`の
どちらかが枠のキーでない（欠けている場合も含む）とき、`slot_from`が`slot_to`より新しいときは400です。

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

## Publication

Generation 1件の1回分の納品（X への投稿）です（[domain-model.md](domain-model.md#publication)）。
1 Generation は複数の Publication を持てます。

``` text
GET    /api/v1/generations/{id}/publications        新しい順の一覧
POST   /api/v1/generations/{id}/publications         {url?, published_at?, idempotency_key?}
PATCH  /api/v1/publications/{id}                      {url}   url をセット/クリア
DELETE /api/v1/publications/{id}                      204
```

`url` は省略・`null` いずれも「まだ無い」を表し、後から `PATCH` で埋められます。
指定する場合は `https://` で始まる URL である必要があります（それ以外は400）。
`published_at` を省略すると記録した時刻になります。`idempotency_key` を渡すと、
同じキーの再送は新しい行を作らず既存行を200で返します（Request create 等と同じ
[Idempotency](#idempotency) パターン）。

`GET /api/v1/generations` に `published=true|false` フィルタがあり、各アイテムに
`published`（少なくとも1件 Publication を持つか）が付きます。`GET
/api/v1/generations/{id}` は `publications` 配列（`GET
.../publications` と同じ形）を持ちます。

`POST .../publications` と MCP `record_publication` のレスポンスには `warning` が付きます。
Generation の安全性判定（[Safety](#safety)）が `block` または `sensitive` のとき
`{verdict, reasons, message}`、それ以外は `null` です。警告があっても記録は拒否されません。

## Safety

X に出せる画像かどうかの判定用スコアです。worker が WD tagger の生スコアを送り、chimera が保存して
閾値を持ちます。判定は読み出し時に保存値から計算するので、閾値を変えれば再採点なしで過去分にも効きます
（閾値は `src/lib/safety.ts`）。

``` text
PUT /api/v1/generations/{id}/safety
{"model": "...", "rating": {"general","sensitive","questionable","explicit"}, "tags": {"<tag>": prob}}
```

`id` は UUID / short_id どちらでも可。再送は上書きで `rated_at` を更新します。形が不正なら400、未知の
Generation は404。レスポンスと `GET /api/v1/generations/{id}`・MCP `get_generation` の `safety` は
`{model, rating, verdict, reasons, rated_at, tags}`、未採点は `null`。一覧（REST `items[]`・MCP
`list_generations`）の `safety` は `tags` を含みません。

判定は先に当たった順です。

| verdict | 条件 |
| --- | --- |
| `block`（出さない） | 露出系タグ（nipples, areolae, pussy, penis, anus, completely_nude, nude, topless, bottomless, breasts_out）のいずれかが 0.15 以上 |
| `sensitive`（センシティブ） | rating.questionable が 0.15 以上、または乳・股間のタグ（cameltoe, crotch, groin, crotch_seam, covered_nipples）のいずれかが 0.35 以上 |
| `caution`（注意） | 尻・下着のタグ（ass, ass_focus, panties, pantyshot, upskirt, spread_legs, bent_over, cleavage）のいずれかが 0.5 以上 |
| `none` | 上記以外 |

## Pose Reference Pin

``` text
POST /api/v1/generations/{id}/pose-reference   {idempotency_key?}
```

GUI の Generation Detail の「基準にする」ボタンが呼ぶ窓口です
（[ui.md](ui.md#generation-detail)、[domain-model.md](domain-model.md#基準-render-の-pin)）。
MCP `set_pose_reference` と違い `recipe` / `pose` を渡しません — この Generation を
`resolveDerivationSource` で raw Generation の Request まで遡り、その `recipe` と drawn pose
（`preset_versions_json` の pose pin、無ければ `parameters_json.pose`）から推測します。
どちらも特定できなければ 409（`cannot infer which pose to pin`）です。

`idempotency_key` を省略するとサーバーが生成します。推測した `recipe`/`pose` が決まった
あとは MCP `set_pose_reference`（[domain-model.md](domain-model.md#基準-render-の-pin)）と
同じ経路・同じ 409 ルール（rating good 必須、patches なし、prompt 非上書き等）を通ります。
`created_by` は `'gui'` 固定です。レスポンスは `set_pose_reference` と同じ形
（`created` / `recipe` / `kind` / `name` / `reference` / `source` / `superseded`）で、
新規作成は 201、idempotency replay は 200 です。

## 絵柄チェック

``` text
POST /api/v1/style-check/{recipe}
```

`/check`（[ui.md](ui.md#絵柄チェック)）の「今の既定で描く」ボタンが呼ぶ窓口です。body
はありません。`recipe` の代表ポーズ一覧（`src/lib/style-check.ts` の `STYLE_CHECK_POSES`、
今は `yukari` のみ）を pin を持つものだけ対象に、MCP `plain_render` と同じ組み立て
（`buildPlainRenderRequest` → `createRequest`）で `kind = generate` の request を積みます。
`created_by` は `'gui'` 固定、idempotency key は
`style-check:<recipe>:<pose>:<sha256>` です。sha256 は pin の seed・pose の Preset・カタログ上の
pose レコード・recipe 直下の pose 以外の定義（`poses` と `dials` を除く）の canonical JSON で、
git commit は含みません。描画内容が同じ間の連打は積み直さず既存行を返します。
`recipe_ref` が `REQUESTS_DEFAULT_RECIPE_REF` のカタログの `PUT` 後にも同じ処理が
バックグラウンドで走り、描画内容が変わった pose だけが積まれます。

``` json
{
  "results": [
    { "framing": "bust", "pose": "bust", "skipped": null, "created": true, "request_id": "...", "status": "queued" },
    { "framing": "full", "pose": "dance", "skipped": "no_pin", "created": null, "request_id": null, "status": null }
  ]
}
```

pin が無いポーズは `skipped: "no_pin"` で、request は積まれません。`recipe` に代表ポーズの
定義が無ければ `results` は空配列です。常に 200 を返します（行ごとの skip/replay は
エラーではありません）。

## Tags

対象別endpointを使用します。

``` text
POST   /api/v1/generations/{id}/tags
DELETE /api/v1/generations/{id}/tags/{tag_id}

POST   /api/v1/experiments/{id}/tags
DELETE /api/v1/experiments/{id}/tags/{tag_id}
```

Tag本体はrename/delete可能です。

## Bookmark

``` text
PUT    /api/v1/generations/{id}/bookmark
DELETE /api/v1/generations/{id}/bookmark

PUT    /api/v1/experiments/{id}/bookmark
DELETE /api/v1/experiments/{id}/bookmark
```

## Rating

Rating は Generation にのみ付きます。

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
/b/{short_id}    # Request の short_id。最初の Generation の /g/ へ 302
```

Experiment の人間向けパスは `/experiments/{short_id}` です。

Claudeはcanonical URLを受け取った後、context
APIへ解決可能な設計とします。

## Idempotency

以下は必須です。

-   ComfyJob create
-   Generation ingest
-   Request create（同じキーで `kind` / payload が異なれば409。
    [worker-protocol.md](worker-protocol.md)「idempotency と再実行の再開」参照）

ネットワークエラー後の再送で重複レコードを作らないこと。

Generation ingest はGeneration ID / R2
keyを決定的に扱い、R2成功・D1失敗等から再実行可能にします。

ExperimentRun create の `idempotency_key` は任意です。Run
は物理削除できないため、Agent
がレスポンスを失って作成の成否が分からなくなった場合の再送手段として使います。
人間がGUIから作る場合や一回限りのcurlなど、再送保護を必要としない経路も
引き続きキーなしで使えるようにするため、他の必須の経路と異なりキーを必須にはしません。

Publication create（`POST /api/v1/generations/{id}/publications`、MCP
`record_publication`）の `idempotency_key` も同じ理由で任意です。
