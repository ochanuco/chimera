# Generation Request Contract

## Purpose

`request.json` は、brain が解釈した人間の生成意図を worker へ渡す正式な境界です。
brain はこれを `kind = generate` の requests 行の `payload` として chimera に積み、worker
が claim して ComfyUI で実行します（[worker-protocol.md](worker-protocol.md#配置と責務)）。

``` text
brain（Claude Code / Cloudflare OS Agent / Human）
  ↓ request.json を payload に積む（POST /api/v1/requests、MCP create_request / derive_request）
chimera requests キュー
  ↓ claim
worker（comfy-recipes watch）
  ↓ payload を request.json に書き出し comfy-recipes generate --request に渡す
ComfyUI → chimera へ Batch / Job / Generation を ingest → Discord 通知
```

ExperimentRun の作成時には chimera 自身が同じ形の request.json を組み立てて積みます
（[worker-protocol.md](worker-protocol.md#experimentrun-由来の-generate)）。

語彙の正本は comfyui-recipes の `validate_request`
（`src/comfyui_recipes/application/generate.py`）です。chimera が検証するのは封筒の形
（`schema_version = 1`、`request` / `generation` がオブジェクトであること）と、下記の
preset の pin と Run の所属だけで、それ以外のキーは解釈せず素通しします。

## Envelope

``` json
{
  "schema_version": 1,
  "request": {
    "instruction": "abc123のポーズで9枚生成",
    "count": 9,
    "seeds": null
  },
  "generation": {
    "recipe": "yukari",
    "parameters": { "pose": "lounge", "costume": "default" },
    "presets": null,
    "patches": [
      { "target": "prompt.positive", "op": "append", "value": ", smile", "reason": "表情を笑顔に寄せる" }
    ],
    "graph": null,
    "lint_waiver": null,
    "identity_override": null
  },
  "semantic": { "summary": "lounge の表情を笑顔にした版" },
  "references": [
    {
      "generation_id": "abc123",
      "purpose": "composition",
      "aspect": "pose",
      "instruction": "上半身の姿勢と腕の位置を採用"
    }
  ],
  "refinement": null,
  "story": null,
  "experiment": null
}
```

  キー               必須   内容
  ------------------ ------ ------------------------------------------------------------
  `schema_version`   必須   `1`
  `request`          必須   人間の指示と枚数（[request](#request)）
  `generation`       必須   何をどう描くか（[generation](#generation)）
  `semantic`         必須   各 Generation に書き込む semantic（[semantic](#semantic)）
  `references`       任意   生成材料にした過去 Generation（[references](#references)）
  `refinement`       任意   前 Batch を受けた再試行（[refinement](#refinement)）
  `story`            任意   Story 上の続き（[story](#story)）
  `experiment`       任意   ExperimentRun の実行（[experiment](#experiment)）

`references` / `refinement` / `story` / `experiment` は、キー省略と明示 `null` のどちらも
「該当なし」として受理します。

## request

  キー            型                 内容
  --------------- ------------------ ---------------------------------------------------
  `instruction`   string             人間の元指示。可能な限りそのまま保持する
  `count`         integer >= 1       Job 数
  `seeds`         integer[] / null   seed の明示（[Seeds](#seeds)）

`instruction` は Batch の `raw_instruction` になります。

## generation

  キー                  型                 内容
  --------------------- ------------------ ------------------------------------------------
  `recipe`              string             recipe 名。graph モードでも必須
  `parameters`          object             recipe の生成パラメータ。省略時は `{}`
  `presets`             array / null       Preset の版の pin
  `patches`             array / null       request 自身の差分
  `prompt`              string             positive prompt の全文上書き
  `negative_prompt`     string             negative prompt の全文上書き
  `graph`               object / null      ComfyUI graph をそのまま渡す graph モード
  `lint_waiver`         string / null      受領時 lint を飛ばす理由
  `identity_override`   string / null      identity_tags の消失を許す理由

### parameters

キーは recipe の語彙で、worker は未知のキーを拒否します。注記は `semantic.attributes`
に、実行される差分は `patches` に置きます。graph モード以外では `parameters.pose`
が必須です（`presets` が pose を pin していれば省けます）。

### presets

`[{ "kind": "pose", "name": "lounge", "version": 7 }]` の形で、各要素はちょうど
`kind` / `name` / `version`（integer >= 1）を持ちます。通常は brain が書かず、chimera が
requests 行を作るときに `parameters` の pose / costume / expression から解決して焼き込み
ます。解決の規則、明示したときの `parameters` との一致検証、400 になる条件は
[worker-protocol.md「preset の pin」](worker-protocol.md#preset-の-pin)にあります。

### patches

patch は `{ "target", "op", "reason", ... }` で、`reason` は全 patch で必須です。語彙は
[domain-model.md「ExperimentRun」](domain-model.md#experimentrun)の overrides と同じもので、
パーツ単位の target `prompt.positive.<part>` は
[worker-protocol.md「prompt のパーツ単位 patch」](worker-protocol.md#prompt-のパーツ単位-patch)
にあります。preset の patches は常にこれより先に適用されます
（[patches の順序](worker-protocol.md#patches-の順序)）。

### 併用できない組み合わせ

全文上書きと差分の積み上げは適用順が定義できず、graph モードはそれ自体が仕様の全部なので、
次の組み合わせは worker が拒否します。

  キー                               併用できないもの
  ---------------------------------- ---------------------------------------------------
  `patches`                          `graph`、`prompt` / `negative_prompt`
  `presets`                          `graph`、`prompt` / `negative_prompt`
  `experiment.overrides.patches`     `generation.patches`、`graph`、`prompt` / `negative_prompt`

`presets` と `patches` は併用できます（派生 = 派生元 + 差分）。

### graph

空でない ComfyUI graph（node id → node）です。worker は graph を組み立てず、`seed` を持つ
node の seed と SaveImage の `filename_prefix` だけを書き換えて投入します。`recipe` は
その graph が何かを示す名前として必須です。preset の pin の対象外です。

### lint_waiver と identity_override

どちらも非空文字列の理由で、真偽値ではありません。粒度は request 全体で、省略が既定です。

-   `lint_waiver`: worker の受領時 lint を飛ばし、`result` に理由を残します
    （[受領時 lint](worker-protocol.md#受領時-lint)）。
-   `identity_override`: patch や全文上書きで identity_tags が prompt から消えても描画し、
    Generation の `semantic.attributes` に理由と消えたタグを記録します。無ければその
    request は `failed` です（[identity の上書き](worker-protocol.md#identity-の上書き)）。

## semantic

`summary`（非空文字列）が必須です。この request が何を試し、base から何を変えたかを
書きます。形は [Semantic Metadata](domain-model.md#semantic-metadata) で、worker は ingest
した全 Generation にこれを書き込みます。その際 `attributes` に `seed` と `parameters` の
pose / costume などを足し、`patches` があればそれも足します。

## references

0..m 件です。

  キー              必須   内容
  ----------------- ------ -------------------------------------------------
  `generation_id`   必須   参照した Generation（UUID / short_id）
  `purpose`         任意   参照の目的
  `aspect`          任意   参照した側面
  `instruction`     任意   何を採用したか

各要素は Batch の BatchReference になります
（[domain-model.md](domain-model.md#batchreference)）。

purpose 推奨値:

``` text
composition
reference
rebuild
continuity
```

aspect 推奨値（拡張可能）:

``` text
pose
expression
outfit
style
composition
other
```

Experiment が `base_generation_id` を持つとき、Run 由来の request.json は purpose
`rebuild` の Reference を自動で1件持ちます。brain が組み立てるものではありません
（[experiment-agent.md](experiment-agent.md#base_generation_id)）。

## refinement

前 Batch を受けた再試行の場合だけ指定します。Batch の BatchRelation になります。

``` json
{
  "source_batch_id": "B001",
  "actor": "claude",
  "reason": "手の破綻が多かったためpromptを修正"
}
```

  キー                必須   内容
  ------------------- ------ -------------------------------------
  `source_batch_id`   必須   再試行元の Batch
  `actor`             必須   `human` / `claude`
  `reason`            任意   再試行の理由
  `raw_instruction`   任意   再試行を指示した人間の元指示

## story

Story 上の続きの場合だけ指定します。Batch の StoryRelation になります。

``` json
{
  "story_id": "story-id",
  "previous_batch_ids": ["B042"],
  "transition": {
    "label": "夕方の海辺へ",
    "description": "衣装と絵柄を維持しつつ、夕方の海辺へ場面を移す"
  }
}
```

  キー                   必須   内容
  ---------------------- ------ -------------------------------------------------
  `story_id`             必須   Story
  `previous_batch_ids`   必須   直前の Batch（1件以上）
  `transition`           任意   `label` / `description`（どちらも任意）
  `raw_instruction`      任意   人間の元指示

分岐と合流を表せるよう `previous_batch_ids` は配列です。`label` / `description` は brain
が人間の会話から生成します。

## experiment

ExperimentRun を実行する request です。通常は Run 作成時に chimera が組み立てます。

``` json
{
  "experiment_id": "...",
  "run_id": "...",
  "overrides": { "patches": [] }
}
```

  キー              必須   内容
  ----------------- ------ ------------------------------------------------------
  `experiment_id`   必須   Experiment
  `run_id`          必須   ExperimentRun
  `overrides`       任意   Run の `overrides` をそのまま（`{}` か `{"patches": [...]}`）

`overrides.patches` は `generation.patches` と同じ語彙で、worker はこれを request の
patches として適用します。

chimera は requests 行を作るとき、Run が存在しなければ 404、Run の Experiment が
`experiment_id` と違えば 400 を返し、通れば行に `run_id` を記録します。その request が
`done` になるとき、chimera は `result.batch_id` を同じトランザクションで
`experiment_runs.batch_id` に付けます（[Update Request](worker-protocol.md#update-request)）。
Run の代表 Generation は評価後に人間または agent が選ぶもので、worker は設定しません。

## Seeds

通常 brain は seed を決めず、`count` だけを渡します。worker が Job ごとに seed を生成し、
Job に記録します。

再現が必要なときだけ `seeds` で明示します。件数は `count` と一致させます。

``` json
{
  "request": {
    "count": 1,
    "seeds": [123456789]
  }
}
```

## Validation Principles

検証は2か所で行います。chimera で落ちたものは requests 行にならず、worker で落ちたものは
requests 行が `failed` になり `error` に理由が残ります。

chimera（requests 行の作成時）:

-   `schema_version` が `1`、`request` / `generation` がオブジェクトであること。
-   preset の pin の解決（名前が無ければ 400）。
-   `experiment.run_id` があれば Run の存在と `experiment_id` への所属。
-   `idempotency_key` の再送は、`kind` と payload の正規化ハッシュが一致すれば既存行を 200、
    違えば 409（[Create Request](worker-protocol.md#create-request)）。pin した版もハッシュに
    入ります。

worker（claim 後、ComfyUI へ行く前）:

-   `semantic.summary` が非空であること。
-   `count >= 1`、`seeds` 指定時は `len(seeds) == count`。
-   `parameters` の語彙、[併用できない組み合わせ](#併用できない組み合わせ)、patch の形。
-   preset の受領時 lint と identity_tags の保持。
-   `references` の Generation、`refinement` の source Batch、`story` の Story と
    previous Batch の存在（worker が Batch を作るとき chimera が 404 を返す）。

Batch / Job の idempotency key は worker が requests 行の `id` から導出するので、同じ
request を再実行しても重複 Batch は作られません（[キーの導出](worker-protocol.md#キーの導出)）。
