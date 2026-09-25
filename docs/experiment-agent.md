# Experiment Agent

Agent が MCP サーバー（`/mcp`）越しに chimera を操作するための契約です。
中心になるのは Experiment のサイクルで、Agent はこれを1周ずつ回します。

``` text
Experiment → Run → override 決定 → ComfyUI 生成 → evaluation → decision
```

同じ MCP サーバーは、Experiment を経由しない派生、仕上げ、pose の基準 render の pin、Preset への昇格、Observation と Publication の記録も受け持ちます。

## 構成

Cloudflare OS のサーバー側 Agent は、外部ネットワークを無効化された Dynamic Worker 上で動きます。
`https://chimera.chanu.co` を直接 fetch する経路はありません。
用意されている入口は型付きバインディングと MCP サーバーの2つで、外部アプリを繋ぐときは後者を使います。

権限は Gatekeeper が仲介します。
Agent は権限ゼロから始まり、リソースと操作ごとに管理者が許可します。
資格情報は Agent と生成コードから分離されます。

``` text
Cloudflare OS
  Agent Workspace
    └── MCP: chimera ──Gatekeeper──▶ chimera Worker /mcp
                                        └── D1 / R2

GPU 機
  worker（comfy-recipes watch）──REST + Access Service Token──▶ chimera /api/v1/*
     └── ComfyUI
```

Agent は生成を起動しません。
requests 行を積むところまでを担当し、worker がそれを claim して実行します（[worker-protocol.md](worker-protocol.md)）。
Agent の外部ネットワークが無効である以上ここは分離するしかなく、「chimera は ComfyUI へ生成要求を送らない」という不変条件とも一致します。

`/mcp` は stateless な Streamable HTTP エンドポイントです。
MCP protocol session も専用の Durable Object も持ちません。
認証はアプリ内に実装せず、`/mcp` も Cloudflare Access の内側に置いて、Service Token を Gatekeeper が保持します。

`/api/v1/*` は Python CLI と worker のための入口としてそのまま残ります。
MCP は同じドメインへの別インターフェースで、tool のハンドラは REST routes と同じ `src/lib/*` の関数を呼びます。
クエリも 404 / 409 の guardrail も二重に持たず、`ApiError` のメッセージはそのまま tool error（`isError: true`）の本文になります。

### 責務

| 主体 | 持つもの | 持たないもの |
| --- | --- | --- |
| chimera | Experiment / Run / evaluation / decision / promotion、requests 行、Preset と pin の正本。MCP は既存ドメインの別インターフェース | ComfyUI workflow の詳細 |
| comfyui-recipes | recipe、workflow 構築、override 適用、ComfyUI 実行 | Experiment の意味論、評価履歴 |
| worker | requests 行を claim し、overrides と parameters の通りに実行して結果を返すこと | evaluation / decision / promotion / ライフサイクル |
| Agent | override の決定、評価、次の一手 | Git 書き込み、recipe の変更、履歴の破壊 |

worker が Run について知るのは機械的な範囲に留めます。
ここを越えると comfyui-recipes 側に Experiment の意味論が漏れます。

## Experiment と Run の Agent 向けの欄

### base_parameters

Experiment は、検証中ずっと固定する生成条件を持ちます。

``` json
{ "pose": "lounge", "costume": "default", "count": 3 }
```

Run の `overrides.patches` が変える差分、Experiment の `base_parameters` が固定する土台です。
これがないと Run 単体を実行できません。
`overrides` に混ぜると差分という概念が濁るため分けています。

chimera は中身を検証しません。
`base_recipe` と同じく、語彙は comfyui-recipes のものです。

### base_generation_id

