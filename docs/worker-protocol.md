# Worker Protocol

chimera を control plane、GPU 機を worker とする配置での repo をまたぐ契約です。requests
キューのスキーマ、状態遷移、API、finalize / generate の payload、`recipe_ref`
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

  主体      持つもの                                                     持たないもの
  --------- ------------------------------------------------------------ ---------------------------------
  brain     生成意図の解釈、request.json、rating / semantic の読み書き   ComfyUI への経路
  chimera   requests 行の正本、claim / heartbeat / 状態遷移、GUI、MCP    生成の判断、graph の解釈
  worker    recipe の checkout、graph 構築、ComfyUI 実行、ingest         Experiment の意味論、evaluation

Mac から ComfyUI への経路は LAN でも持ちません。「直 POST 禁止」は構造で担保されます。

## requests テーブル

``` text
id                TEXT PRIMARY KEY            UUIDv7
kind              TEXT NOT NULL               generate | finalize
status            TEXT NOT NULL               queued | running | done | failed | cancelled
payload_json      TEXT NOT NULL               kind ごとの payload（後述）
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
  "payload": { "generation_id": "...", "options": { "denoise": 0.55, "repin": true } },
  "recipe_ref": "production",
  "idempotency_key": "gui:finalize:abc123:2026-09-05T12:00:00Z",
  "created_by": "gui"
}
```

201 で行を返します。`idempotency_key` の再送は既存行を 200 で返します（Batch /
Job と同じ契約）。`run_id` は `kind = generate` かつ `payload.experiment.run_id`
がある場合に chimera が転記します。

`recipe_ref` は `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$` だけを検証し、存在は確認しません。
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
{ "worker_id": "gpu-box-1", "kinds": ["generate", "finalize"] }
```

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
{ "status": "running" }
{ "status": "done", "result": { "batch_id": "...", "generation_ids": ["..."] } }
{ "status": "failed", "error": "..." }
```

`{ "status": "running" }` は heartbeat です。worker は実行中 30 秒ごとに送り、chimera
は `heartbeat_at` を更新します。`worker_id` が claim 時のものと異なる PATCH は 409
です（stale と判定されて別 worker に渡った後の、旧 worker からの書き込みを弾く）。

brain / GUI が書く遷移:

``` json
{ "status": "cancelled" }
```

queued 以外からの cancelled は 409。done / failed / cancelled は終端で、以後の
PATCH は 409 です。

`status = done` で `run_id` があり `result.batch_id` があれば、chimera は同じ
リクエスト内で `experiment_runs.batch_id` を attach します。worker が別途
`PATCH /api/v1/experiment-runs/{run_id}` を送る必要はなくなりますが、送っても
既存の attach-only 規則で同じ batch なら 200 です。

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
`finalize.py` と同じ）と、その Generation です。

## payload

### generate

`payload` は request.json schema v1 をそのまま包みます（[generation-request.md](generation-request.md)）。

``` json
{
  "kind": "generate",
  "payload": {
    "schema_version": 1,
    "request": { "instruction": "...", "count": 3, "seeds": null },
    "generation": { "recipe": "yukari", "parameters": { "pose": "lounge" }, "patches": null, "graph": null },
    "semantic": { "summary": "..." },
    "experiment": { "experiment_id": "...", "run_id": "...", "overrides": { "patches": [] } }
  }
}
```

worker は payload を `request.json` として書き出し `comfy-recipes generate --request`
に渡します。翻訳層はありません。

### finalize

``` json
{
  "kind": "finalize",
  "payload": {
    "generation_id": "abc123",
    "options": {
      "denoise": 0.55,
      "repin": false,
      "recolor": false,
      "keep_legwear": null,
      "route": null,
      "finalizer": null,
      "size": null,
      "handdrawn": false,
      "skin": false,
      "toe_guard": null,
      "keep_scene": false
    }
  }
}
```

`generation_id` は UUID でも short_id でもよく、worker は既存の
`GET /api/v1/generations/{id}/context` で解決します。`options` は `comfy-recipes finalize`
の引数に 1 対 1 で写します。

  options             型                        CLI
  ------------------- ------------------------- ------------------------------
  denoise             number（既定 0.55）        `--denoise 0.55`
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

省略したキーは false / null です。chimera が検証するのは型だけで、組み合わせの
妥当性（recipe が route を持つか等）は worker が判定して `failed` にします。

GUI が積む finalize は `denoise` / `repin` / `recolor` / `keep_legwear`（true）
だけを持ち、他は省略します。

## idempotency

- requests 行: `idempotency_key` は積む側が作ります。GUI は
  `gui:{kind}:{generation_short_id}:{ISO 時刻}`、brain は自分の request ごとに 1 つ、
  Run 由来の自動起票は `run:{run_id}`。
