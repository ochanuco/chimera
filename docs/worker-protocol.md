# Worker Protocol

chimera を control plane、GPU 機を worker とする配置での repo をまたぐ契約です。requests
キューのスキーマ、状態遷移、API、generate / redraw / deliver / repair / masked_redraw（と読み取り専用の finalize）の payload、`recipe_ref`
を定めます。段階 2（poll 方式）と段階 3（WorkerHub による push）の両方を対象とし、いずれも本番で稼働しています。

決定の経緯は oolong `notes/2026-09-05_note-comfyui-recipes-mac-off-the-path.md`。

## 配置と責務

``` text
brain（Mac の Claude Code / MCP client の Agent / Human）
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
  chimera   requests 行と派生 preset の正本、claim / 状態遷移、GUI、MCP                  生成の判断、graph の解釈、prompt 本文の解釈
  worker    recipe の checkout、preset の解決と lint、graph 構築、ComfyUI 実行、ingest   Experiment の意味論、evaluation

Mac から ComfyUI への経路は LAN でも持ちません。「直 POST 禁止」は構造で担保されます。

## requests テーブル

``` text
id                TEXT PRIMARY KEY            UUIDv7
kind              TEXT NOT NULL               generate | finalize | redraw | repair | masked_redraw | deliver | dof
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