Experiment は、その検証が起点とする Generation を1つ持てます（`base_generation_id`、nullable）。
設定すると、Run 作成時に自動起票される request.json に `references: [{ generation_id, purpose: "rebuild" }]` が乗ります（[generation-request.md](generation-request.md#references)）。
Agent が個々の Run で参照を組み立てる必要はありません。

### evaluation と decision

どちらも Run に付く任意の JSON object で、chimera は形を検証しません。
`set_evaluation` / `set_decision` で上書きでき、`null` でクリアできます。
evaluation の `overall` が文字列なら、`list_experiments` の各 Experiment の `latest_run.evaluation_overall` に出ます。

### 未実行 Run

Run は作られた時点で「まだ実行されていない」状態で、`batch_id` が付いた時点で実行済みになります。
この2状態のために別のカラムは持ちません。
実行の待機、実行中、失敗は Run ではなく requests 行の status が表します。

worker の作業キューは requests テーブルです。
Run 作成時に chimera が `kind = generate` の requests 行を自動起票し、worker はそれを claim します（[worker-protocol.md](worker-protocol.md#experimentrun-由来の-generate)）。

``` text
GET /api/v1/experiment-runs?pending=true
```

これは「requests 行が付かなかった Run」（base_recipe の無い Experiment の Run など）を見つけるための読み取りです。
status が active / stabilized の Experiment を横断して、`batch_id` が null で、かつ requests 行（status を問わない）を持たない Run を返します。

## tool 一覧

読み取り tool は D1 / R2 を読むだけです。
追記 tool は行を1つ足すか Run の欄を埋めるだけで、既存の行を削除も上書きもしません（[生やさない操作](#生やさない操作)）。

| tool | 引数 | 種別 | 返すもの |
| --- | --- | --- | --- |
| `list_experiments` | `status?` | 読み取り | Experiment の一覧。各行に base_recipe / base_parameters / base_generation_id / run_count / latest_run |
| `get_experiment` | `id` | 読み取り | `GET /api/v1/experiments/{id}` と同じ形（runs / promotions / tags 込み） |
| `create_run` | `experiment_id, overrides, objective?, parent_run_id?, idempotency_key?, variables?` | 追記 | Run を1件作る。自動起票した requests 行の id を `run.request_id` に返す |
| `get_run` | `run_id` | 読み取り | Run、所属 Experiment の要約、attach 済み Batch の Generation 一覧 |
| `attach_generation` | `run_id, generation_id` | 追記 | Run の代表 Generation を記録する |
| `set_evaluation` | `run_id, evaluation` | 追記 | Run の evaluation を書く（`null` でクリア） |
| `set_decision` | `run_id, decision` | 追記 | Run の decision を書く（`null` でクリア） |
| `create_request` | `kind, payload, recipe_ref?, idempotency_key` | 追記 | requests 行を手組みの payload で積む |
| `get_request` | `id, include_prompts?` | 読み取り | requests 行1件（payload、done / failed 後は result / error） |
| `list_requests` | `status?, kind?, run_id?, include_prompts?` | 読み取り | requests 行の一覧。claim はしない |
| `derive_request` | `from_generation_id, instruction, count?, seeds?, parameters?, patches?, replace_patches?, semantic, reference?, identity_override?, idempotency_key, recipe_ref?` | 追記 | 既存 Generation を起点にした generate request を積む |
| `finalize_generation` | `generation_id, options?, profile?, idempotency_key` | 追記 | finalize request を積む |
| `repair_generation` | `generation_id, options?, idempotency_key` | 追記 | hands / feet の repair request を積む |
| `masked_redraw_generation` | `generation_id, options, idempotency_key` | 追記 | 任意矩形の garment / local inpaint request を積む。source は不変 |
| `list_generations` | `character?, tag?, published?, reference?, rating?, bookmark?, from?, to?, limit?, offset?` | 読み取り | `GET /api/v1/generations` と同じフィルタで Generation を探す |
| `get_generation` | `generation_id, include_prompts?` | 読み取り | `GET /api/v1/generations/{id}` と同じ形（publications / pose_reference / batch.drawn_pose 込み） |
| `list_batch` | `batch_id, include_prompts?` | 読み取り | Batch（drawn_pose 込み）/ jobs / generations（rating、bookmark、tags、semantic、seed 込み）/ references / relations / ExperimentRun |
| `get_generation_lineage` | `generation_id, depth?` | 読み取り | Batch 単位の祖先と子孫。depth 既定 5、上限 10 |
| `get_generation_image` | `short_id, width?` | 読み取り | 縮小した JPEG 画像。載らなければ canonical URL |
| `list_catalog` | `recipe_ref?` | 読み取り | 公開済み recipe catalog の要約（既定 `"production"`） |
| `get_catalog_pose` | `recipe, pose, recipe_ref?` | 読み取り | 単一 pose のフルレコードと現行の pin |
| `list_presets` | `recipe?, kind?, include_deprecated?` | 読み取り | Preset の名前ごとの最新版（record 本文なし） |
| `get_preset` | `recipe, kind, name, version?` | 読み取り | 解決済みの本文。既定は最新の active 版 |
| `set_pose_reference` | `recipe, pose, generation_id, idempotency_key` | 追記 | 基準 render を `(recipe, pose)` に pin する |
| `plain_render` | `recipe, pose, seed?, idempotency_key?, recipe_ref?` | 追記 | pin（または明示 seed）で recipe 既定の generate request を積む |
| `promote_to_pose` | `generation_id, name, kind?, base_version?, note?, idempotency_key` | 追記 | rating good の Generation を Preset の新しい版にする |
| `promote_to_profile` | `generation_id, name, note?, idempotency_key` | 追記 | rating good の finalize 出力を kind `finalize` の Preset の新しい版にする |
| `list_observations` | `character?, pose?, component?, parameter?, outcome?, q?, limit?` | 読み取り | Observation の一覧。`q` は parameter / value / reason の部分一致 |
| `get_observation` | `id` | 読み取り | Observation 1件 |
| `record_observation` | Observation の欄（`observed_at` を除く） | 追記 | Observation を1件記録する |
| `record_publication` | `generation_id, url?, published_at?, idempotency_key?` | 追記 | Generation の納品を1件記録する |

Generation を取る tool は、`generation_id` に UUID と short_id のどちらも受けます。

手順の順序は initialize 応答の `instructions` で client に伝えます。
正本は `src/mcp.ts` の `MCP_INSTRUCTIONS` で、`list_catalog` で pose 名を確かめる、名前のある look は `plain_render` で再現する、派生は現行の pin の Generation から `derive_request` で起こす、prompt は `prompt.positive.<part>` 単位で変える、という順です。

## tool の振る舞い

### catalog と Preset の読み取り

`list_catalog` / `get_catalog_pose` は、comfyui-recipes が publish した recipe catalog のスナップショット（[api.md「Recipe Catalog」](api.md#recipe-catalog)）を読みます。
どちらも `recipe_ref` を省略すると `"production"` を見ます。

`list_catalog` は prompt 本文を含みません。
返すのは recipe ごとの pose / costume / expression の名前、recipe が持つ場合は `parts` と `identity_tags`、parameters、patches の語彙、finalize / repair の dial 語彙（`dials`）、backdrop の一覧（`backdrops`）、git 情報です。
特定の pose の中身が要るときだけ `get_catalog_pose` でフルレコードを引きます。
パーツに分かれた recipe なら `parts` は順序付きの `{name, text}` の列で、text を連結すると positive prompt になります。
`reference` はその pose の現行の pin で、無ければ `null` です。

`list_presets` / `get_preset` は Preset（[domain-model.md](domain-model.md#preset)）の読み取り側です。
catalog が comfyui-recipes のスナップショットであるのに対し、Preset は chimera 側の正本で版を持ちます。
`list_presets` は名前ごとに最新版を1行返し、既定は active のみ、`include_deprecated` で最新版が deprecated の名前も含めます。
`get_preset` は record と、昇格で作られた版なら base の連鎖を根から順に畳んだ patches を返します。
`version` を明示すれば deprecated の版も引けます。
kind `finalize` の Preset は record が `{options}`（`finalize_generation` の options、dial の語はそのまま）で、patches は常に `[]` です。
どちらのレスポンスにも現行の pin が `reference` で付きます。

### 基準 render の pin と昇格

`set_pose_reference` / `plain_render` は、「この pose はこう見えるべき」という基準を pin し、それを起点に同じ render を繰り返す tool のペアです（[domain-model.md](domain-model.md#基準-render-の-pin)）。
pin は `(recipe, pose)` の名前に付き、Preset の版には付きません。

`set_pose_reference` は `rating = good` の Generation を `(recipe, pose)` の pin にします。
finalize / repair 済みの Generation なら [derive_request](#derive_request) と同じ規則で raw の Generation まで遡りますが、rating は指定した Generation のものを見ます。
遡った先の Batch が「素の render」（recipe が一致し、その pose を描き、patches を持たず、起こした generate request が prompt / negative_prompt を上書きしていない）でなければ 409 で、満たさない条件は1つの 409 にまとめて返ります。
seed は遡った先の raw Generation の comfy_job から取り、記録が無ければ 409 です。
その `(recipe, pose)` の Preset がまだ無ければ 404 です。
再設定は現行の pin を `superseded_at` で閉じてから新しい行を足すので、それまでの pin も履歴として残り、レスポンスは閉じた pin を `superseded` で返します。
同じ引数での `idempotency_key` の再送は既存の pin を返し（`created: false`）、別の引数での再利用は 409 です。

`plain_render` は、その pin の seed（または明示した `seed`）で `recipe` / `pose` を patches なしの recipe 既定のまま描く generate request を1件積みます。
pose は Preset として存在すればよく（`promote_to_pose` で作った pose も含む）、catalog に載っている必要はありません。
その Preset が無いとき、または `recipe_ref` の catalog が publish されていないときは 404、pin も `seed` も無ければ 409 です。
pin がまだ無い pose には、`seed` を渡して最初の基準 render を起こせます。
既定の `idempotency_key` は `plain:<recipe>:<pose>:<seed>:<catalog の git_commit>` なので、同じ commit のまま繰り返し呼んでも複製せず再送になります。
同じ seed と catalog でもう1件積むときは、`idempotency_key` を明示します。

`promote_to_pose` は、良かった生成をそのまま Preset の次の版にする tool です。
起点 Batch から `recipe`、pin されていた preset の版（base）、`patches_json` の patches、pose レコードの fingerprint を取り、`{ base, patches }` を `(recipe, kind, name)` の次の版として足します。
`name` が既存なら新しい版、新しい名前ならその名前の version 1 で、`kind` の既定は `pose` です。
finalize / repair 済みの Generation は `derive_request` と同じ規則で raw まで遡りますが、rating は指定した Generation のものを見ます。

base は、その Batch を作った generate request が pin していた版です。
pin の無い Generation では `base_version` で明示し、どちらも無ければ 409 です（chimera は base を推測しません）。
ほかに 409 になるのは、rating が good でないとき、起点 Batch が recipe を持たない graph-mode のとき、Batch が patches を持たないとき（全文上書きと finalize / repair / masked_redraw の出力はここで弾かれます）です。
Rating を書けるのは人間だけなので、Agent が単独で preset を本番へ入れることはできません。
既存の版は書き換わらないため、昇格が過去の request の再現性を壊すこともありません。
`idempotency_key` の再送は既に作られた版をそのまま返し、同じキーで別の Generation や名前を渡すと 409 です。

`promote_to_profile` は、finalize request が産んだ rating good の Generation を kind `finalize` の Preset の新しい版にします（[worker-protocol.md](worker-protocol.md#finalize-profile)）。
新しい版の本文は、その finalize request が積んだ options そのもの（dial の語はそのまま）です。
finalize request の出力でない Generation と rating が good でない Generation は 409 です。
版の足し方と再送の扱いは `promote_to_pose` と同じです。
作った版は `finalize_generation` の `profile` で使います。

### Generation の読み取り

`list_generations` は、short_id をまだ持っていないときに起点の Generation を探す tool です。
フィルタはギャラリーと同じで自由に組み合わせられ、結果は新しい順、`limit` は既定 50、上限 200 です。
`published=true` は納品済み Generation の索引で、返る各 Generation は `look:<pose>` タグも持ちます（[domain-model.md](domain-model.md#publication)）。
`reference=true` は `set_pose_reference` で現在 pin されている Generation の索引です。
rating は人間の判定として読むもので、Agent が書くものではありません。

`get_generation` / `list_batch` は、REST の `GET /api/v1/generations/{id}` / `GET /api/v1/batches/{id}` と同じ `src/lib/generations.ts` / `src/lib/batches.ts` を呼ぶ別窓口です。
`list_batch` は UI 向けの siblings などを持たない subset です。

`batch.drawn_pose`（`{recipe, pose, reference}`）は、その Generation / Batch が描いた pose と、その pose の現行の pin です。
`reference` は `get_catalog_pose` と同じ形（pin が無ければ `null`）で、Batch が pose を持たなければ `drawn_pose` 自体が `null` です。
`get_generation` の `pose_reference`（この Generation 自身が pin か）とは別物です。

`get_generation` の `comfy_job.prompt_not_reusable` が null でない Generation（repair / masked_redraw / repair 付き finalize の出力）は、render_facts の prompt が mask 領域用に削られています。
これを generate の prompt として使わず、その Generation から `derive_request` を起こします（[api.md](api.md#generation-context)）。

`get_generation_lineage` は Batch 単位で祖先と子孫を辿ります。
祖先は「この Batch が材料に使った Generation の Batch」（`via: "reference"`、`purpose_or_kind` は Reference の purpose）と「この Batch の直接の起点 Batch」（`via: "relation"`、`purpose_or_kind` は BatchRelation の type、例えば `refinement`）の両方を含み、子孫はその逆方向です。
同じ Batch を二度訪れず、`depth` 段目で止まります。

### derive_request

Experiment を経由しない単発の派生（「この Generation のポーズを少し変えて3枚」）は `derive_request` で積みます。
Experiment のサイクルに乗せるなら `create_run` を使います。

`derive_request` は既存の Generation を起点に `kind: "generate"` の requests 行を積みます。
`from_generation_id` が finalize / repair / masked_redraw 済みの Generation なら、refinement の BatchRelation と rebuild の Reference を辿って raw の Generation まで遡ってから起点にします。
仕上げの Batch の `parameters` は仕上げの payload で、generate parameters ではないためです。
連鎖の途中の refinement Batch が rebuild の Reference を持たなければ 409 です。

起点 Batch から引き継ぐのは `recipe`、`parameters`、`patches_json` の patches、`preset_versions_json` の preset の pin です。
`parameters` は上書きマージ、`patches` は既定で追記、`replace_patches: true` なら丸ごと置き換えます。
patches を Batch から取るのは、`semantic.attributes.patches` が後から書き換わりうるためです（[domain-model.md](domain-model.md#preset)）。
引き継いだ pin は新しい payload の `generation.presets` に載り、`parameters` の該当 kind は Batch に記録された `recipe_pose` ではなく pin の `name` に戻します。
Batch の `parameters` は worker が preset を解決した後の値なので、そのままコピーすると pin が外れます。
`identity_override` は起点から引き継がず、渡したときだけ `generation.identity_override` に載ります。

起点 Batch が recipe を持たない graph-mode の Batch なら 409 です。
起点 Batch が patches を持ちながら preset の pin を持たず、その recipe に Preset がある場合も 409 です。
その patches は pin が入る前の preset 本文に対して書かれていて、現行の版に当てると needle 不在で落ちるためで、`replace_patches: true` で現行の preset に対して組み直すか、pin を持つ Batch を起点にします（[worker-protocol.md](worker-protocol.md)）。
`seeds` を渡すなら要素数は `count` と一致しなければなりません。

`reference` は、起点 Generation への purpose `"derive"` の Reference として payload に載ります。
遡った場合は、指定した Generation への purpose `"derive"` / aspect `"finalized"` の Reference も併せて載ります。
レスポンスの `derived_from` には、指定した Generation（`requested`）と実際の起点 Generation（`source`）の両方の id / short_id が入ります。

表情、背景、ポーズだけを変える派生は、`prompt.positive` 全体の replace ではなく `prompt.positive.<part>` を target にした patch で書きます。
パーツ名は `get_catalog_pose` の `parts` です。
全文 replace は recipe の `identity_tags` を落としやすく、worker はそれを消す patches や prompt override を持つ request を failed にします。
identity を意図して変えるときだけ `identity_override` に理由を渡します。
`create_request` で generate の payload を手で組むときも同じ規則です（[worker-protocol.md「prompt のパーツ単位 patch」](worker-protocol.md#prompt-のパーツ単位-patch)、[「identity の上書き」](worker-protocol.md#identity-の上書き)）。

### 仕上げ（finalize / repair / masked_redraw）

`finalize_generation` / `repair_generation` / `masked_redraw_generation` は、`create_request(kind: "finalize" | "repair" | "masked_redraw", ...)` と同じ requests 行を積む専用窓口です。
`generation_id` を解決して `payload.generation_id` に short_id を詰め、`options`（finalize は `profile` も）を渡されたときだけ payload に載せます。
`create_request` で payload を手で組む代わりに、これら3つを使います。
どれも出力は source Generation の refinement Batch として記録され、source への rebuild の Reference を持ちます。
options の語彙と既定値は [worker-protocol.md](worker-protocol.md) の「[finalize](worker-protocol.md#finalize)」「[repair](worker-protocol.md#repair)」「[masked_redraw](worker-protocol.md#masked_redraw)」節が正本です。

`finalize_generation` の `profile`（`{name, version?}`）は、source Generation の recipe の kind `finalize` の Preset を解決して options の土台にします（[finalize profile](worker-protocol.md#finalize-profile)）。
options に同じキーがあればそちらが勝ち、明示の `null` も上書きとして扱います。

`repair_generation` は hands / feet 専用です。
`repair_generation` / `masked_redraw_generation` は raw と finalize 済みのどちらの Generation も指定できます。

`masked_redraw_generation` は `regions`（1つ以上の、互いに重ならない正規化矩形）と空でない `prompt_patch` を必須とし、`denoise`（0 超 0.75 以下、または dial の語）、`mask_padding`、`mask_feather`、`size`、`seeds` を任意で受けます（[api.md](api.md#generic-masked-redraw)）。
`pad` / `feather` は alias として受け、`mask_padding` / `mask_feather` に正規化して保存します。

### Experiment サイクルの tool

Run の代表 Generation を選んだあと、その Generation を見て次の一手を決める段になったら `get_generation` / `list_batch` / `get_generation_lineage` を使います。

`create_run` の `overrides` は `{}` か `{"patches": [...]}` 形の diff だけを受け付けます。
各 patch は `{target, op, reason, ...}` で、`reason` は必須です。
target / op の語彙は recipe のもので、chimera は定義しません。
`{"pose": "...", "costume": "...", "count": 1}` のような base_parameters 形のオブジェクトは 400（tool error）で拒否します。
生成パラメータは Experiment の `base_parameters` に属し、Run ごとには変わりません。
`variables` は、graph では表せない要因を平らな map で持つ任意の欄で（例 `{"prompt_variant": "socks-v2"}`）、Experiment の facts table に列として出ます。

Agent は `create_run` を呼ぶたびに、意図した Run 1件につき1つの `idempotency_key` を生成して渡します。
Run は削除できないため、レスポンスを失ってからキーなしで再試行すると重複 Run が恒久的に残ります。

`create_run` の結果は `run.request_id` を含みます。
Experiment に `base_recipe` があり status が active / stabilized なら、Run 作成と同じトランザクションで requests 行が自動起票され（[worker-protocol.md「ExperimentRun 由来の generate」](worker-protocol.md#experimentrun-由来の-generate)）、その id が入ります。
条件を満たさなければ `null` で、Agent は `create_request(kind: "generate", ...)` で明示的に積みます。

`create_request` / `get_request` / `list_requests` は `POST /api/v1/requests` などと同じ `src/lib/requests.ts` を呼ぶ別窓口で、`created_by` は `mcp` に固定されます。
kind ごとの payload 封筒（generate なら `schema_version` / `request` / `generation`）は REST と同じ規則で検証します。
同じ `idempotency_key` に同じ kind / payload を渡すと元の行を返し（`created: false`）、別の kind / payload を渡すと 409 です。
この再送の規則は requests 行を積むすべての tool に共通です。

### Observation と Publication

`list_observations` / `get_observation` / `record_observation` は Observation（[domain-model.md](domain-model.md#observation)、[api.md](api.md#observation)）の窓口です。
Observation は comfyui-recipes の `experiments/` JSONL を写した索引で、正本ではなく、JSONL より遅れることがあります。
記録は履歴であって現行の規則ではなく、現行の規則は pose recipe 自身のコメントにあります。
各 reason は観測した pose / seed / タグブロック / canvas に限った話で、タグ一般についての主張ではありません。

`record_observation` は pose と component の少なくとも一方を必須とし、`observed_at`（import 由来の記録日の欄）は受けません。
記録しても pose recipe は変わりません。
Observation は append-only で、先の Observation を覆すときは `supersedes_id` で指し、先の行は書き換えも削除もしません。
`idempotency_key` は記録したい観測ごとに新しく渡します。
同じキーの再送は既に作った行を返し、同じものを測り直して同じ結果が出たときも別の観測として別のキーを使います。

`record_publication` は Publication（[domain-model.md](domain-model.md#publication)、[api.md](api.md#publication)）を1件追記するだけの tool で、X への投稿そのものはしません。
`url` は省略でき、後から `PATCH /api/v1/publications/{id}` や Generation Detail 画面で埋められます。
`idempotency_key` は記録したい投稿ごとに新しく渡し、同じキーの再送は既に作った行を返します。

## client 互換

### tool annotations

読み取り tool には `readOnlyHint: true` を付けます。
Cloudflare OS の gatekeeper-mcp は annotation の無い tool をすべて副作用ありの action として承認キューに入れ、呼び出し時点では結果を返しません。
読み取りがそこに入ると、Agent はデータを受け取れず同じ呼び出しを繰り返します。

追記 tool には `destructiveHint: false`、`idempotentHint: true`、`openWorldHint: false` を付け、description の先頭で「追記のみで、削除も上書きも送信もしない」と明示します。
ChatGPT の MCP client は未注釈の書き込み tool を安全性チェックで呼び出し前に落とすため、この注釈と文言が無いと書き込み系が一切通りません。

### outputSchema と structuredContent

すべての tool は `outputSchema` を宣言し、結果を text と `structuredContent` の両方で返します。
ChatGPT の開発者モードは outputSchema の無い tool を「出力スキーマ推奨」として警告し、結果を型の分からない JSON テキストとしてしか扱えません。
text も返すのは、outputSchema を読まない client のためです。

MCP SDK は server 側で `structuredContent` を outputSchema で検証し、合わなければその呼び出しを tool error にします。
schema の正本は各 serializer なので、`src/schemas/mcp-output.ts` はすべて未知のキーを許す loose object にし、深い所（payload / graph / semantic / catalog record）は unknown のまま通します。
ここを厳密に書くと、serializer に欄が1つ増えただけで本番の呼び出しが失敗します。

schema と serializer のずれは、実際に呼ばれるまで表に出ません。
そのため二重に押さえています。
`jsonResult` は第1引数にその tool の outputSchema を取り、data をその schema の推論型でしか受け付けないので、ずれは型検査で出ます。
テストの `mcpToolCall` は返ってきた `structuredContent` を宣言済みの schema で parse するので、実データでのずれはテストで出ます。
どちらも loose object のままなので、欄が増えるぶんには通ります。

`get_generation_image` の `structuredContent` は画像そのものではなく `{short_id, canonical_url, inlined, mime_type, reason}` で、画像は content の image ブロックで返ります。

### prompt の折り畳み

`get_request` / `list_requests` / `get_generation` / `list_batch` は、既定で prompt 本文を長さマーカーに畳んで返します。
畳む対象は、requests の payload では prompt override と prompt patch、`get_generation` では batch の prompt / negative_prompt と render_facts の sampler prompt、`list_batch` ではそれに加えて `batch.parameters.prompt_patch` です。
`get_generation` はさらに `comfy_job.graph` を省き、`null` にして `comfy_job.graph_omitted: true` を付けます。

ChatGPT の MCP client は tool 結果にコンテンツ分類器をかけており、一度でも prompt のタグに引っかかると、そのセッションでコネクタごと無効化されるためです。
`include_prompts: true` を渡せば実体をそのまま返します。
REST（`GET /api/v1/generations/{id}` など）はこの折り畳みの影響を受けません。

### 画像サイズ

`get_generation_image` は元画像そのものではなく、Images binding で縮小して JPEG（quality 72）に再エンコードした画像を返します。
`width` は 256〜1024 に丸め、既定は 768 です。
構図の確認には十分な解像度ですが、ピクセル単位の確認には向きません。

Cloudflare OS の MCP client は tools/call のレスポンス全体を 1 MiB で切ります。
生成物の元 PNG（1MB 台）は base64 化するとほぼ必ずこの上限を超え、base64 は 4/3 に膨れるため、inline で返すのは 700 KiB までです。
それを超えるとき、または変換前の画像が Images binding の入力上限（20 MiB）を超えるときは、画像の代わりに canonical URL を返します（`inlined: false`、`reason` に理由）。
変換に失敗したときは、元画像が上限内に収まればそのまま返します。
保持期間ジョブで original を削除した Generation は、1024px の preview から返します。

## 生やさない操作

MCP には次の操作を tool として置きません。

``` text
Experiment / Run / Promotion の削除
attach 済み Batch / Generation の付け替え
attach 後の overrides 変更
recipe への書き込み、comfyui-recipes のファイル編集
```

API 側も同じ操作を 409 / 404 で拒みます。
tool として存在しないことと合わせて、防御が二重になります。

Run の代表 Generation は、その Run 自身の Batch に属するものだけを選べます。
Batch が未 attach の Run への attach、別 Batch の Generation の attach、既に別の Generation が付いた Run への attach は、いずれも 409 です。
REST で Run 作成時に同じ組を渡す経路にも同じ規則が適用されます。

## 1サイクル

``` text
人間      Experiment を作る（base_recipe / base_parameters / テーマ）

Agent     list_experiments → get_experiment で過去 Run を読む
          override を決めて create_run
              ↓ chimera が requests 行を自動起票
worker    requests 行を claim → request.json → ComfyUI
              ↓ done を PATCH、chimera が batch_id を Run へ紐付ける
Agent     get_run で生成物を見る
          get_generation_image で画像を確認
          attach_generation で代表を選ぶ
          set_evaluation / set_decision
              ↓ decision を受けて次の create_run
```

Agent 側は Cloudflare OS のスケジュール実行で再入します。
待ち合わせのために chimera 側へ追加するものはありません。

## 扱わないこと

``` text
MCP からの Promotion の作成（REST の POST /api/v1/experiments/{id}/promotions だけ）
Agent による自動反復。1周ごとに人間が確認する
comfyui-recipes への自動 commit / PR 作成
```
