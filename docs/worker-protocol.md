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

backfill 行（後述「ExperimentRun 由来の generate」の移行手順）の id だけは例外で
`bf-{run_id}` を使います。一度きりの移行専用の値で、以後 chimera が発行する id
はすべて UUIDv7 です。

``` text
id                TEXT PRIMARY KEY            UUIDv7
kind              TEXT NOT NULL               generate | finalize
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
`kind = generate` をサーバー側で検証し、外れていれば 400 です。`kind = finalize` の payload
に `experiment` があっても無視します。

`created_by` は記録用のラベルで、権限境界ではありません。chimera は単一ユーザー運用で、
Cloudflare Access の内側にいる主体（人間の GUI、brain の Service Token、worker の Service
Token）を区別せず、いずれも全 `kind` を積めます。「GUI は finalize しか積まない」は GUI
のコードが finalize 用の form しか持たないことで保っており、API が `created_by` を見て
拒否するものではありません。書き手を自分以外に広げるときは、Access の identity
（`Cf-Access-Authenticated-User-Email` / Service Token の `common_name`）から `created_by` を
サーバー側で確定し、`created_by` ごとの `kind` / `generation.graph` の受理可否を設けます
（後述の注意と同じ）。

`recipe_ref` は `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$` だけを検証し、存在は確認しません。
省略時の既定は契約上 `production` ですが、そのブランチは段階 4 のリリース経路で生まれる
ため、それまでは wrangler の var `REQUESTS_DEFAULT_RECIPE_REF` で `main` にしています
（Run 自動起票、`POST /requests`、MCP `create_request` の全てに効く）。段階 4 で var を
`production` に戻します。
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

`worker_id` は worker のホスト名です。`kinds` は省略すると全種です。段階 2 の box は
両方を受けます。

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

省略したキーは false / null です。chimera が検証するのは型だけで、組み合わせの
妥当性（recipe が route を持つか等）は worker が判定して `failed` にします。

GUI が積む finalize は `denoise` / `repin` / `recolor` / `keep_legwear`（true）
だけを持ち、他は省略します。`denoise` の入力欄は空が既定で、空のまま積めば
`null`（recipe 既定）です。

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

finalize の再実行も同じ規則です。source Generation ごとに新しい納品 Batch を作るのは
仕様で、同じ requests 行の再実行だけが同じ Batch に戻ります。

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
{"type":"hello","worker_id":"<hostname>","kinds":["generate","finalize"]}   最初の1通
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

## 注意

- worker は `generation.graph` を受け取った場合そのまま ComfyUI へ流します。request の
  書き手を自分のエージェント以外に広げる場合は、graph モードを worker 側で許可制にし、
  chimera 側でも `created_by` ごとに `generation.graph` の受理可否を設ける。
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