- worker が作る Batch / Job: `idempotency_key` を `request:{request_id}` /
  `request:{request_id}:job:{index}` とし、heartbeat 途絶後の再実行が既存 Batch を
  そのまま使って続きを ingest できるようにします。ingest 自体は
  `(comfy_job_id, comfy_output_index)` の unique で二重登録を防いでいます。
- finalize の再実行も同じ規則です。source Generation ごとに新しい納品 Batch
  を作るのは仕様で、同じ requests 行の再実行だけが同じ Batch に戻ります。

## ExperimentRun 由来の generate

案: 一本化する。Run を作ると chimera が `kind = generate` の requests 行を自動起票し、
worker は requests だけを見ます。

- 起票のタイミングは `POST /api/v1/experiments/{id}/runs`（MCP `create_run` も同じ関数）で、
  Experiment に `base_recipe` があり status が active / stabilized のときだけ。
  無い Run は起票されず、後から Experiment に `base_recipe` を付けても自動では
  起票されません（`POST /api/v1/requests` で明示的に積む）。
- payload は今 `watch.build_request` が Run から組み立てているものと同じ
  `schema_version: 1` の request.json を chimera 側で作ります。`base_parameters`
  の `count` を `request.count` に抜き、残りを `generation.parameters` に入れ、
  `objective` を `request.instruction` と `semantic.summary` に写します。
  語彙の解釈はしません（詰め替えだけ）。
- `idempotency_key` は `run:{run_id}`。Run は物理削除されず、1 Run につき起票は 1 回です。
- `done` で `experiment_runs.batch_id` を attach するのは上記の通り chimera が行います。
- `GET /api/v1/experiment-runs?pending=true` は残しますが読み取り専用の状況確認用に
  格下げし、worker は使いません。docs/experiment-agent.md の runner 節はこの文書を指すよう
  書き換えます。
- 移行: requests テーブルを作る migration で、`batch_id IS NULL` かつ Experiment が
  active / stabilized の既存 Run について requests 行を backfill します
  （`created_by = system`、payload は同じ規則）。段階 1 の watch は移行後に
  requests 版へ差し替えます。

並存させない理由: worker が 2 つのキューを見ると、優先順位・heartbeat・失敗の記録が
2 系統になり、段階 3 の push も 2 種類になります。Run から request への詰め替えは
機械的で、chimera がやっても「判断しない」境界を越えません。

## GUI

段階 2 の GUI は requests 行を積むことと status を表示することだけです。

- Generation Detail: `Finalize` ボタン。`repin` / `recolor` / `keep-legwear` のチェックボックスと
  `denoise`（既定 0.55）を持ち、`POST /api/v1/requests`（`created_by = gui`）を積む。
  積んだ後はボタンの横に最新 request の status（queued / running / done / failed）と、
  done なら納品 Generation へのリンクを出す。
- Batch Detail: `Finalize all arms`。その Batch の全 Generation について同じ options で
  requests 行を積む（1 Generation 1 行）。
- 進捗の step 表示は段階 3。

不変条件の文言は次の通り改めます。

> GUI が積んでよいのは semantic 判断を伴わない再実行（finalize）だけ。GUI が触るのは自分の
> D1 の requests 行のみで、ComfyUI へは到達しない。

Compare が比較表示のみである点は変わりません。

## MCP

`/mcp` に次を足します。

``` text
create_request(kind, payload, recipe_ref?, idempotency_key)
get_request(id)
list_requests(status?, kind?, run_id?)
```

`create_run` は上記の自動起票により、追加の tool を呼ばなくても worker に届きます。

## 段階 3（概略）

WorkerHub（Durable Object、Hibernation API）に worker が outbound で WebSocket を張り、
requests 行の作成を push、worker から status / progress を返します。正本は D1 のままで、
socket は通知路です。切断後の再接続で一度だけ claim を呼んで追いつきます。stale
running の回収は DO の alarm が担います。GUI も同じ DO に繋いで step 単位の進捗を
出します。段階 2 の claim / PATCH はそのまま残り、push はそれの前倒しにすぎません。

## 注意

- worker は `generation.graph` を受け取った場合そのまま ComfyUI へ流します。request の
  書き手を自分のエージェント以外に広げる場合は、graph モードを worker 側で許可制にし、
  chimera 側でも `created_by` ごとに `generation.graph` の受理可否を設ける。
- `recipe_ref` は origin のブランチ名に限ります。worker は `git fetch origin` の後
  `origin/{recipe_ref}` を detached で checkout し、ローカルブランチや任意 commit は
  受けません。既定の `production` は昇格 PR の merge でしか動かないブランチです。
- Service Token の期限切れは claim / heartbeat の 403 として現れます。worker は
  ログに出して poll を続け、chimera 側は何もしません。
