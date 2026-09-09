# Worker Protocol

chimera を control plane、GPU 機を worker とする配置での repo をまたぐ契約です。requests
キューのスキーマ、状態遷移、API、generate / finalize / repair / masked_redraw の payload、`recipe_ref`
を定めます。段階 2（poll 方式）を対象とし、段階 3 の WorkerHub は概略だけ触れます。

決定の経緯は oolong `notes/2026-09-05_note-comfyui-recipes-mac-off-the-path.md`。

## 配置と責務

``` text
brain（Mac の Claude Code / Cloudflare OS Agent / Human）
  │  request を積む・結果を読む            ← chimera としか話さない
  ▼
chimera（Cloudflare Workers + D1 + R2）     control plane。判断はしない
  │  requests キュー / GUI / MCP
  ▲  poll（段階 2）/ WebSocket push（段階 3）
  │
worker（Windows GPU 機、LAN）
  ├── comfy-recipes watch                  requests を claim して実行し、結果を ingest
  └── ComfyUI localhost                    worker からしか到達できない
```

  主体      持つもの                                                                     持たないもの
  --------- ---------------------------------------------------------------------------- ---------------------------------------------
  brain     生成意図の解釈、request.json、rating / semantic の読み書き                   ComfyUI への経路
  chimera   requests 行と preset の正本、claim / heartbeat / 状態遷移、GUI、MCP          生成の判断、graph の解釈、prompt 本文の解釈
  worker    recipe の checkout、preset の解決と lint、graph 構築、ComfyUI 実行、ingest   Experiment の意味論、evaluation

Mac から ComfyUI への経路は LAN でも持ちません。「直 POST 禁止」は構造で担保されます。

## requests テーブル

backfill 行（後述「ExperimentRun 由来の generate」の移行手順）の id だけは例外で
`bf-{run_id}` を使います。一度きりの移行専用の値で、以後 chimera が発行する id
はすべて UUIDv7 です。

``` text
id                TEXT PRIMARY KEY            UUIDv7
kind              TEXT NOT NULL               generate | finalize | repair | masked_redraw
status            TEXT NOT NULL               queued | running | done | failed | cancelled
payload_json      TEXT NOT NULL               kind ごとの payload（後述）
payload_hash      TEXT NOT NULL               kind + 正規化 payload の SHA-256（idempotency 再送の一致判定）
recipe_ref        TEXT NOT NULL DEFAULT 'production'
run_id            TEXT REFERENCES experiment_runs(id)   ExperimentRun 由来の generate のみ
worker_id         TEXT                        claim した worker
attempt           INTEGER NOT NULL DEFAULT 0  claim された回数
max_attempts      INTEGER NOT NULL DEFAULT 3
claimed_at        TEXT
heartbeat_at      TEXT
finished_at       TEXT
error             TEXT                        failed の理由（worker が書く）
result_json       TEXT                        done の結果（後述）
idempotency_key   TEXT NOT NULL UNIQUE
created_by        TEXT NOT NULL               brain | mcp | gui | system
created_at        TEXT NOT NULL
updated_at        TEXT NOT NULL
```

index: `(status, created_at)`（claim の走査）、`run_id`、`worker_id`。

requests 行は物理削除しません。`cancelled` は queued からだけ入れる終端で、GUI
の誤操作を取り消すためのものです。

### 状態遷移

``` text
queued ──claim──▶ running ──PATCH done──▶ done
  │                  │
  │                  ├──PATCH failed──▶ failed
  │                  │
  │                  └──heartbeat 途絶──▶ queued（attempt < max_attempts）
  │                                    └▶ failed（attempt >= max_attempts、error = "heartbeat timeout"）
  └──PATCH cancelled──▶ cancelled
```

heartbeat 途絶の判定は「`status = running` かつ `heartbeat_at` が 5 分より古い」です。段階 2
では cron を持たず、claim の直前に stale 行を戻します（claim を呼ぶ worker が
いる限り回収され、いなければ回収の必要もありません）。段階 3 では WorkerHub の
alarm が同じ規則で回収します。

戻す先を queued にするのは、途絶の大半が worker の再起動・回線断で、生成自体は
やり直せるためです。ただし再実行が重複 Batch を作ってはいけないので、worker
は Batch / Job の `idempotency_key` を requests 行の `id` から導出します（後述）。

## API

`/api/v1/requests` 配下。すべて Cloudflare Access の内側で、worker は既存の
Service Token を使います。

### Create Request

``` text
POST /api/v1/requests
```

``` json
{
  "kind": "finalize",
  "payload": { "generation_id": "...", "options": { "repin": true } },
  "recipe_ref": "production",
  "idempotency_key": "gui:finalize:abc123:0192d3a8-…",
  "created_by": "gui"
}
```

201 で行を返します。`idempotency_key` の再送は、`kind` と payload の正規化ハッシュが
一致するときだけ既存行を 200 で返し、同じキーで別の `kind` / payload が来たら 409 です
（`requests.payload_hash` に保存）。Batch / Job の「同じ要求の再送は 200」と同じ契約で、
「同じキーで別の要求」を弾く点だけ厳しくしています。

`run_id` は `kind = generate` かつ `payload.experiment.run_id` があるときに chimera が
転記します。転記の前に、Run の存在、`payload.experiment.experiment_id` との所属一致、
`kind = generate` をサーバー側で検証し、外れていれば 400 です。`kind = finalize` /
`kind = repair` / `kind = masked_redraw` の payload に `experiment` があっても無視します。