backfill 行（「[ExperimentRun 由来の generate](#experimentrun-由来の-generate)」の移行手順）の
id だけは例外で `bf-{run_id}` を使います。一度きりの移行専用の値で、以後 chimera が発行する id
はすべて UUIDv7 です。

index: `(status, created_at)`（claim の走査）、`run_id`、`worker_id`。

requests 行は物理削除しません。`cancelled` は queued からだけ入れる終端で、GUI
の誤操作を取り消すためのものです。

### 状態遷移

``` text
queued ──claim──▶ running ──PATCH done──▶ done
  │                  │
  │                  ├──PATCH failed──▶ failed
  │                  │
  │                  ├──PATCH queued（release）──▶ queued（attempt < max_attempts）
  │                  │                          └▶ failed（attempt >= max_attempts）
  │                  │
  │                  └──heartbeat 途絶──▶ queued（attempt < max_attempts）
  │                                    └▶ failed（attempt >= max_attempts、error = "heartbeat timeout"）
  └──PATCH cancelled──▶ cancelled
```

heartbeat 途絶の判定は「`status = running` かつ `heartbeat_at` が 5 分より古い」です。段階 2
では cron を持たず、claim の直前に stale 行を戻します（claim を呼ぶ worker が
いる限り回収され、いなければ回収の必要もありません）。段階 3 では WorkerHub の
alarm が同じ規則で回収します。

release は worker が自分から手放す遷移で、途絶の判定を待たずに同じ結果へ行きます。
再起動から戻った worker は、自分が落ちたことを知っている唯一の主体です。それを閾値で
推測させると、回線が一瞬切れただけの worker から仕事を取り上げないための 5 分の余裕と、
自分の再起動を早く申告したいという要求が、同じつまみの取り合いになります。申告できる
なら閾値は触りません。`worker_id` が claim 時のものと一致する `running` 行だけが対象で、
attempt の扱いは途絶と同じ規則です。

戻す先を queued にするのは、途絶の大半が worker の再起動・回線断で、生成自体は
やり直せるためです。ただし再実行が重複 Job を作ってはいけないので、worker
は Job の `idempotency_key` を requests 行の `id` から導出します（後述）。

## API

`/api/v1/requests` 配下。すべて Cloudflare Access の内側で、worker は既存の
Service Token を使います。

### Create Request

``` text
POST /api/v1/requests
```

``` json
{
  "kind": "deliver",
  "payload": { "generation_id": "...", "options": { "repin": true } },
  "recipe_ref": "production",
  "idempotency_key": "gui:deliver:abc123:0192d3a8-…",
  "created_by": "gui"
}
```

201 で行を返します。行には作成時に `short_id`（6 文字の英数小文字）を発行します。`short_id` は
Claim の応答と `GET /requests/{id}` にも含まれます。
`idempotency_key` の再送は、`kind` と payload の正規化ハッシュが
一致するときだけ既存行を 200 で返し、同じキーで別の `kind` / payload が来たら 409 です
（`requests.payload_hash` に保存）。Job の「同じ要求の再送は 200」と同じ契約で、
「同じキーで別の要求」を弾く点だけ厳しくしています。

`run_id` は `kind = generate` かつ `payload.experiment.run_id` があるときに chimera が
転記します。転記の前に Run の存在を検証し、無ければ 404 です。存在すれば
`payload.experiment.experiment_id` がその Run の所属 Experiment と一致するかを検証し、
食い違えば 400（`payload.experiment.experiment_id does not match the run's experiment`）
です。`kind = redraw` / `kind = deliver` / `kind = repair` / `kind = masked_redraw` の payload に
`experiment` があっても無視します。

`kind = finalize` は作れません（`POST /api/v1/requests` も MCP `create_request` も 400 で、
`redraw`（絵を変える）か `deliver`（切り抜いて仕上げる）を使うよう促すメッセージを返します）。
読み取りは変わりません（[finalize](#finalize)）。

`created_by` は記録用のラベルで、権限境界ではありません。chimera は単一ユーザー運用で、
Cloudflare Access の内側にいる主体（人間の GUI、brain の Service Token、worker の Service
Token）を区別せず、いずれも全 `kind` を積めます（finalize を除く）。「GUI が積んでよいのは redraw / deliver /
repair と、リロール、pin の再描画（絵柄チェック）だけ」は GUI のコードがそれらの form / ボタンしか
持たないことで保っており、API が `created_by`
を見て拒否するものではありません。書き手を自分以外に広げるときは、Access の identity
（`Cf-Access-Authenticated-User-Email` / Service Token の `common_name`）から `created_by` を
サーバー側で確定し、`created_by` ごとの `kind` / `generation.graph` の受理可否を設けます
（後述の注意と同じ）。

`recipe_ref` は `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$` だけを検証し、存在は確認しません。
省略時の既定は wrangler の var `REQUESTS_DEFAULT_RECIPE_REF`（`production`）で、Run
自動起票、`POST /requests`、MCP `create_request` の全てに効きます。
存在しない ref は worker 側で `failed`（error に checkout 失敗）になります。

#### kind = import

手加工・合成・poster などキューを通らない画像を登録する枠です。worker は claim しません。
登録する側が `status: "done"` を付けて作り、解決済みの値を同じボディに平置きで渡します
（[Resolution](#resolution) の PUT と同じ項目。`parameters` は必須）。

``` json
{
  "kind": "import",
  "status": "done",
  "idempotency_key": "import:…",
  "created_by": "brain",
  "recipe": null,
  "raw_instruction": "手加工",
  "parameters": { "kind": "hand-edit" },
  "git_commit": "abc1234",
  "git_dirty": false
}
```

`payload` は任意で、省略時は `{"schema_version": 1, "request": {"instruction": <raw_instruction>}}` を
保存します。再送の一致は payload と解決済みの値の両方で見ます（`idempotency_key` が同じで内容が
違えば 409）。`finished_at` は作成時刻で、claim も `PATCH`（cancelled を含む）も受け付けません（409）。
作成後は `POST /requests/{id}/jobs` で Job を作り、通常どおり ingest します。
Job の status は ingest で `ingested` になるので、`PATCH /jobs/{id}` で進める必要はありません。

worker を通さずに描いた ExperimentRun の結果（`GET /experiment-runs?pending=true` から拾った Run）は、
`run_id` を付けた import として登録します。その Run を指す Request ができるので Run は pending から外れ、
Run の結果はこの Request になります。存在しない Run は 404、既に Request を持つ Run は 409 です。
`run_id` は import 以外の kind では受け付けません（400）。

実際に送った prompt は Job の `graph`（`PATCH /jobs/{id}`）から読みます。graph の無い画像に prompt は残りません。
identity guard の許可（`identity_override` / `identity_removed`）は、Generation の `semantic.attributes` に記録します。

### List Requests

``` text
GET /api/v1/requests?status=queued|running|done|failed|cancelled&kind=&run_id=&worker_id=&limit=&offset=
```

読み取り専用。GUI と brain の状況確認用で、claim は伴いません。`?pending=true` は
`status=queued` の別名です。

`worker_id` は worker が起動時に自分の取りこぼしを拾うためのものです。
`?status=running&worker_id=<self>` が、自分が claim したまま落ちた行を返します。それぞれに
release を投げれば、途絶の 5 分を待たずに queued へ戻せます。bulk の口は持ちません。
落ちた worker が抱えている行は多くて数件で、まとめる利得より、1 行ずつ 409 で弾かれる
ことの分かりやすさの方が勝ります。

### Claim

``` text
POST /api/v1/requests/claim
```

``` json
{ "worker_id": "gpu-box-1", "kinds": ["generate", "redraw", "repair", "masked_redraw", "deliver", "dof"] }
```

`worker_id` は worker のホスト名です。`kinds` は省略すると全種です。masked redraw 対応の
段階 2 の box は4つとも受けます。旧 worker を混在させる場合は、旧 worker に
`kinds: ["generate", "repair"]` を指定して masked_redraw を claim しないようにし、
対応版 worker だけが `masked_redraw` を含めます。`kinds` に `finalize` や `import` を入れると 400 です。

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
{ "status": "done", "worker_id": "gpu-box-1", "result": { "generation_ids": ["..."] } }
{ "status": "failed", "worker_id": "gpu-box-1", "error": "..." }
{ "status": "queued", "worker_id": "gpu-box-1" }
```

`{ "status": "queued" }` は release です。自分が claim したまま落ちた行を、途絶の 5 分を
待たずに手放します。`running` 以外からは 409、`worker_id` が claim 時と違えば 409。
`attempt >= max_attempts` なら `failed`（error は `released after max attempts`）になり、
そうでなければ `queued` に戻って `worker_id` が外れます。attempt はここでは動きません
（次の claim で増えます）。

`{ "status": "running" }` は heartbeat です。worker は実行中 30 秒ごとに送り（ComfyUI
の完了待ち 10 秒 poll の中から打つ）、chimera は `heartbeat_at` を更新します。`worker_id` が claim 時のものと異なる PATCH は 409
です（stale と判定されて別 worker に渡った後の、旧 worker からの書き込みを弾く）。

brain / GUI が書く遷移:

``` json
{ "status": "cancelled" }
```

queued 以外からの cancelled は 409。done / failed / cancelled は終端で、以後の
PATCH は 409 です。

`run_id` を持つ generate の `done` は、Run の結果をその Request の `run_id` で引くので、
worker が別途 `PATCH /api/v1/experiment-runs/{run_id}` を送る必要はありません。

### Get Request

``` text
GET /api/v1/requests/{id}
```

### Timings

``` text
PUT /api/v1/requests/{id}/timings
```

worker は最終 PATCH（done / failed / release）が返った後に、その試行の計測を best-effort で送ります。失敗しても
Request の結果には影響させません（再送は同じ (request_id, attempt, version) の行を置き換えます）。時刻はすべて
worker 機の epoch ミリ秒で、所要時間は送らず chimera が導出します。

``` jsonc
{
  "worker_id": "gpu-box-1",
  "attempt": 1,              // claim した requests 行の attempt
  "version": "v2",           // 計測方式。v1 | v2
  "source": "worker",        // worker | comfy_history | requests
  "status": "done",          // done | failed | cancelled | released
  "claimed_at": 0,           // claim の応答を受けた時刻 (nullable)
  "finished_at": 0,          // 最終 PATCH が返った時刻 (nullable)
  "env": { "comfyui_version": "0.37.0", "argv": ["..."], "attention": "ck", "pytorch_version": "...",
           "worker_commit": "...", "worker_dirty": false, "gpu_name": "...", "gpu_driver": "..." },  // nullable、各項目も nullable
  "cold_load": true,         // loader 系ノードが cache されず実行された (nullable)
  "prompts": [{
    "prompt_id": "uuid", "purpose": "render",   // render | pose_detect | 他の短い slug
    "resumed": false,                           // ComfyUI が既に知っていた prompt
    "submitted_at": 0, "execution_start_at": 0, "execution_end_at": 0,   // execution_* は /history の messages 由来
    "outputs_ready_at": 0,      // 完了した history を worker が見た時刻
    "ingested_at": 0,           // 出力を chimera に登録し終えた時刻
    "status": "success",        // success | error | interrupted | unknown
    "nodes": [{ "node_id": "3", "class_type": "KSampler", "role": "base_sampler", "cached": false,
                "started_at": 0, "ended_at": 0, "steps_total": 30, "step_ms": [410, 395] }]
  }]
}
```

応答は 200 `{ "ok": true }`。Request が無ければ 404。各時刻は nullable で、cached ノードの `started_at` / `ended_at` は null です。
`comfy_job_id` は `prompt_id` を `comfy_jobs.comfy_prompt_id` で引いて chimera が解決します。`role` は worker が
ノードの `_meta.title` に書く安定名（`base_sampler` `hires_sampler` `vae_decode` `unet_loader` `save_image` など、
無ければ snake_case の `class_type`、重複は `_2` `_3`）です。

計測行が無い Request は、集計側が `requests` 行の `finished_at - claimed_at` を v1（source `requests`）の所要時間として
扱います（実体化はしません）。ComfyUI の `/history` スナップショットは
`POST /api/v1/timings/import-comfy-history`（[api.md](api.md#timings)）で v1 / `comfy_history` として取り込みます。

### result

``` json
{ "generation_ids": ["...", "..."] }
```

ingest した Generation の id です。redraw / deliver / repair / masked_redraw（と古い finalize）の Generation は、
Job の `source_generation_id` を `refines_generation_id` として持ちます。masked_redraw は元 Generation を変更せず、明示したマスク領域だけを worker が
`comfyui-recipes` の masked-img2img / inpaint adapter に渡します。

redraw / deliver / repair / masked_redraw の done はこれに加えて `resolved_options`
（`payload.options` のうち dial word を worker が実際に解決した数値に置き換えたもの、
[deliver profile](#deliver-profile) 参照）を持ちます。chimera は `result` を不透明な
JSON として保存するだけで、この欄の形を検証も解釈もしません。

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
-   `presets` を明示して渡された場合、その pin は版ごと尊重し、pin されていない kind だけを
    `parameters` から解決します。`derive_request` が「一部の kind だけ pin を引き継ぎ、残りは
    呼び出し側の指名」という payload を組むので、明示があったら丸ごと手を引くと残りが pin
    されないまま通ります。
-   名前が presets に無ければ 400（`preset not found: {recipe}/{kind}/{name}`）です。
-   ただしその `recipe` の preset が presets に1件も無ければ、何も pin せずに通します。
    段階 A の import をまだ流していない recipe で generate が止まらないようにするためです。
-   その `recipe` にその kind の行が1件も無ければ、その kind は pin せずに通します。
    import が作るのは pose だけで、costume / expression は catalog に名前の配列でしか
    載らないので（[domain-model.md](domain-model.md#preset)）、`parameters.costume` /
    `parameters.expression` の上書きは pin されずに worker へそのまま渡ります。行が
    1件でもある kind で名前が無いときだけ上の 400 が効きます。
-   `generation.graph` を持つ graph-mode の payload と、`generation.recipe` の無い payload は
    pin の対象外です。

`parameters.pose` は pin 後も残ります。省きません。preset の名前と、その下にある recipe の
pose 名は別の事実だからです。`lounge@1` は `recipe_pose` も `lounge` ですが、そこから
`lounge-relaxed` という名前で昇格した版の `recipe_pose` は `lounge` のままです。
`parameters.pose` が持つのは前者（呼び出し側が指名した preset の名前）で、worker は preset を
解決したあとこれを `recipe_pose` で置き換えてから graph を組みます。

呼び出し側が `generation.presets` を明示した場合だけ、両者が食い違いえます。その場合は
`parameters` の同じ kind の値と pin の `name` が一致することを chimera が検証し、違えば 400
（`parameters.{kind} does not match the pinned preset`）です。どちらが勝つかを worker に
決めさせません。

pin は request 作成時に一度だけ行います。heartbeat 途絶で queued へ戻って再実行されても
版は動きません。版は `payload_hash` に入るので、版が違えば別の request です。

worker は pin された版を `GET /api/v1/presets/{recipe}/{kind}/{name}/{version}` で引きます。
版は不変なので、一度引いた本文はローカルに永続 cache して構いません。

#### patches の順序

preset が patches を持つので、patch の入口は preset・`generation.patches`・
`experiment.overrides.patches` の3つになります。適用順は preset が常に先で、その後に
`generation.patches` / `experiment.overrides.patches` です。この順は派生の意味そのもの
（派生 = 派生元 + α）なので、preset と `generation.patches` の併用は禁止しません。

worker が resolution に記録する `patches` は request 自身の分（α）だけで、preset 側の分は
含みません。preset の分は `preset_versions_json` の版を解決すれば出るので、両方書くと
昇格と派生がそれを二重に取り込みます。

`PUT /requests/{id}/resolution` は `patches` が空でないとき `pose_fingerprint` を必須にします
（無ければ 400）。patches を持つ Request は昇格の材料なので、fingerprint を欠くとその
preset だけ base の drift を検出できなくなります。graph モードの Request はどちらも
持たないので、両方省けば通ります。

`generation.prompt` / `negative_prompt` による全文上書きと preset の併用は、今まで通り
禁止です。全文上書きは patch の積み上げと順序が定義できません。

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
`generation.lint_waiver` に理由の文字列を渡すと worker は lint を飛ばし、`result` に理由を
残します。非空文字列であること自体が waiver で、真偽値ではなく理由を要求するのは、patch が
全件 `reason` を要求しているのと同じ理由です。粒度は request 全体で、既定は省略（= lint する）。

#### prompt のパーツ単位 patch

recipe が prompt をパーツに分けている場合、catalog の pose は `parts`
（`[{"name": "<part>", "text": "<segment>"}]`、text を順に連結すると pose の positive と
byte 一致）を持ち、recipe は `parts`（パーツ名の並び）と `identity_tags`（髪色・目の色・
サイドロック・髪飾り・カーディガンやフードなどの bare タグ）を持ちます。パーツを持たない
recipe（`yukari`）もあります。catalog の `patches` の語彙には `text.part_target` と
`overrides.identity_override` が載ります。

patch の target `prompt.positive.<part>` はそのパーツの text だけを編集します。op は
`append` / `prepend` / `replace` / `remove` で、他の target と同じです。`prompt.positive`
全体を replace すると identity_tags まで巻き込んで消しやすいので、表情・背景・ポーズだけを
変えるときはパーツ target を使います。repair / masked_redraw の Generation の render_facts に
残る prompt は、マスク領域用に顔・髪・フードのタグを落としたものなので、generate の prompt
として流用しません。`GET /api/v1/generations/{id}` はその Generation に
`comfy_job.prompt_not_reusable` を付けます（[api.md](api.md#generation-context)）。

#### identity の上書き

patch や `generation.prompt` の上書きの結果 identity_tags が prompt から消える request を、
worker は `failed` にします。`generation.identity_override` に理由の文字列を渡したときだけ
描画し、Generation の `semantic.attributes` に `identity_override`（理由）と
`identity_removed`（消えたタグ）を記録します。`lint_waiver` と同じく真偽値ではなく理由を
要求し、粒度は request 全体です。chimera は `generation` の中身を検証しないので、どちらの
キーも封筒を素通しします。MCP `derive_request` は `identity_override` 引数をこのキーに
写し、派生元の値は引き継ぎません。

### finalize

`kind = finalize` は redraw と deliver に分かれる前の種類です。古い行は読み取り専用で残り、一覧・`kind` の絞り込み・表示は動きますが、作成も claim もできません（`requests.kind` の CHECK は値を持ち続けます）。
finalize の出力 Generation は納品済みの絵として扱い、redraw / repair / deliver の入力にはできません。

### redraw

既存 Generation の絵そのものを描き直す worker 実行です。1 request で行う絵の変更は
`method` で選ぶ 1 つだけで、複数の操作は redraw を重ねます。出力は絵の Generation 1 枚で、
入力の Generation を `refines_generation_id` で指し、そのまま次の redraw / repair / masked_redraw /
deliver の入力にできます。

``` json
{
  "kind": "redraw",
  "payload": {
    "generation_id": "abc123",
    "options": { "method": "hires", "hires": 3072, "denoise": 0.45 }
  }
}
```

`generation_id` は UUID / short_id のどちらでもよく、`options` は必須です。`profile` は受けません。
`method` ごとに受けるキーが決まっていて、別の method のキーや未知のキーは 400 です。

  method   options                                                                          意味
  -------- --------------------------------------------------------------------------------- -------------------------------------------
  canvas   denoise, size, route, finalizer, upscale, keep_regions, keep_strength            キャンバス全体を描き直す
  hires    hires, denoise                                                                   同じ seed で大きく描き直す
  light    scene, from                                                                      光を入れ直す

  options         型
  --------------- --------------------------------------------------------------------------
  denoise (canvas)  null \| number \| word（null は recipe 既定。word の語彙は catalog の `recipes[].dials.redraw`）
  size            null \| integer（描き直しの長辺）
  route           null \| "latent" \| "pixel"（null は recipe 既定）
  finalizer       null \| string
  upscale         null \| "bicubic" \| "nearest-exact" \| "bilinear" \| "lanczos"
  keep_regions    array\<[x0, y0, x1, y1]\>（width/height に対する分数。x0<x1 かつ y0<y1。この矩形の中だけ元の絵をぼかした mask 越しに残す。null は不可で、無しはキー省略で表す）
  keep_strength   number（0 より大きく 1 未満。`keep_regions` の中に描き直しがどれだけ触るか、worker 既定 0.25。null は不可）
  hires           null \| 64 以上の integer（標準 canvas（1024x1640）の長辺を hires にしたときの画素数を元絵の縦横比のまま満たす大きさ。2048 は縦長 1280x2048、正方形 約 1616 四方）
  denoise (hires) null \| number (0, 1]（同 seed の pass の denoise。null は 0.45 で線まで描き直す、0.35 なら構図を保つ）
  scene           "sunset" \| "moon"（light のとき省略可。省略時は worker の既定）
  from            "n" \| "ne" \| "e" \| "se" \| "s" \| "sw" \| "w" \| "nw"（光が来る向き。worker 既定 `"nw"`）

chimera が検証するのは型と method の組み合わせだけで、画像に対する妥当性は worker が判定して
`failed` にします。受けられる入力は次のとおりです。

- hires: Anima（recipe `yukari`）の generate の出力だけ。graph の無い import 画像、repair / masked_redraw / redraw の出力、すでに hires 済みの graph は `failed`。元の ComfyUI graph に LatentUpscale と同じ seed の KSampler を足すので、prompt・LoRA・seed は graph のままです
- canvas と light: Anima の絵。repair / masked_redraw / redraw の出力も含む
- どの method も、納品済みの絵（deliver / 古い finalize の出力、`deliver_only` の repair、`hires-chain` の出力）と LayerDiffuse 由来の絵は受けず、Anima 以外の recipe の絵は描き直せません

word は `^[a-z][a-z0-9-]*$` にマッチする文字列で、実在確認と number への解決は worker が行います
（未知の word は `failed`）。catalog は `recipes[].redraw` に `light`
（`{"scenes": ["sunset", "moon"], "from": ["e", "n", "ne", "nw", "s", "se", "sw", "w"], "default_from": "nw"}`）と
method ごとの既定 `defaults`（`canvas`: `denoise` / `size` / `route`、`hires`: `hires_denoise`）を公開し、
chimera の WebUI フォームのプリセットもここから取っています。

### deliver

既存 Generation を切り抜いて飾り、納品の Generation を作る worker 実行です。絵は描き直しません。

``` json
{
  "kind": "deliver",
  "payload": {
    "generation_id": "abc123",
    "profile": { "name": "daily", "version": 3 },
    "options": {
      "repin": true,
      "stroke_light": "n",
      "backdrop": "dots",
      "outlines": [{ "color": "#ffffff", "width": 0.4 }, { "color": "#885b80", "width": 1.04 }],
      "deliver_size": 1536
    }
  }
}
```

`generation_id` は UUID / short_id のどちらでもよく、`options` と `profile` は省略できます。
受けるキーは次のとおりで、それ以外は 400 です。省略したキーは worker が base recipe の
既定（catalog の `recipes[].deliver.defaults`）から解決します。

  options        型
  -------------- --------------------------------------------------------------------------
  repin          bool（アクセント色の彩度を基準絵の帯域へ圧縮する。既定 true）
  recolor        bool（yukari のパレットに塗り直す）
  skin           bool
  keep_legwear   null \| true \| number \| word（true は既定 0.62、number はその値。word の語彙は catalog の `recipes[].dials.deliver`）
  keep_scene     bool（背景・景色を残す）
  transparent    null \| bool（`true` は背景なしで切り抜いた透過納品の明示形。`false` は `backdrop` が null でも背景を敷く）
  backdrop       null \| string（catalog `backdrops` の模様名か `#RRGGBB`。`null` は透過納品、ただし `transparent: false` なら除く。既定 `"dots"`）
  outlines       null \| [{color: "#rrggbb", width}]（フチのリスト、内側から外側へ 0〜6 本。`width` は長辺に対する %で 0 < width <= 5。省略または `null` は catalog の `recipes[].deliver.outlines.default`、`[]` はフチなし）
  stroke_light   null \| "even" \| "n".."nw"（一番外のフチの陰影。`"even"`（`null` も同じ）は一定の太さ、8 方位はフチを光源側で細く影側で太くし落ち影も付ける。陰影と押し出しは一番外のフチにかかり、落ち影も一番外のフチの外形に沿う。既定 `"n"`。`"none"` は 400 で、フチなしは `outlines: []`）
  deliver_size   null \| integer（納品ファイルの長辺）
  light          null \| {scene, from?}（下記）

`light` は光源です。`scene` は `"sunset"`（夕日）か `"moon"`（月明かり）で必須、`from` は光が来る向き
（8 方位、省略は `"nw"`）です。`light` を省略すると、入力の絵の系譜（`refines_generation_id`）でいちばん近い
method `light` の redraw の `scene` と `from` を引き継ぎ、`stroke_light` を省略した紫縁もその向きに揃います。
`stroke_light` に `light` の `from`（引き継いだものを含む）と違う方位を明示すると `failed` で、
`"even"` / `null` は併用できます。紫縁の陰影を、下地を描き直したときの光の向きに合わせるための規則です。

切り抜きの asset（`alpha`: 8 bit グレー PNG、`depth`、作ったときの条件を書いた `cut`: json）は、入力の
Generation（納品の Generation ではない）に付きます。最初の deliver が作り、次の deliver は `cut` と現在の
条件の一致を確かめて使い回し、違うときは作り直して同じ `(role, region)` を置換します。背景・紫縁・F 値だけを
変えた deliver は切り抜きをやり直しません。worker は asset を `GET /g/{generation uuid}/assets/{role}` で読みます。

deliver は出力の Generation に層の asset を付けます。いずれも出力と同じ寸法（`deliver_size` で縮めた後）の PNG で、
dof が読みます。

  role            内容
  --------------- --------------------------------------------------------------------
  layer-figure    人物（repin・前景色の推定後）。RGBA、alpha は切り抜き
  layer-outline   フチと落ち影。RGBA。フチなしで影も無ければ全透明
  layer-backdrop  背景。RGB。透過納品では付けない。`keep_scene` では元の場面

出力は納品の Generation 1 枚で、入力の Generation を
`refines_generation_id` で指します。入力にできるのは raw か描き直した絵で、納品済みの絵と LayerDiffuse 由来の
絵は受けません。chimera が検証するのは型だけで、組み合わせの妥当性（recipe が route を持つか等）は worker が
判定して `failed` にします。

`keep_legwear` の word は `^[a-z][a-z0-9-]*$` にマッチする文字列で、word の語彙は recipe ごとに catalog が
`recipes[].dials.deliver` として公開します。chimera はそれを表示にだけ使い、word が実在するかの検証と
number への解決は worker が行います（未知の word は `failed`）。catalog は既定を
`recipes[].deliver.defaults`、フチの既定と上限を `recipes[].deliver.outlines`（`{default: [{color, width}], max_count, max_width}`）、
`stroke_light` の選択肢を `recipes[].deliver.stroke_light`、単色の初期値を
`recipes[].deliver.backdrop_color`（`#RRGGBB`）として公開し、WebUI のフォームのプリセットもここから取っています。
catalog の envelope の `schema_version` は 1・2・3 を受けます（3 は `deliver.dof` を持たず、最上位の `dof` 節を持つ）。

GUI が積む deliver は `repin` / `recolor` / `keep_legwear` / `backdrop` / `outlines` に加えて、`紫縁` が `既定` なら
`stroke_light` と `light` を省略し（worker が引き継ぎ・既定から解決）、`立体` なら `光の向き` の方位、`均等` なら
`even` を `stroke_light` に積みます。`光源` を選んだときだけ `light: {scene, from}` を積みます
（`from` は `光の向き` の値）。`backdrop` は選んだカードの模様名 → その文字列、`透過 PNG` → `null`、`単色` → 入力した
`#RRGGBB` です。

#### deliver profile

profile は deliver options をまとめて一発で選ぶための、chimera 自身が持つ kind `deliver` の Preset です
（[domain-model.md](domain-model.md#preset)）。word（上の dial 語彙）が comfyui-recipes 側で定義されるのに対し、
profile は「どの word / 数値をどう組み合わせるか」という、良かった結果から人間が育てる chimera 側の再利用単位です。

`payload.profile` は `{ name, version? }`。chimera は requests 行を作るときに（`src/lib/presets.ts` の
`applyDeliverProfile`、payload を hash する前）、source Generation の Request が持つ `recipe` でその profile を
解決し（`version` 省略は最新 `active` 版）、`payload.options = { ...profile.options, ...payload.options }`
（`payload.options` の同じキーが勝つ。明示 `null` も含めて勝つ）と展開してから hash・保存します。`profile` 自身も
解決した版で `{ name, version }` に書き換えて保存します。未知の profile 名 / 版は 404 で、queued 行は作られません。
worker が読むのは展開済みの `payload.options` だけで、`payload.profile` は見ません。

body の形は次の通りです。pose/costume/expression の Preset と違い、base への参照も patches も持たない全文上書きです。

``` json
{ "options": { "keep_legwear": "on", "backdrop": "dots" } }
```

`POST /api/v1/presets/promote-profile`（body `{ generation_id, name, note?, idempotency_key }`）が新しい版を作ります。
`generation_id` は `rating = good` かつ deliver request が産んだ Generation でなければならず、それ以外は 409 です。
body は、その deliver request が queued した時点の `payload.options`（profile 展開後、word はそのまま）を
そのまま複製します。`name` が既存ならその次の版、新しい名前なら version 1 です。既存の版は書き換えません。

### dof

納品の Generation の層（`layer-figure` / `layer-outline` / `layer-backdrop`）から、被写界深度ボケの絵を作る worker 実行です。

``` json
{
  "kind": "dof",
  "payload": {
    "generation_id": "abc123",
    "options": { "focus": [0.82, 0.55], "f_number": 2.8, "scope": { "backdrop": true }, "viewfinder": "off" }
  }
}
```

`generation_id` は UUID / short_id のどちらでもよく、`options` は必須です。受けるキーは次のとおりで、それ以外は 400 です。

  options        型
  -------------- --------------------------------------------------------------------------
  focus          [x, y]、各 0〜1（入力画像の幅・高さに対する割合）。必須
  f_number       1.4〜22、省略は 2.8（小さいほど強くぼける）
  scope          {figure?, outline?, backdrop?}（ぼかす層。省略したキーは true。すべて false は 400）
  viewfinder     "off"（省略時） \| "on" \| "both"

奥行きは入力の元絵（`refines_generation_id` を deliver の入力へたどった絵）の `depth` asset を使います。無いか古ければ
worker が作って元絵に付けます（`cut` asset と同じ仕組み）。ボケは ComfyUI の graph で流し、背景 → フチ → 人物の順に、
オンの層だけぼかして重ねます。人物は人物の奥行き、フチは隣の人物の奥行き、背景は最も遠い面として扱います。
`viewfinder` の `"on"` は三分割グリッド・`focus` の位置のピント枠・下部のシャッター速度と F 値のバーを重ねた画像で、
`"both"` は重ねない画像と重ねた画像の 2 枚（`-dof` と `-viewfinder`）を出します。

入力にできるのは deliver の出力のうち層 asset を持つ絵だけです。層の無い古い納品の絵、dof の出力、それ以外は
worker が `failed` にします（納品し直す）。透過納品の絵に dof をかけた出力も透過のままです。出力は納品の Generation
（`is_delivered`）で、入力を `refines_generation_id` で指し、redraw・repair・masked_redraw・deliver・dof の入力にはなりません。
chimera が検証するのは型だけです。

catalog は最上位の `dof` 節に `f_number`（`min` / `max` / `default` / `stops`）、`scope` の既定（`figure` / `outline` /
`backdrop` の bool）、`viewfinder`（`{"values": ["off", "on", "both"], "default": "off"}`）、`focus` の説明、
`guide_radius_per_f` を公開します。

### repair

既存 Generation の手足（hands / feet）だけをマスクして局所的に redraw する
worker 実行です。redraw / deliver と同じく semantic 判断を伴わない再実行で、GUI が積んで
よい kind です（comfyui-recipes 側の実装は別リポジトリ）。

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
      "pad": 1.0,
      "lora": null
    }
  }
}
```

`generation_id` は UUID / short_id のどちらでもよく、raw か描き直した絵（納品済みの絵は不可）を指します
— worker が `GET /api/v1/generations/{id}/context` で解決して redraw 対象を決めます。

  options    型                              意味
  ---------- ------------------------------- ----------------------------------------------
  parts      array\<"hands" \| "feet"\>      redraw するパーツ（省略時 worker 既定で両方）
  regions    array\<[x0, y0, x1, y1]\>       width/height に対する分数の矩形（省略時 worker が自動検出）。x0<x1 かつ y0<y1
  denoise    number (0, 1] \| word           redraw の denoise 強度（省略時 recipe 既定）
  seeds      array\<integer\>（最大16件）    試す seed の列（省略時 worker 既定）
  size       integer（256 以上、8 の倍数）   redraw 解像度の長辺（省略時 recipe 既定）
  pad        number (0.5-3)                  検出領域の外側マージン係数（省略時 worker 既定）
  lora       null \| true \| number \| word   描き直した部位の part LoRA weight（true は既定 0.8、number はその値、省略/null は off）

省略したキーは worker 既定です。chimera が検証するのは型だけで、組み合わせの
妥当性は worker が判定して `failed` にします。`denoise` / `lora` は number / null
（`lora` は加えて `true`）に加えて、word 文字列（`^[a-z][a-z0-9-]*$`）も受け取ります —
語彙は catalog の `recipes[].dials.repair` です。

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
  denoise          number (0, 0.75] \| word                masked-img2img の denoise。低〜中程度は0.2〜0.65を推奨。word（`^[a-z][a-z0-9-]*$`）も受け取るが、masked_redraw 用の catalog dials namespace は今のところ無く、word の実在確認は worker に委ねる
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

1. source Generation は更新せず、request id から `ComfyJob` の idempotency key を導出する。
2. `PUT /requests/{id}/resolution` の `raw_instruction` に `prompt_patch` を、`parameters` に
   resolved source と masked-redraw options（regions、prompt patch、denoise、padding、
   feather、size、seeds）を保存し、後から request だけで再現できるようにする。
3. `POST /requests/{id}/jobs` に `source_generation_id`（source Generation）を渡す。
4. 新しい Generation を ingest し、`PATCH /requests/{id}` の `done.result` に ingest 済み
   `generation_ids` を返す。source の id を result に入れたり、source の画像を差し替えたり
   してはいけない。

これは chimera 内に ComfyUI graph を複製する契約ではなく、comfyui-recipes 側の
inpaint/masked-img2img adapter に渡す narrow boundary です。worker は source Generation
自身が持つ graph（`comfy_job.graph`、無ければ画像から再構成）をそのまま使って redraw する
ため、手描き線や背景をどう維持するかは source を描いた recipe の責務です。chimera は新しい
画像生成や rating を行いません。

## idempotency と再実行の再開

### キーの導出

  対象            idempotency_key                                    備考
  --------------- -------------------------------------------------- -----------------------------------------
  requests 行     積む側が作る                                       GUI はボタン押下ごとに 1 つ生成（`gui:{kind}:{generation_short_id}:{uuid}`）し応答が返るまで再送に使い回す（リロールは元絵と回ごとの `reroll:{元絵の id}:{回番号}`）、brain は request ごとに 1 つ、Run 由来は `run:{run_id}`
  Job             `request:{request_id}:job:{index}`                 worker が導出。`index` は request 内の 0 始まり
  Generation      キー無し。`(comfy_job_id, comfy_output_index)` の unique   `comfy_job_id` は chimera の Job UUID（ComfyUI の prompt_id ではない）

worker は Job / Generation のいずれにも uuid4 を持ち込まず、requests 行の
`id` から全部を導出します。state.json はキャッシュであって正本ではなく、失っても
chimera への再送だけで同じ行に戻れます。

`(comfy_job_id, comfy_output_index)` の `comfy_job_id` は chimera が発行した Job の
UUID です。ComfyUI の prompt_id は `comfy_jobs.comfy_prompt_id` に別途記録する外部
識別子で、再実行で変わっても dedup には影響しません。同じ Job に対して 2 回目の
ComfyUI 実行が走り、同じ `comfy_output_index` を ingest すれば既存 Generation を 200 で
返します（画像は差し替えません）。

### Resolution

claim した worker は、生成の前に解決済みの値を Request へ報告します。

``` text
PUT /api/v1/requests/{id}/resolution
```

``` json
{
  "recipe": "yukari",
  "raw_instruction": "…",
  "parameters": { "pose": "lounge" },
  "patches": [{ "target": "prompt.positive.pose", "op": "append", "reason": "…" }],
  "pose_fingerprint": "…",
  "preset_versions": [{ "kind": "pose", "name": "lounge", "version": 3 }],
  "git_commit": "abc1234",
  "git_dirty": false,
  "references": [{ "source_generation_id": "…", "purpose": "pose", "aspect": "composition", "instruction": "…" }],
  "worker_id": "…"
}
```

- 必須は `parameters` だけで、他は省略 / null 可（graph-mode の `recipe` は null）。`patches` が空でないとき `pose_fingerprint` は必須で、無ければ 400。`preset_versions` の省略は「触らない」
- `references[].source_generation_id` は `generation_id` でも受理し、UUID / short_id のどちらでも渡せる。無い Generation は 404。`purpose = rebuild` は保存しない（仕上げ元は Job の `source_generation_id` で表す）
- Job がまだ無い間は何度でも上書きできる。Job が 1 件でもあるときは、同じ値の再送だけが 200 で、違う値は 409
- `worker_id` が claim と違えば 409。cancelled の Request は 409
- Request の status は変えない（claim と `PATCH` が持つ）

応答は `{ "id", "short_id", "status", "jobs": [...] }` です。`jobs[]` は再開に必要な情報で、
各 Job の `index` / `seed` / `status` / `comfy_prompt_id` と ingest 済み `generations[]` を含みます。

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

`graph` は含めません（recipe と seed から再構築でき、同じ graph に戻るのは snapshot test が担保します）。

### Job

``` text
POST /api/v1/requests/{id}/jobs
{ "idempotency_key": "request:{request_id}:job:{index}", "seed": 123, "index": 0, "source_generation_id": "…" }
```

- resolution を報告する前は 409
- `kind` が redraw / deliver / repair / masked_redraw（と古い finalize）のとき `source_generation_id` は必須（無ければ 400、無い Generation は 404）。generate / import では指定できない（400）。UUID / short_id のどちらでも渡せる。1 Request に source の違う Job を持てる
- 新規は 201 で `{ id, request_id, seed, index, status: "created", comfy_prompt_id: null, source_generation_id, generations: [] }`。同じ `idempotency_key` の再送は 200 で同じ形に現在の `status` と ingest 済み `generations[]` を載せる
- ingest は `POST /api/v1/jobs/{jobId}/generations`。Generation は Job の Request と `source_generation_id`（`refines_generation_id`）を引き継ぐ

worker は `status = ingested` の Job を飛ばし、それ以外を記録済み `seed` で再実行します。

### 再開の手順

worker が claim した requests 行（`attempt >= 2`）に対して:

1. `PUT /api/v1/requests/{id}/resolution` を同じ値で再送し、`jobs[]` を得る
2. `status = ingested` の Job は飛ばす
3. 残りの Job について `POST /requests/{id}/jobs` を同じキーで再送し、返った `seed` で生成
4. ingest は通常通り。既存 `(comfy_job_id, comfy_output_index)` は 200 で戻る
5. 全 Job が ingested になったら `PATCH /requests/{id}` に `done`

redraw / deliver / repair / masked_redraw の再実行も同じ規則です。

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
- `GET /api/v1/experiment-runs?pending=true` は残しますが、migration 後は
  「requests 行を持たない Run」だけを返します。backfill 直後は空で、
  以後も Run 作成時に自動起票される限り空です。段階 1 の watch（このエンドポイントを
  poll する版）が移行後も box で動き続けていても、同じ Run を requests 版と二重に
  実行することはありません。worker の切り替えが済んだら状況確認用の読み取りに留めます。
- 移行: requests テーブルを作る migration で、結果をまだ持たず Experiment が
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

- Generation Detail には積む form が無く、最新 request の status（queued / running / done / failed）と、done なら出力 Generation へのリンクを出す。
  request は [ワークベンチ](ui.md#workbench)（`POST /api/v1/requests`、`kind = redraw` / `repair` / `masked_redraw` / `deliver` / `dof`、`created_by = gui`）から積む。
- redraw / deliver は Generation 単位でしか積めない（複数 Generation をまとめて積む画面は無い）。
- 進捗の step 表示は段階 3。
- 絵柄チェック (`/check`, [ui.md](ui.md#絵柄チェック)): 代表ポーズ (`src/lib/style-check.ts`
  の `STYLE_CHECK_POSES`) の pin を、今のカタログ既定でもう一度描く。`POST
  /api/v1/style-check/{recipe}` が pin を持つ pose ごとに `buildPlainRenderRequest`（MCP
  `plain_render` と同じ組み立て — pin の seed・recipe 既定のまま patches なし）で
  `kind = generate` を積む（`created_by = gui`）。GUI は prompt を一切書かない。pin が無い
  pose は skip され、応答にその旨が残る。idempotency key は描画内容のハッシュ
  `style-check:<recipe>:<pose>:<sha256>`（git commit は含めない）なので、描画内容が同じ間の
  連打は積み直さず既存行を返す。既定 recipe_ref のカタログ PUT 後にも同じ処理が自動で走る。

- リロール (`/reroll/{short_id}`, [ui.md](ui.md#リロール)): 元絵（raw Generation）の generate payload から
  `request.seeds` と `experiment` を外し、`request.count = 4` にして `kind = generate` を積む（`created_by = gui`、
  `recipe_ref` は元の Request と同じ）。recipe・parameters・patches・presets・references・semantic は元のまま
  なので、worker から見れば seed だけ違う通常の generate である。`requests.reroll_of_generation_id` に元絵の id を
  持ち、元絵 1 枚につき回ごとに 1 件。idempotency key は `reroll:<元絵の id>:<回番号>` で、`POST
  /api/v1/generations/{id}/reroll`（[api.md](api.md#reroll)）は直近の回が queued / running の間は既存行を返すので連打しても積み直さない。

GUI が積んでよい操作の範囲は [architecture.md](architecture.md#web-gui) の Web GUI
Responsibilities を参照してください。Compare が比較表示のみである点は変わりません。

## MCP

`/mcp` の tool のうち requests 行を積むもの（`create_run` の自動起票、`create_request`、`derive_request`、
`plain_render`、`redraw_generation` / `deliver_generation` / `dof_generation` / `repair_generation` / `masked_redraw_generation`）は、REST と同じ
規則で行を作ります。worker から見える行の形と claim / 状態遷移は REST 由来の行と変わりません。
tool ごとの契約と `created_by` は
[experiment-agent.md「requests キューに積む tool」](experiment-agent.md#requests-キューに積む-tool) が正本です。

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
{"type":"hello","worker_id":"<hostname>","kinds":["generate","deliver","repair","masked_redraw"]}   最初の1通
{"type":"progress","request_id":"...","phase":"submit|sampling|ingest|deliver","step":12,"total":28,"message":"..."}
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
{"type":"generation","generation_id":"...","short_id":"...","request_id":"...","refines_generation_short_id":"..."|null,"created_at":"<ISO>"}
{"type":"safety","generation_id":"...","short_id":"..."}
```

`generation` は Generation ingest (`POST /api/v1/jobs/{job_id}/generations`, worker-protocol.md
の外、[api.md](api.md#generation-ingest)) が新しい行を作ったときだけ送ります。同じ
`(comfy_job_id, comfy_output_index)` の再送（200、既存行を返すだけ）では送りません。
`refines_generation_short_id` はそのGenerationが`refines_generation_id`を持つときだけ
non-nullです（[domain-model.md](domain-model.md#generation)）。Gallery のカードを差し込むための
通知で、`snapshot`と違いDO storageにキャッシュを持たず、接続中のviewerへその場でbroadcast
するだけです（接続前に届いたものは取りこぼします — Gallery は元々ページ読み込み時点の
一覧を持っているので、取りこぼしても再読み込みで揃います）。

`safety` は `PUT /api/v1/generations/{id}/safety` が判定を保存したあとに送ります
（[api.md](api.md#safety)）。判定は `generation` の通知より数秒遅れて届くので、Gallery が
取得済みのカードのバッジを更新するための通知で、`generation` と同じくその場でbroadcastするだけです。

未知の `type` は無視します。パースできないフレームも無視します。viewer から来たメッセージは
（`type` を問わず）常に無視します — viewer は読み取り専用です。

### broadcast の規則

- `queued` は接続中の worker のうち、`kinds` にその `kind` を含むものだけに送ります。
  `hello` をまだ送っていない worker（`kinds` 未設定）は全 kind を受け取ります。
- `status` は接続中の viewer 全員に送ります（`kinds` によるフィルタはありません）。
- `generation` も接続中の viewer 全員に送ります。view（raw/refined/all）による絞り込みは
  viewer 側（GUI）の仕事で、hub は素通しします。
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

## GPU 機の起床

GPU 機はジョブも入力も無い状態が 10 分続くと自分でスリープし、寝ている間は claim にも
WorkerHub への接続にも来られません。どの経路のジョブも requests 行として chimera に積まれるので、
起こす役は chimera が担います。

- 新しく作った requests 行が `status = queued` なら、WorkerHub への `queued` 通知と一緒に
  wol API（docker01、`https://wol.chanu.co`）の `POST /wake` を `waitUntil` で投げます
  （`src/lib/gpu-wake.ts`）。REST・MCP・GUI のどの経路で積んだ行も同じ `notifyEnqueued` を通ります。
  `done` で作る `kind = import` は worker が claim しないので起こしません。claim 時の stale 戻しも、
  claim した worker が起きているので起こしません。
- `/wake` は冪等（online なら 200、それ以外は 202 で wol 側が online になるまで再送）なので、
  事前に状態を確かめません。スリープからは約 10 秒で戻り、worker は再接続後の claim で追いつきます。
- タイムアウト 5 秒・非 2xx・secret 未設定はログに残すだけで、行の作成は失敗させません。
- 認証は Cloudflare Access の service token `wol_client` で、Worker の secret
  `WOL_CLIENT_ID` / `WOL_CLIENT_SECRET` に持たせます（1Password `chabatake-services/wol`）。
- MCP `get_gpu_status` は wol API の `GET /status`（state は online / going_to_sleep /
  sleeping / offline / waking）をそのまま返します。

## preset の移行

昇格（承認済み Generation → 名前と版の付いた patches）を comfyui-recipes の PR 無しで
回せるようにするまでの段です。段は独立して merge でき、上の「段階 2 / 3 / 4」
（poll / WorkerHub / ref ごとの worktree）とは別軸なので、字で呼び分けます。

-   段階 A、pose の登録。publish 済み catalog の pose 名を `{ recipe_pose }` の参照として
    presets へ入れます（`POST /api/v1/presets/import`）。同じ `(recipe, kind, name)` が
    既にあれば飛ばすので、何度呼んでも同じ結果です。ただし最新 active 版の根が別の
    recipe pose なら、自名の `{ recipe_pose }` を根にした版を追記して付け替えます（`rerooted`）。本文は持たないので、この時点で
    comfyui-recipes 側の動作は何も変わりません。
-   段階 B、pin と昇格。chimera が request に版を pin し、worker が pin された preset を
    解決して patches を `generation.patches` の前に畳みます。受領時 lint と
    `promote_to_pose` をここで入れ、worker は resolution の報告時に patches と pose レコードの
    fingerprint を送るようになります。
-   段階 C、記録の集約。experiments JSONL を chimera に寄せます。ただし粒度が揃って
    いません。JSONL は「1 観測 1 レコード、append-only、反証されたら古いレコードを
    書き換えず新しいレコードを足す」という規約で、1 行は Run より細かく seed 単位の
    観測が混ざります。どちらを正本にするか（Run に畳むのか、Run の下に観測の層を
    足すのか）を決めてから着手します。
-   段階 D、worker の畳み込み。loop を ComfyUI の custom node pack の thread にします。
    GPU 機の常駐が ComfyUI 一つになり、deploy は custom_nodes の git pull と restart だけに
    なります。chimera 側の契約はここでは変わりません。

段階 D は deploy の作法を変えることを要求します。今 deploy は work を無条件に kill しますが、
ComfyUI の再起動は node pack や imaging が変わった deploy でしか起きません。つまり今は、
deploy で work が死んでも ComfyUI の生成は走り続け、再 claim した worker が state に残った
`comfy_prompt_id` を見て、ComfyUI がまだその prompt を知っていれば再投入せず待ちに戻ります。
走行中の生成が deploy を生き延びるのは、worker が別プロセスだからです。

worker が ComfyUI の thread になるとこれが成立しません。worker の再起動は必ず ComfyUI の
再起動で、走行中の生成はプロセスと一緒に死に、再 claim しても復帰先がありません。

代わりに deploy が drain します。restart の前に worker へ停止を伝え、worker は新しい claim を
止めて走行中の request を描き切ってから抜けます。復帰は失敗からの回復ですが、drain は
失敗を起こしません。今より良くなる方向で、GPU の仕事は 1 枚も捨てません。

drain は稀に起きることではなく毎回起きることです。今 ComfyUI を再起動するのは
`comfy_nodes` / imaging / `delivery_style.py` が変わった deploy だけですが、worker のコードが
ComfyUI のプロセスに import される以上、どこが変わっても再起動しないと反映されません。
段階 D では全 deploy が再起動になり、全 deploy が drain を待ちます。

再起動は選べなくなります。drain は loop を終わらせるので、drain したのに再起動しない
deploy は、箱から worker を消すだけで終わります。今の条件付き再起動は「node pack を
触ったときだけ」という最適化でしたが、段階 D では条件そのものが成立しません。段階 D の
代償は「走行中のレンダーが道連れになる」だけでなく、「再起動するかどうかの判断が deploy
から選択肢として消える」でもあります。

だから drain は安く済む形にします。待つのは走行中の request 1 件だけで、キュー全体ではありません。
新しい claim を止めて、今抱えている 1 件を描き切って抜けます。

drain が待てる時間には上限を置きます。上限を超えたら worker は走行中の request を release
（`PATCH { "status": "queued", "worker_id": ... }`）してから抜け、行は queued に戻って再起動後の
claim で拾われます。ここで失うのはその 1 枚の描き直しだけで、release があるので途絶の 5 分を
待つ必要もありません。上限の値は deploy の運用（生成中に当てるか）で決めるもので、契約には
入れません。

chimera 側の契約はこの段でも変わりません。drain は worker と deploy スクリプトの間の話で、
release は既に段階 D と独立に入っています。

`poses.py` と catalog publish はどの段でも残ります。pose 本文の組み立ては costume に依存
する条件分岐を持っていて、catalog が publish できるのはそれを実行した後の prompt ペア
だけです。それを chimera に保存すると `parameters.costume` の上書きが成立しなくなり、
分岐そのものをデータにすると chimera が prompt の語彙を解釈することになります
（[domain-model.md](domain-model.md#preset)）。catalog は pose 名に加えて recipe ごとの
`parameters` の可否、`patches` の語彙、model、canvas を運ぶ capability document でもあり、
chimera が patch を検証するのにこれが要ります。

リスクと対応:

-   preset が無審査で本番に入る。promote は `rating = good` の Generation からしか作れず、
    Rating は人間しか書けません。PR review より審査は厳しくなります。
-   agent が preset を壊す。promote は非破壊で新しい版を足すだけです。既存の版は残り、
    request 側が版を指名します。
-   base が動いて patches が当たらなくなる。text op は needle 不在で落ちますが、worker の
    claim 直後の probe が resolution を報告する前に落とし、request が `failed` になります。
    `derive_request` は pin の無い Request の patches を引き継がないので、この経路では
    request を積む前に 409 になります。`base_fingerprint` の突き合わせで、使う前に
    気付けるようにします。
-   chimera が落ちると preset を引けない。claim 自体 chimera を要するので、cache が効く窓は
    「claim 済みで preset 未解決の request」だけです。版が不変なので cache は素直に効きます。

## 注意

- worker は `generation.graph` を受け取った場合そのまま ComfyUI へ流します。request の
  書き手を自分のエージェント以外に広げる場合は、graph モードを worker 側で許可制にし、
  chimera 側でも `created_by` ごとに `generation.graph` の受理可否を設ける。
- `recipe_ref` は preset が chimera に移った後は「何が描かれたか」を特定しません。特定するのは
  `(git_commit, 解決済みの preset の版)` の組で、worker は resolution を報告するときに解決した版を
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
- `redraw` / `deliver` / `repair` / `masked_redraw` は `payload.generation_id` が指す Generation
  自身の画像を読みます（この節「payload」参照）。original の purge は止めてあり（`docs/domain-model.md`
  「original の保持」）新しく purge されることはありませんが、すでに purge 済みの行
  （`original_purged_at` 非 null）は original を読めないので、chimera は request の作成自体を 409（`original_purged`）で拒否し、queued
  行は作られません。`generate` request（derive_request 含む）はこの制限を受けません。
- original は保持期間を過ぎると lossless WebP に再圧縮されることがあり
  （`docs/domain-model.md`「original の再圧縮」）、`GET /api/v1/generations/{id}/context` が
  返す元画像は PNG とは限りません。worker は元画像の bytes を format-agnostic に扱い（PNG
  metadata の有無を前提にしない）、生成グラフが要る場面（例: hires-chain の base）は
  常に `comfy_job.graph` から取ります。original が消える前に PNG の `prompt` chunk から
  救出済みなので、original が WebP になっていても `comfy_job.graph` は読めます。