`created_by` は記録用のラベルで、権限境界ではありません。chimera は単一ユーザー運用で、
Cloudflare Access の内側にいる主体（人間の GUI、brain の Service Token、worker の Service
Token）を区別せず、いずれも全 `kind` を積めます。「GUI が積んでよいのは finalize
だけ（手足の repair は finalize の option として乗せる）」は GUI のコードが finalize の
form しか持たないことで保っており、API が `created_by`
を見て拒否するものではありません。書き手を自分以外に広げるときは、Access の identity
（`Cf-Access-Authenticated-User-Email` / Service Token の `common_name`）から `created_by` を
サーバー側で確定し、`created_by` ごとの `kind` / `generation.graph` の受理可否を設けます
（後述の注意と同じ）。

`recipe_ref` は `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$` だけを検証し、存在は確認しません。
省略時の既定は wrangler の var `REQUESTS_DEFAULT_RECIPE_REF`（`production`）で、Run
自動起票、`POST /requests`、MCP `create_request` の全てに効きます。
存在しない ref は worker 側で `failed`（error に checkout 失敗）になります。

### List Requests

``` text
GET /api/v1/requests?status=queued|running|done|failed|cancelled&kind=&run_id=&limit=&offset=
```

読み取り専用。GUI と brain の状況確認用で、claim は伴いません。`?pending=true` は
`status=queued` の別名です。

### Claim

``` text
POST /api/v1/requests/claim
```

``` json
{ "worker_id": "gpu-box-1", "kinds": ["generate", "finalize", "repair", "masked_redraw"] }
```

`worker_id` は worker のホスト名です。`kinds` は省略すると全種です。masked redraw 対応の
段階 2 の box は4つとも受けます。旧 worker を混在させる場合は、旧 worker に
`kinds: ["generate", "finalize", "repair"]` を指定して masked_redraw を claim しないようにし、
対応版 worker だけが `masked_redraw` を含めます。

queued の最古の 1 件を `running` にして 200 で返します。無ければ 204。1 文の
`UPDATE ... WHERE id = (SELECT id FROM requests WHERE status = 'queued' AND kind IN (...) ORDER BY created_at LIMIT 1) RETURNING *`
で行い、複数 worker が同時に呼んでも同じ行を 2 度渡しません。claim は
`worker_id` / `claimed_at` / `heartbeat_at` を書き、`attempt` を +1 します。

GET + PATCH の 2 段にしない理由: 2 段では GET と PATCH の間に別 worker
が同じ行を取る競合があり、それを PATCH 側の条件付き更新で弾くと worker
は結局リトライループを書くことになります。1 文の claim にすれば worker 側は
「返ってきた行を実行する」だけで済み、段階 3 で push に変わっても worker
の受け取り口は同じ形（1 行が降ってくる）に保てます。

worker の poll 間隔は 30 秒を既定とします。段階 1 の watch と同じです。

### Update Request

``` text
PATCH /api/v1/requests/{id}
```

worker が書く遷移:

``` json
{ "status": "running", "worker_id": "gpu-box-1" }
{ "status": "done", "worker_id": "gpu-box-1", "result": { "batch_id": "...", "generation_ids": ["..."] } }
{ "status": "failed", "worker_id": "gpu-box-1", "error": "..." }
```

`{ "status": "running" }` は heartbeat です。worker は実行中 30 秒ごとに送り（ComfyUI
の完了待ち 10 秒 poll の中から打つ）、chimera は `heartbeat_at` を更新します。`worker_id` が claim 時のものと異なる PATCH は 409
です（stale と判定されて別 worker に渡った後の、旧 worker からの書き込みを弾く）。

brain / GUI が書く遷移:

``` json
{ "status": "cancelled" }
```

queued 以外からの cancelled は 409。done / failed / cancelled は終端で、以後の
PATCH は 409 です。

`run_id` を持つ generate の `done` は `result.batch_id` が必須（無ければ 400）で、
chimera は requests 行の更新と `experiment_runs.batch_id` の attach を D1 の batch
（単一トランザクション）で行います。request だけが done になって Run に batch が付かない
状態は作りません。Run に既に別の batch が付いていれば 409 で、requests 行も done
になりません。worker が別途 `PATCH /api/v1/experiment-runs/{run_id}` を送る必要は
なくなりますが、送っても既存の attach-only 規則で同じ batch なら 200 です。

### Get Request

``` text
GET /api/v1/requests/{id}
```

### result

``` json
{ "batch_id": "...", "generation_ids": ["...", "..."] }
```

generate は作った Batch と ingest した Generation。finalize は納品 Batch（source
Generation への `rebuild` Reference と source Batch への Refinement を持つ、現行
`finalize.py` と同じ）と、その Generation です。repair も同じ形（納品 Batch と
その Generation）で、finalize と同じ Refinement 系譜を持ちます。masked_redraw も
同じ形ですが、元 Generation を変更せず、明示したマスク領域だけを worker が
`comfyui-recipes` の masked-img2img / inpaint adapter に渡します。

## payload

### generate

`payload` は request.json schema v1 をそのまま包みます（[generation-request.md](generation-request.md)）。

``` json
{
  "kind": "generate",
  "payload": {
    "schema_version": 1,
    "request": { "instruction": "...", "count": 3, "seeds": null },
    "generation": {
      "recipe": "yukari",
      "parameters": { "pose": "lounge" },
      "presets": [{ "kind": "pose", "name": "lounge", "version": 7 }],
      "patches": null,
      "graph": null
    },
    "semantic": { "summary": "..." },
    "experiment": { "experiment_id": "...", "run_id": "...", "overrides": { "patches": [] } }
  }
}
```

worker は payload を `request.json` として書き出し `comfy-recipes generate --request`
に渡します。翻訳層はありません。

#### preset の pin

chimera は requests 行を作るときに `generation.parameters` の pose / costume /
expression を Preset の版へ解決し、`generation.presets` に焼き込みます
（[domain-model.md](domain-model.md#preset)）。

-   版を明示されなければ、その名前の最新の `active` 版を pin します。
-   `presets` を明示して渡された場合はそれを尊重し、`parameters` からの解決はしません。
-   名前が presets に無ければ 400（`preset not found: {recipe}/{kind}/{name}`）です。
-   ただしその `recipe` の preset が presets に1件も無ければ、何も pin せずに通します。
    段階 A の import をまだ流していない recipe で generate が止まらないようにするためで、
    1件でも入っていれば上の 400 が効きます。
-   `generation.graph` を持つ graph-mode の payload と、`generation.recipe` の無い payload は
    pin の対象外です。

pin は request 作成時に一度だけ行います。heartbeat 途絶で queued へ戻って再実行されても
版は動きません。版は `payload_hash` に入るので、版が違えば別の request です。

worker は pin された版を `GET /api/v1/presets/{recipe}/{kind}/{name}/{version}` で引きます。
版は不変なので、一度引いた本文はローカルに永続 cache して構いません。

#### 受領時 lint

worker は claim した request の preset を解決した直後に lint をかけます。落ちたら ComfyUI へは
行かず、request を `failed`（error: `preset lint failed: {理由}`）にします。

これは検査の移設ではなく新設です。comfyui-recipes の CI が守っているのは costume block の
fingerprint（`scripts/costume_check.py`）と pose × costume の prompt / graph の sha256 snapshot
（`tests/test_yukari_contract.py`）で、どちらも checkout の中身に対する検査です。prompt の
矛盾検査（`conflicts()`）が実行時に走るのは `generation.prompt` と `negative_prompt` が両方
明示されたときだけで、`--force` で外せます。受領時 lint は、その checkout 由来の検査が
届かない「chimera から来た preset」に対して、実際に走る prompt を走る直前に見ます。

意図的に矛盾する prompt ペアを組む必要は実在するので、逃げ道を payload 側に持ちます。
`generation.lint` に `"skip"` を渡すと worker は lint を飛ばし、`result` にその旨を残します。
既定は省略（= lint する）です。

### finalize

``` json
{
  "kind": "finalize",
  "payload": {
    "generation_id": "abc123",
    "options": {
      "denoise": null,
      "repin": false,
      "recolor": false,
      "keep_legwear": null,
      "route": null,
      "finalizer": null,
      "size": null,
      "handdrawn": false,
      "skin": false,
      "toe_guard": null,
      "keep_scene": false,
      "transparent": null,
      "backdrop": null,
      "upscale": null,
      "lora_strength": null,
      "deliver_size": null,
      "stroke_light": null,
      "repair": null,
      "repair_regions": null,
      "repair_denoise": null,
      "repair_pad": null,
      "repair_size": null
    }
  }
}
```

`generation_id` は UUID でも short_id でもよく、worker は既存の
`GET /api/v1/generations/{id}/context` で解決します。`options` は `comfy-recipes finalize`
の引数に 1 対 1 で写します。

  options             型                        CLI
  ------------------- ------------------------- ------------------------------
  denoise             null | number             `--denoise 0.55`（null は recipe 既定。IL 併用 0.55、Anima 単体 0.75 など recipe が持つ）
  repin               bool                      `--repin`
  recolor             bool                      `--recolor`
  keep_legwear        null | true | number      `--keep-legwear`（true は既定 0.62、number はその値）
  route               null | "latent" | "pixel" `--latent-route` / `--pixel-route`（null は recipe 既定）
  finalizer           null | string             `--finalizer MODEL`
  size                null | integer            `--size LONGEST`
  handdrawn           bool                      `--handdrawn`
  skin                bool                      `--skin`
  toe_guard           null | true | number      `--toe-guard [WEIGHT]`
  keep_scene          bool                      `--keep-scene`
  transparent         null | bool               `--opaque` が false（null は recipe 既定）
  backdrop            null | string             `--backdrop #RRGGBB`
  upscale             null | "bicubic" | "nearest-exact" | "bilinear" | "lanczos"  `--upscale METHOD`
  lora_strength       null | number             `--lora-strength 0..2`
  deliver_size        null | integer            `--deliver-size LONGEST`（納品ファイルの長辺、redraw は size のまま）
  stroke_light        null | "n".."nw"          `--stroke-light DIR`（8 方位、紫縁を光源側で細く影側で太く）
  repair              null | array\<"hands" \| "feet"\>  `--repair hands,feet`（同じ finalize request に相乗りする repair。null / 省略 / 空配列は off）
  repair_regions      null | array\<[x0, y0, x1, y1]\>   `--repair-region X0,Y0,X1,Y1`（繰り返し指定可、width/height に対する分数。x0<x1 かつ y0<y1）
  repair_denoise      null | number (0, 1]      `--repair-denoise 0.6`
  repair_pad          null | number (0.5-3)     `--repair-pad 1.0`
  repair_size         null | integer（256 以上、8 の倍数） `--repair-size 1024`

省略したキーは false / null です。chimera が検証するのは型だけで、組み合わせの
妥当性（recipe が route を持つか等）は worker が判定して `failed` にします。`repair*`
の語彙は単体の repair request（後述）と揃えてあります。

GUI が積む finalize は `denoise` / `repin` / `recolor` / `keep_legwear`（true）/
`backdrop` / `stroke_light` に加えて、repair のチェックボックスを使った場合は
`repair` / `repair_pad` を持ち、他は省略します。`backdrop` は select の
`stripes`（既定）→ `"stripes"`、`transparent` → `null`、`color` → 入力した
`#RRGGBB` で、`stroke_light` は `none`（既定）→ `null`、それ以外は選んだ方位です。`recolor` は recipe `yukari` の Batch でだけ選べ、
`yukari-sketch` では常に false です（worker はそこで recolor を拒否します）。`denoise` の入力欄は空が既定で、空のまま積めば
`null`（recipe 既定）です。「repair hands」「repair feet」はどちらも既定オフで、
チェックした分だけ `repair` に積みます。`repair pad` の入力欄は空が既定で、
空のまま積めば省略（worker 既定）です。

### repair

既存 Generation の手足（hands / feet）だけをマスクして局所的に redraw する
worker 実行です。finalize と同じく semantic 判断を伴わない再実行で、GUI が積んで
よい2種類目の kind です（comfyui-recipes 側の実装は別リポジトリ）。

``` json
{
  "kind": "repair",
  "payload": {
    "generation_id": "abc123",
    "options": {
      "parts": ["hands", "feet"],
      "regions": [[0.1, 0.7, 0.5, 0.95]],
      "denoise": 0.6,
      "seeds": [1, 2, 3, 4],
      "size": 1024,
      "pad": 1.0
    }
  }
}
```

`generation_id` は finalize と同じく UUID / short_id のどちらでもよく、finalize
バッチの sibling（source Generation または納品 Generation のどちらか）でもよい
— worker が `GET /api/v1/generations/{id}/context` で解決して redraw 対象を決めます。

  options    型                              意味
  ---------- ------------------------------- ----------------------------------------------
  parts      array\<"hands" \| "feet"\>      redraw するパーツ（省略時 worker 既定で両方）
  regions    array\<[x0, y0, x1, y1]\>       width/height に対する分数の矩形（省略時 worker が自動検出）。x0<x1 かつ y0<y1
  denoise    number (0, 1]                   redraw の denoise 強度（省略時 recipe 既定）
  seeds      array\<integer\>（最大16件）    試す seed の列（省略時 worker 既定）
  size       integer（256 以上、8 の倍数）   redraw 解像度の長辺（省略時 recipe 既定）
  pad        number (0.5-3)                  検出領域の外側マージン係数（省略時 worker 既定）

省略したキーは worker 既定です。chimera が検証するのは型だけで、組み合わせの
妥当性は worker が判定して `failed` にします。

### masked_redraw

既存 Generation の任意の矩形領域を、comfyui-recipes の masked-img2img / inpaint
adapter で局所 redraw する worker 実行です。`repair` とは別の request kind であり、
`repair_generation` の hands / feet 専用 semantics は変わりません。GUI には追加せず、
semantic 判断主体が MCP `masked_redraw_generation` から積みます。

``` json
{
  "kind": "masked_redraw",
  "payload": {
    "generation_id": "abc123",
    "options": {
      "regions": [[0.18, 0.42, 0.86, 0.96]],
      "prompt_patch": "replace only the waist-to-hem garment with a long loose A-line mid-calf dress",
      "denoise": 0.48,
      "mask_padding": 24,
      "mask_feather": 8,
      "size": 768,
      "seeds": [101, 202]
    }
  }
}
```

  options          型                                      意味
  ---------------- --------------------------------------- ----------------------------------------------
  regions          array\<[x0, y0, x1, y1]\>               width/height に対する分数の矩形。1件以上必須。各値は0..1、x0<x1かつy0<y1、矩形同士は重複不可
  prompt_patch     non-empty string                        source prompt に適用する instruction / prompt patch。空文字は400
  denoise          number (0, 0.75]                        masked-img2img の denoise。低〜中程度は0.2〜0.65を推奨
  mask_padding     number (0..512)                         mask の外側へ足す pixel 数。省略時 worker / recipe 既定
  mask_feather     number (0..256)                         mask 境界をぼかす pixel 数。省略時 worker / recipe 既定
  pad              number (0..512)                         `mask_padding` の API 短縮 alias（受け付け後に canonicalize）
  feather          number (0..256)                         `mask_feather` の API 短縮 alias（受け付け後に canonicalize）
  size             integer（256以上、8の倍数）              redraw 解像度の長辺。省略時 recipe 既定
  seeds            array\<integer\>（最大16件）            試す seed の列。省略時 worker 既定

`mask_padding` と `pad`、`mask_feather` と `feather` はそれぞれ同時に指定できません。
alias は chimera が canonical key に正規化して保存・hash し、worker へは canonical key
だけを渡します。矩形の bounds / empty / overlap は chimera が400で拒否します。省略した optional key は
worker 既定です。chimera は prompt の意味や recipe の graph を解釈せず、worker は
`generation_id` を UUID / short_id で解決して元画像を読みます。

worker の永続化は次の形を必須とします。

1. source Generation は更新せず、request id から `Batch` / `ComfyJob` の idempotency key
   を導出して新しい refinement Batch を作る。
2. target Batch に `refinement` (`source_batch_id` = source Batch、`type` = `refinement`)
   と `references` (`source_generation_id` = source Generation、`purpose` = `rebuild`)
   を同じ作成リクエストで渡す。`aspect` は `masked_redraw`、`instruction` と
   `raw_instruction` は `prompt_patch` とする。
3. `parameters` / `prompt` に resolved source と masked-redraw options（regions、prompt
   patch、denoise、padding、feather、size、seeds）を保存し、後から request と Batch の
   両方だけで再現できるようにする。
4. 新しい Generation を target Batch に ingest し、`PATCH /requests/{id}` の `done.result`
   に target `batch_id` と ingest 済み `generation_ids` を返す。source の id を result に
   入れたり、source の画像を差し替えたりしてはいけない。

これは chimera 内に ComfyUI graph を複製する契約ではなく、comfyui-recipes 側の
inpaint/masked-img2img adapter に渡す narrow boundary です。recipe `yukari-sketch` を使う
場合も、finalize 後の確定サイズを source として扱い、手描き線・simple/grey background を
維持するかは worker/recipe の責務です。chimera は新しい画像生成や rating を行いません。

## idempotency と再実行の再開

### キーの導出

  対象            idempotency_key                                    備考
  --------------- -------------------------------------------------- -----------------------------------------
  requests 行     積む側が作る                                       GUI はボタン押下ごとに 1 つ生成（`gui:{kind}:{generation_short_id}:{uuid}`）し応答が返るまで再送に使い回す、brain は request ごとに 1 つ、Run 由来は `run:{run_id}`
  Batch           `request:{request_id}`                             worker が導出
  Job             `request:{request_id}:job:{index}`                 worker が導出。`index` は request 内の 0 始まり
  Generation      キー無し。`(comfy_job_id, comfy_output_index)` の unique   `comfy_job_id` は chimera の Job UUID（ComfyUI の prompt_id ではない）

worker は Batch / Job / Generation のいずれにも uuid4 を持ち込まず、requests 行の
`id` から全部を導出します。state.json はキャッシュであって正本ではなく、失っても
chimera への再送だけで同じ行に戻れます。

`(comfy_job_id, comfy_output_index)` の `comfy_job_id` は chimera が発行した Job の
UUID です。ComfyUI の prompt_id は `comfy_jobs.comfy_prompt_id` に別途記録する外部
識別子で、再実行で変わっても dedup には影響しません。同じ Job に対して 2 回目の
ComfyUI 実行が走り、同じ `comfy_output_index` を ingest すれば既存 Generation を 200 で
返します（画像は差し替えません）。

### 再送レスポンスに含めるもの

Batch / Job の `idempotency_key` 再送で 200 が返るとき、レスポンスは新規作成時と
同じ形に加えて再開に必要な情報を含めます。

``` json
{
  "id": "...", "short_id": "...", "status": "running",
  "jobs": [
    { "id": "...", "index": 0, "seed": 123, "status": "ingested", "comfy_prompt_id": "...",
      "generations": [{ "id": "...", "comfy_output_index": 0 }] },
    { "id": "...", "index": 1, "seed": 456, "status": "created", "comfy_prompt_id": null,
      "generations": [] }
  ]
}
```

`POST /api/v1/batches` の再送は `jobs[]`（各 Job の `seed` / `status` /
`comfy_prompt_id` / ingest 済み `generations[]`）を含み、`POST /api/v1/batches/{id}/jobs`
の再送は当該 Job の同じ形を返します。worker は `status = ingested` の Job を飛ばし、
それ以外を記録済み `seed` で再実行します。`graph` は再送レスポンスに含めません
（recipe と seed から再構築でき、同じ graph に戻るのは snapshot test が担保します）。

これは chimera 側の変更点です（今の再送は Batch が `serializeBatch` のみ、Job が
`id / batch_id / seed / index / status` のみ）。requests 実装と同じ PR で入れます。

### 再開の手順

worker が claim した requests 行（`attempt >= 2`）に対して:

1. `POST /api/v1/batches` を `request:{request_id}` で再送し、`jobs[]` を得る
2. `status = ingested` の Job は飛ばす
3. 残りの Job について `POST /batches/{id}/jobs` を同じキーで再送し、返った `seed` で生成
4. ingest は通常通り。既存 `(comfy_job_id, comfy_output_index)` は 200 で戻る
5. 全 Job が ingested になったら `PATCH /requests/{id}` に `done`

finalize / repair / masked_redraw の再実行も同じ規則です。source Generation ごとに新しい納品 Batch を
作るのは仕様で、同じ requests 行の再実行だけが同じ Batch に戻ります。

## ExperimentRun 由来の generate

案: 一本化する。Run を作ると chimera が `kind = generate` の requests 行を自動起票し、
worker は requests だけを見ます。

- 起票のタイミングは `POST /api/v1/experiments/{id}/runs`（MCP `create_run` も同じ関数）で、
  Experiment に `base_recipe` があり status が active / stabilized のときだけ。Run の INSERT と
  requests 行の INSERT は D1 の batch で 1 トランザクションにし、片方だけが残る状態を
  作りません。
  無い Run は起票されず、後から Experiment に `base_recipe` を付けても自動では
  起票されません（`POST /api/v1/requests` で明示的に積む）。
- payload は今 `watch.build_request` が Run から組み立てているものと同じ
  `schema_version: 1` の request.json を chimera 側で作ります。`base_parameters`
  の `count` を `request.count` に抜き、残りを `generation.parameters` に入れ、
  `objective` を `request.instruction` と `semantic.summary` に写します。
  語彙の解釈はしません（詰め替えだけ）。
- `idempotency_key` は `run:{run_id}`。Run は物理削除されず、1 Run につき起票は 1 回です。
- `done` で `experiment_runs.batch_id` を attach するのは上記の通り chimera が行います。
- `GET /api/v1/experiment-runs?pending=true` は残しますが、migration 後は
  「`batch_id IS NULL` かつ requests 行を持たない Run」だけを返します。backfill 直後は空で、
  以後も Run 作成時に自動起票される限り空です。段階 1 の watch（このエンドポイントを
  poll する版）が移行後も box で動き続けていても、同じ Run を requests 版と二重に
  実行することはありません。worker の切り替えが済んだら状況確認用の読み取りに留めます。
  docs/experiment-agent.md の runner 節はこの文書を指すよう書き換えます。
- 移行: requests テーブルを作る migration で、`batch_id IS NULL` かつ Experiment が
  active / stabilized の既存 Run について requests 行を backfill します
  （`created_by = system`、payload は同じ規則）。順序は次の通りで、どの時点でも同じ Run を
  2 つの worker が取ることはありません。
  1. box で段階 1 の watch を止める（logon タスクを無効化）
  2. chimera で migration（テーブル作成 + backfill）を適用し、`pending=true` の条件変更を
     含む Worker を deploy する。この間 box には worker がいない
  3. box で `comfy-recipes work` を起動する
  migration と deploy の間に段階 1 の watch が動いていても、`pending=true` は backfill
  済みの Run を返さないので二重実行にはなりません（1 を省いた場合の保険）。

並存させない理由: worker が 2 つのキューを見ると、優先順位・heartbeat・失敗の記録が
2 系統になり、段階 3 の push も 2 種類になります。Run から request への詰め替えは
機械的で、chimera がやっても「判断しない」境界を越えません。

## GUI

段階 2 の GUI は requests 行を積むことと status を表示することだけです。

- Generation Detail: `Finalize` ボタン。`repin` / `recolor` / `keep-legwear` のチェックボックスと
  `denoise`（空 = recipe 既定）を持ち、`POST /api/v1/requests`（`created_by = gui`）を積む。
  積んだ後はボタンの横に最新 request の status（queued / running / done / failed）と、
  done なら納品 Generation へのリンクを出す。
- Generation Detail: `Repair` ボタン。`hands` / `feet` のチェックボックス（既定両方 on）、
  `denoise` / `seeds` / `pad`（空 = worker 既定）、`regions`（1行1矩形のテキスト入力、
  空 = worker 自動検出）を持ち、同じく `POST /api/v1/requests`（`kind = repair`,
  `created_by = gui`）を積む。ボタン横の status 表示は Finalize と同じ。
- Batch Detail: `Finalize all arms`。その Batch の全 Generation について同じ options で
  requests 行を積む（1 Generation 1 行）。repair に「all arms」相当は無い（Generation 単位
  でしか積めない）。
- 進捗の step 表示は段階 3。

不変条件の文言は次の通り改めます。

> GUI が積んでよいのは semantic 判断を伴わない再実行（finalize / repair）だけ。GUI が触る
> のは自分の D1 の requests 行のみで、ComfyUI へは到達しない。

Compare が比較表示のみである点は変わりません。

## MCP

`/mcp` に次を足します。

``` text
create_request(kind, payload, recipe_ref?, idempotency_key)
finalize_generation(generation_id, options?, idempotency_key)
repair_generation(generation_id, options?, idempotency_key)
masked_redraw_generation(generation_id, options, idempotency_key)
get_request(id)
list_requests(status?, kind?, run_id?)
derive_request(from_generation_id, instruction, count?, seeds?, parameters?, patches?, replace_patches?, semantic, reference?, idempotency_key, recipe_ref?)
list_presets(recipe?, kind?, include_deprecated?)
get_preset(recipe, kind, name, version?)
promote_to_pose(generation_id, name, kind?, note?, idempotency_key)
```

`create_run` は上記の自動起票により、追加の tool を呼ばなくても worker に届きます。

`finalize_generation` / `repair_generation` / `masked_redraw_generation` は `create_request` と同じ
`kind: "finalize"` / `"repair"` / `"masked_redraw"` の requests 行を積む別窓口です。`generation_id`（UUID / short_id どちらでも
可）を解決して `payload.generation_id` に short_id を詰め、`options` を渡された場合だけ
そのまま `payload.options` に載せます（各 kind の options 表と zod スキーマを共有）。
masked redraw の `pad` / `feather` alias は canonical key に正規化されます。手で payload の封筒を組み立てる `create_request` に対して、
この3つは finalize / repair / masked redraw に特化した窓口です。masked redraw は options
（regions / prompt_patch / denoise / mask_padding / mask_feather）が必須です。

`derive_request` は `create_request` と同じ `kind: "generate"` の requests 行を積む
別窓口です。手で payload 全体を組み立てる代わりに、既存の Generation の Batch から
`recipe` / `parameters` / `patches` を引き継いだ payload を chimera 側で組み立てます。
指定した Generation が finalize / repair / masked_redraw 済みなら、その元になった raw の Generation
まで遡ってから引き継ぎます（[experiment-agent.md](experiment-agent.md#tool)）。worker
から見える requests 行の形・claim/状態遷移は `create_request` 由来のものと変わりません。

`promote_to_pose` は `rating = good` の Generation を新しい Preset の版にします。起点
Generation の Batch から `recipe` と pin されていた preset の版を、Generation から
`semantic.attributes.patches` を取り、`{ base, patches }` の body を組み立てて
`(recipe, kind, name)` の次の版として INSERT します。`name` を既存の名前にすれば
その名前の新版、新しい名前にすればその名前の version 1 です。`kind` の既定は `pose`。
rating が good でなければ 409（`promote requires rating good`）、起点 Batch が
graph-mode で recipe を持たなければ 409 です。既存の版は書き換えません。

指定した Generation が finalize / repair / masked_redraw 済みなら、`derive_request` と同じ規則で
元になった raw の Generation まで遡ってから起点にします。rating を見るのは指定された
Generation で、`recipe` と base と patches は遡った先から取ります。

base になる版は、その Batch を作った generate request が pin していた版です。段階 B より
前に作られた Generation には pin が無いので、その場合は `base_version` で明示します。
どちらも無ければ 409（`no pinned preset for this generation; pass base_version`）です。
chimera は base を推測しません。`idempotency_key` の再送は、既に作られた版をそのまま返します。

`list_presets` / `get_preset` は preset の読み取り側です。`list_presets` は名前と版の
一覧（`record` の本文は含まない）、`get_preset` は解決済みの本文（`record` 1件と平坦化
した patches）を返します。版を省略すると最新の `active` 版を見ます。段階 C で
`list_catalog` / `get_catalog_pose` を置き換えます。

## 段階 3: WorkerHub

WorkerHub（Durable Object、Hibernation API、単一インスタンスを `idFromName('global')`
で運用）に worker と GUI が outbound で WebSocket を張り、requests 行の作成を push、
worker から status / progress を返します。**socket は合図と進捗の通知路であって、
正本は D1 のままです。claim / PATCH の HTTP 契約（段階 2）は変わりません** — push は
それの前倒しにすぎず、socket が繋がっていなくても poll だけで段階 2 と同じに動きます。

### エンドポイント

``` text
GET /api/v1/worker/ws      worker 用アップグレード。Access の Service Token、アプリ内認証は無し
GET /api/v1/requests/ws    GUI viewer 用アップグレード
```

いずれも WebSocket アップグレードでない場合は 426 `{ "error": { "code": "upgrade_required", "message": "..." } }`
を返します。`role`（worker / viewer）はエンドポイントのパスで決まり、chimera 側のルーティングが
WorkerHub に渡すマーカーで、client 側からは指定できません。

permessage-deflate 等の WebSocket 拡張は一切ネゴシエートしません。フレームは常に生の
JSON テキストです。

### メッセージ

worker → hub:

``` text
{"type":"hello","worker_id":"<hostname>","kinds":["generate","finalize","repair","masked_redraw"]}   最初の1通
{"type":"progress","request_id":"...","phase":"submit|sampling|ingest|finalize","step":12,"total":28,"message":"..."}
{"type":"ping"}
```

`hello` の `kinds` は省略可（省略した worker は全 kind の `queued` を受け取る）。
`progress` の `step` / `total` / `message` は任意。`ping` は Hibernation の
auto-response（`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))`）
が DO を起こさずに `{"type":"pong"}` を返すので、通常は `webSocketMessage` まで届きません。

hub → worker:

``` text
{"type":"hello_ack","server_time":"<ISO>"}                                  hello への応答
{"type":"queued","request_id":"...","kind":"...","recipe_ref":"..."}        新規 / 再キュー時
```

hub → viewer:

``` text
{"type":"snapshot","progress":[...],"workers":[{"worker_id":...,"kinds":...,"connected_at":...}]}   接続直後
{"type":"progress","request_id":"...","worker_id":"...","phase":"...","step":...,"total":...,"message":...,"at":"<ISO>"}
{"type":"status","request_id":"...","status":"queued|running|done|failed|cancelled","kind":"..."}
```

未知の `type` は無視します。パースできないフレームも無視します。viewer から来たメッセージは
（`type` を問わず）常に無視します — viewer は読み取り専用です。

### broadcast の規則

- `queued` は接続中の worker のうち、`kinds` にその `kind` を含むものだけに送ります。
  `hello` をまだ送っていない worker（`kinds` 未設定）は全 kind を受け取ります。
- `status` は接続中の viewer 全員に送ります（`kinds` によるフィルタはありません）。
- DO storage には `progress:<request_id>` に最新の progress を1件だけ持ちます。viewer が
  後から繋いだときの `snapshot` はここから組み立てます。`status` が done / failed /
  cancelled を運ぶと、そのエントリを削除します（完了した request の進捗をいつまでも
  返さないため）。

### alarm（stale running の回収）

`hello` の受信、または内部 `/notify` の呼び出しのたびに、alarm が未設定なら
`ctx.storage.setAlarm(now + 60s)` します。`alarm()` は `requeueStaleRunning`
（`src/lib/requests.ts`、`claimRequest` と共有する同一の SQL — `status = running` かつ
`heartbeat_at` が5分より古い行を、`attempt < max_attempts` なら `queued` に、それ以外は
`error = "heartbeat timeout"` で `failed` にする）を実行し、`queued` に戻った行は
worker へ `queued` を、`failed` になった行は viewer へ `status` を broadcast してから、
自身を `now + 60s` で再スケジュールします。段階 2 と同じ回収規則を、claim を待たずに
定期的にも走らせるだけで、判定条件そのものは変えません。

### 再接続

worker / GUI とも close イベントで 1秒 → 2秒 → 4秒 …と倍々に増やし、上限60秒でリトライします
（GUI は上限30秒）。worker は再接続後、繋がっていなかった間に届いたはずの `queued` を
取りこぼしている可能性があるため、一度だけ `POST /api/v1/requests/claim` を呼んで
追いつきます（以後は通常どおり push を待つ）。

アップグレード時の 403 は Service Token の期限切れです。worker は既存の claim /
heartbeat の 403 と同様にログへ出して再接続を続け、chimera 側は何もしません。

## preset の移行

catalog の publish（recipes → chimera）を止め、preset の正本を chimera に置くまでの段です。
段は独立して merge でき、A と B の間はどちらの経路でも動きます。上の「段階 2 / 3 / 4」
（poll / WorkerHub / ref ごとの worktree）とは別軸なので、字で呼び分けます。

-   段階 A、catalog の取り込み。publish 済みの catalog を presets へ入れます。
    `POST /api/v1/presets/import` が `recipe_catalogs` の recipes[].poses / costumes /
    expressions を `source = import` の version 1 として INSERT します。同じ
    `(recipe, kind, name)` が既にあれば飛ばすので、何度呼んでも同じ結果です。
    comfyui-recipes 側は変えません。この時点で catalog と presets の両方から同じ
    preset が見えます。
-   段階 B、正本の切り替え。chimera が request に版を pin し、worker が `poses.py` では
    なく presets を読みます。受領時 lint をここで入れ、`promote_to_pose` を MCP に足します。
-   段階 C、旧経路の撤去。`poses.py` と catalog publish を落とします。
    `PUT /api/v1/catalogs/{recipe_ref}` と MCP `list_catalog` / `get_catalog_pose` を廃止し、
    `recipe_catalogs` テーブルを deprecate します。experiments JSONL の書き先も chimera の
    Experiment / Run に寄せます。この時点で comfyui-recipes に残るのは compiler、imaging、
    loop、lint だけです。
-   段階 D、worker の畳み込み。loop を ComfyUI の custom node pack の thread にします。
    GPU 機の常駐が ComfyUI 一つになり、deploy は custom_nodes の git pull と restart だけに
    なります。chimera 側の契約はここでは変わりません。

段階 B で失うのは「prompt がコードと同じ commit に乗る」ことだけです。preset が版を持ち、
request が版を pin し、`payload_hash` に版が入るので、再現性は今と同じです。

リスクと対応:

-   preset が無審査で本番に入る。promote は `rating = good` の Generation からしか作れず、
    Rating は人間しか書けません。PR review より審査は厳しくなります。
-   agent が preset を壊す。promote は非破壊で新しい版を足すだけです。既存の版は残り、
    request 側が版を指名します。
-   lint が CI から消えて気付きにくい。受領時 lint の失敗は request を `failed` にするので、
    CI より遅く気付くことはありません。
-   chimera が落ちると preset を引けない。claim 自体 chimera を要するので、cache が効く窓は
    「claim 済みで preset 未解決の request」だけです。版が不変なので cache は素直に効きます。

## 注意

- worker は `generation.graph` を受け取った場合そのまま ComfyUI へ流します。request の
  書き手を自分のエージェント以外に広げる場合は、graph モードを worker 側で許可制にし、
  chimera 側でも `created_by` ごとに `generation.graph` の受理可否を設ける。
- `recipe_ref` は preset が chimera に移った後は「何が描かれたか」を特定しません。特定するのは
  `(git_commit, 解決済みの preset の版)` の組で、worker は Batch を作るときに解決した版を
  記録します。`recipe_ref` が指すのはコードのブランチだけになります。
- `recipe_ref` は origin のブランチ名に限ります。段階 2 の worker は自分の checkout
  のブランチと一致する `recipe_ref` だけを受け、違えば `failed`
  （error: `recipe_ref not served: {ref}`）にします。watch プロセス自身がその checkout
  から動いているため、実行中に別 ref を checkout する仕組み（ref ごとの worktree）は
  段階 4 のリリース経路と一緒に入れます。段階 4 以降は `git fetch origin` の後
  `origin/{recipe_ref}` を commit に解決してから detached で checkout します。照合対象は
  checkout 後のブランチ名ではなく解決前の remote ref で、解決できなければ `failed`
  （error: `recipe_ref not found: {ref}`）、解決した commit は `result.recipe_commit` に
  記録します。ローカルブランチや任意 commit は受けません。既定の `production` は
  昇格 PR の merge でしか動かないブランチです。
- Service Token の期限切れは claim / heartbeat の 403 として現れます。worker は
  ログに出して poll を続け、chimera 側は何もしません。
