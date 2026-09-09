# Domain Model

## Overview

中心となる生成階層は以下です。

``` text
Batch
 └── ComfyJob
      └── Generation
```

Experiment は Batch を包含する階層ではなく、ExperimentRun を介して
Batch / Generation を参照します。

``` text
Experiment
  └── ExperimentRun ──▶ Batch / Generation
```

`batches.experiment_id` は引き続き存在しますが、Experiment
上の試行の主体は ExperimentRun です。

ただし、本システムの重要部分は階層そのものではなく、生成探索に存在する複数種類の
Relation を意味ごとに分離することです。

``` text
Batch ── BatchRelation ──▶ Batch
Generation ── BatchReference ──▶ Batch
Batch ── StoryRelation ──▶ Batch
```

## Experiment

1つの検証テーマです。例えば「結月ゆかりの脚部で黒タイツと薄紫ソックスを安定して分離する」のように、base
recipe に対する override を変えながら反復し、安定した条件を
comfyui-recipes へ昇格させるまでを1単位として扱います。

主な属性:

``` text
id
short_id
name
description
note
status
base_recipe
base_generation_id
character_id
bookmark
created_at
updated_at
completed_at
```

status の候補と遷移:

``` text
active     → stabilized, abandoned
stabilized → promoted, active, abandoned
promoted   → active
abandoned  → active
```

`active` を離れた時点で `completed_at` が立ち、`active`
に戻すと消えます。`stabilized → promoted` では最初に完了した時刻を保ちます。許可されていない遷移は409です。

過去の生成系譜を辿るときは、過去の Experiment を「再開」するより、過去
Generation を Reference として新しい Experiment / Batch
に取り込み、現在の prompt / recipe で rebuild します。Experiment
自体の再開は、この rebuild とは別に、`abandoned` / `promoted` から
`active` への status 遷移として扱います。

`base_generation_id`（nullable）はこの rebuild 元の Generation です。設定すると、
自動起票される各 Run の request にも purpose `rebuild` の Reference として渡ります
（下記 Request 節）。あくまで各 request payload への伝播であり、BatchReference
そのものは相変わらず唯一の永続化された material relation です。

Experiment は原則物理削除しません。

## ExperimentRun

Experiment 内の1回の試行です。`run_index` は Experiment
内で1から連番、`(experiment_id, run_index)` は一意です。
`batch_id` も Run 間で一意です（1 Batch は 1 Run にしか属さない）。既に他の Run
に付いている Batch を付けようとすると 409 になります。

主な属性:

``` text
id
experiment_id
run_index
parent_run_id
batch_id
generation_id
overrides_json
objective
evaluation_json
decision_json
note
variables_json
created_at
updated_at
```

`overrides` は base recipe に対する差分だけを保持し、recipe
全体は保存しません。`parent_run_id` は「どの Run を受けて次を試したか」を表します。

既存の Batch / Generation は ExperimentRun 側から参照します（Generation
/ Batch 側に experiment_run_id は持たせません）。

`overrides` / `evaluation` / `decision` は typed schema を持たない
JSON blob です。評価軸は Experiment や評価者ごとに変わるため、DB
カラムに分解しません。将来 typed schema を載せられるよう、API
境界では任意の JSON オブジェクトを受けます。

`overrides` の実際の語彙は comfyui-recipes の patch 形式
（`generation.patches` と同じもの）で、chimera はそれを検証も解釈もせず
そのまま保存・返却します。patch の意味づけとバリデーションは
comfyui-recipes 側の唯一の実装に集約され、chimera 側に翻訳層を持ちません。

ただし封筒の形だけは chimera 側で検証します。`overrides` は `{}` か
`{"patches": [...]}` のどちらかで、それ以外のトップレベルキーは400で拒否します。
各 patch は `target` / `op` / `reason` を持つオブジェクトで、いずれも非空文字列
であることまでを検証します（`reason` は全 patch で必須）。`value` / `old`
の有無・型は op に依存するため検証しません。base_parameters
相当の生成パラメータ（`pose` / `costume` など）が overrides
に紛れ込む事故を型で防ぐのが目的で、patch の語彙 (target / op
に何が使えるか) は引き続き comfyui-recipes 側の実装に属します。
同じ検証を `promoted_overrides`（ExperimentPromotion）にも適用します。
`evaluation` / `decision` はこの検証を通さず、引き続き完全に自由記述です。

overrides の例:

``` json
{
  "patches": [
    { "target": "prompt.positive", "op": "append", "value": ", light purple thighhigh socks", "reason": "ソックスの縁を明示する" },
    { "target": "prompt.negative", "op": "remove", "old": "bare legs", "reason": "..." },
    { "target": "render.cfg", "op": "set", "value": 4.5, "reason": "..." }
  ]
}
```

evaluation の例:

``` json
{
  "overall": "fail",
  "aspects": { "pose": "pass", "anatomy": "pass", "clothing": "fail", "composition": "pass" },
  "notes": ["sock/tights boundary is ambiguous"]
}
```

decision の例:

``` json
{
  "action": "retry",
  "reason": "legwear separation failed",
  "next_overrides": { "prompt": { "positive_append": ["distinct sock cuff"] } }
}
```

`action` は `retry` / `accept` / `stabilize` / `abandon` を想定しますが
enum化しません。

`variables` はグラフ（`render_facts`、ComfyJob 参照）からは表現できない
factor を CLI / 人間が書き添えるための、キー文字列 → `string | number`
のフラットな注記です（プロンプトのバリアント名など）。overrides
と違ってこれは provenance（何がその生成結果を生んだか）ではなく単なる
ラベル付けなので、`overrides` のように attach 後は不変、という制約を
持ちません。Batch / Generation が attach された後でも自由に変更できます。

不変条件:

-   ExperimentRun は原則物理削除しません。
-   Batch / Generation が attach された Run の `overrides`
    は変更できません（409）。条件を変えるなら新しい Run を作ります。
-   attach 済みの Batch / Generation を別のものに付け替えることはできません（409）。同じ
    id の再送は冪等です。
-   `variables` に上記の制約はありません（いつでも変更・クリア可能）。

## ExperimentPromotion

「この Experiment のこの条件を comfyui-recipes へ昇格させる」という意思決定と結果の記録です。chimera
が recipe を書き換えることを意味しません。

主な属性:

``` text
id
experiment_id
source_run_id
promoted_overrides_json
status
target_repository
target_path
commit_sha
pull_request_url
note
created_at
updated_at
completed_at
```

status の候補:

``` text
proposed
applied
rejected
```

`proposed` からのみ確定でき、`applied` / `rejected`
は終端です（409）。`commit_sha` / `pull_request_url`
は作成後に更新できます（作成時点では未定でよい）。

不変条件:

-   ExperimentPromotion は原則物理削除しません。
-   確定済み Promotion の `promoted_overrides` は変更できません（409）。

## Preset

承認済みの Generation から作られる、名前の付いた派生の正本です。base となる pose の
本文は comfyui-recipes の `poses.py` に残り、Preset が持つのはその pose への参照と、
そこへ積んだ patches の列です（移行の段は
[worker-protocol.md](worker-protocol.md#preset-の移行)）。

pose の本文を chimera が持たないのは、組み立てが costume に依存する条件分岐
（gate 付きの splice、legwear の ban、shod 判定）を含むためです。catalog が publish
できるのはその分岐を実行した後の prompt ペアだけで、それを保存しても
`parameters.costume` の上書きが成立しません。分岐そのものをデータとして chimera に
持たせると、chimera が prompt の語彙を解釈することになり、下の不変条件と衝突します。

Preset が解いているのは別の問題です。良かった生成の patches を名前と版の付いた
再利用可能な単位にすること — 以前はそれに comfyui-recipes の PR と deploy が
必要でした。

主な属性:

``` text
id
recipe                yukari
kind                  pose | costume | expression
name                  lounge
version               1 以上。(recipe, kind, name) の中で単調増加
body_json             { recipe_pose } または { base, patches }
base_fingerprint      昇格時点の組み立て済み本文の digest（import 由来は null）
status                active | deprecated
source                import | promote
source_generation_id  promote の起点 Generation（import は null）
note
created_by            system | mcp | gui
created_at
```

`(recipe, kind, name, version)` が一意です。`recipe_ref` は持ちません。ブランチで
preset 空間を分けるのではなく、試したいものを新しい版として足し、request 側が版を
指名します。`recipe_ref` は node pack のコードのブランチ名だけを意味するようになります。

### body の形

`source = import` の行は comfyui-recipes 側の pose への参照だけを持ちます。本文は
持ちません。

``` json
{ "recipe_pose": "lounge" }
```

import するのは pose だけです。catalog の `costumes` / `expressions` は名前の配列でしか
publish されておらず、参照にしても行が増えるだけで何も足しません。`kind` に
`costume` / `expression` が残っているのは、将来 comfyui-recipes 側がそれらの base を
名前で公開したときに同じ形で載せられるようにするためです。

`source = promote` の行は prompt 本文ではなく「どの版に何を足したか」を持ちます。

``` json
{
  "base": { "recipe": "yukari", "kind": "pose", "name": "lounge", "version": 7 },
  "patches": [{ "target": "pose", "op": "append", "reason": "...", "value": "..." }]
}
```

読み出しは解決済みの形で返します。`base` の連鎖を根まで辿り、根の `recipe_pose` 1件と、
根から指定版までの patches を順に並べた配列にします。参照を本文に解決して patches を
畳むのは worker 側の graph compiler で、`parameters.costume` の上書きは今まで通り
そこで効きます。

不変条件:

-   preset 行は物理削除しません。`deprecated` はラベルで、過去の request が指名した
    版は永久に引けます。
-   promote は既存の版を書き換えません。必ず新しい版を足します。
-   promote の起点 Generation は `rating = good` でなければなりません。Rating を書ける
    のは人間だけなので（[Rating](#rating)）、preset の審査は人間に残ります。
-   chimera は preset の器の形だけを知り、patch の `op` の意味も pose の本文も
    解釈しません。器の形を知るのは、起点 Generation の Batch から promote 後の body を
    組み立てるためです。
-   base の再現性は preset の版ではなく `git_commit` が担います。`recipe_pose` が指す
    本文は comfyui-recipes の checkout の中にあり、版が固定するのは patches の層だけです。
    版が不変でも、指す先の pose は commit で動きます。
-   昇格できるのは、Batch が patches を持つ generate 由来の Generation だけです。
    `generation.prompt` で全文上書きしたものと、finalize / repair / masked_redraw の
    出力は patches という概念を持たないので昇格できません。
-   昇格の入力になる patches は Batch 行から取ります。`semantic.attributes.patches` は
    使いません。semantic の PUT は失敗しても生成が進み、MCP クライアントから後で
    書き換えられる場所でもあるので、正本になりません。
-   Batch が記録する patches は request 自身の分だけで、pin された preset が持っていた
    patches は含みません。実際に適用された全体は「pin された版を解決した patches +
    Batch の patches」で、この形なら昇格が preset 自身の patches を二重に取り込みません。
    Batch は `preset_versions_json` と `patches_json` の2つで、何が適用されたかを
    重複なく記録します。
-   Batch は自分が実際に解決した preset の版を記録します。`recipe_ref` はコードの
    ブランチしか指さないので、何が描かれたかを特定するのは
    `(git_commit, 解決済みの preset の版)` の組です。

### base が動くことへの備え

patches の text op（replace / remove）は本文の needle に依存し、needle が消えると worker
側で落ちます。base が参照である以上この結合は避けられないので、昇格した版にはその時点の
本文の digest を `base_fingerprint` として一緒に記録します。worker が Batch を作るときに
送ってくる同じ digest と突き合わせれば、その preset を使う前に「本文 X に対して昇格された
が worker は今 Y を組み立てる」と言えます。

digest の対象は pose レコードではなく、その pose を既定 costume で組み立てた prompt ペア
です。patches の needle が結び付いているのは組み上がった本文であり、組み立てには pose
レコード以外（style の共通部、costume の連結順序）も効くためです。既定 costume に固定
するのは、`parameters.costume` の上書きが正規の機能である以上、上書きして描いた本文の
digest を送ると「上書きした」と「base が動いた」が区別できなくなるからです。

``` text
sha256( canonical_json({ recipe, pose, positive, negative }) )
```

canonical JSON はキー昇順・空白なし・UTF-8 で、値は既定 costume での組み立て結果です。
chimera はこの文字列を不透明に保存し、突き合わせにしか使いません。既定以外の costume に
だけ効く編集の drift はここには出ませんが、その場合も needle 不在は worker の probe が
必ず捕まえます。

落ち方自体は静かではありません。worker は claim 直後の probe で patch の適用を試し、
落ちれば Batch を1つも作らずに request を `failed` にします。fingerprint は、使おうとする
より前に気付くための層です。

## Observation

「あるパラメータについて何を試して何が起きたか」の記録です。comfyui-recipes の
`experiments/<character>/<pose>.jsonl` を写した索引で、正本ではありません。

正本を動かさないのは、preset のときと壊れ方の種類が違うためです。preset は worker が
graph を組むのに要る load-bearing なデータで、正本が二箇所にあると本番が壊れます。
experiments の記録は誰も実行せず、人と agent が判断のために読むだけです。しかも
comfyui-recipes の `AGENTS.md` は「pose や tag を変える前に experiments/ を grep しろ」と
定めていて、これは編集中にオフラインで即座に効きます。数百行の grep はゼロ秒で、MCP の
往復はそうではありません。索引を得るために grep を失うのは損です。

append-only を強制しているのが git である点も動かせません。JSONL は書き換えれば diff に
出ますが、chimera を正本にすると、その強制がテーブルの運用規約に置き換わって弱くなります。

主な属性:

``` text
id                出所（path と行番号）と元レコードの正規化 JSON の SHA-256
character         yukari
pose              観測した pose。module 全体の観測なら null
component         costumes / prompt_style / recipe 等。pose 単位なら null
parameter         振った対象（タグ、重み、設定）
value             試した値
outcome           accepted | rejected | inconclusive
reason            観測されたこと
seed              その観測を取った seed。無ければ null
render_id         worker 側の id。chimera は不透明に持つ
generation_ids    観測の材料になった Generation（解決できたものだけ）
recipe            古い recipe に帰属する記録だけ入る
observed_at       元の記録の日付。無ければ null
supersedes_id     この記録が撤回する Observation
source            import | mcp | gui
created_at
```

不変条件:

-   append-only です。Observation は編集も削除もしません。後の実験が前の結論を覆したと
    きは、古い行を書き換えず `supersedes_id` を持つ新しい行を足します。JSONL 側の
    append-only policy をそのまま持ち込んでいます。
-   `id` は `{ path, line, record }` の正規化 JSON の SHA-256 です。同じ行は何度流しても
    同じ Observation になるので、JSONL 全体を丸ごと再送できます。索引が正本より古いのは、
    正本が古いより厄介です。「chimera に無い = まだ試していない」と読んだ人が、既に落ちた
    道をもう一度歩くためで、`rejected` を引けるようにするのが目的である以上そこが腐ると
    目的が消えます。同期は追加だけで、payload に無い行を消しません（append-only と同じ理由）。
-   id に出所を混ぜるのは、内容だけにすると byte 一致する再測定が黙って消えるためです。
    同じ pose の同じ parameter を同じ value で測り直して同じ結果が出たら、それは再現の
    記録であって独立した観測です。append-only policy はそれを新しいレコードとして足すよう
    求めています。`(path, line)` は append-only である限り安定した識別子で、既存行の位置は
    動きません。ファイルを並べ替えたり行を書き換えれば重複行ができますが、それは policy が
    禁じている操作で git の diff に出ます。静かに消えるより、うるさく重複する方が台帳の
    壊れ方として正しいはずです。ファイル名を変えると同じ理由でその1ファイル分が重複するので、
    `inserted` が 0 でない同期は中身を見ます。
-   import 由来の行は `supersedes_id` を持ちません。JSONL は撤回を散文で表現していて
    （「先の accepted を測り直したら再現しなかった」）、構造化された参照が無いためです。
    `supersedes_id` が入るのは MCP / GUI から書かれた Observation だけです。
-   `pose` と `component` の少なくとも一方が必要です。どちらも持たない記録は
    Observation ではありません。レコード自身がどちらも持たないときは、送り手が
    `component` を添えます。chimera はファイル名から推測しません。ファイル名は中身を
    代表しないことがあり、推測すると誤ったラベルが付きます。
-   Observation は履歴であって現在の規則ではありません。現在の規則は pose recipe の
    コメント側にあります。
-   どの `reason` も、その pose / seed / tag ブロック / canvas の下での観測であって、
    タグ一般についての主張ではありません。「`boss` のブロックの下で `smug` を 1.4 に
    すると得意げに読めた」は、このプロジェクトの他のどこかでの `smug` 1.4 について
    何も言っていません。引くときは過去の一データ点として扱います。

### 実験のアームは Observation ではない

`experiments/` の記録には、パラメータの観測ではなく実験のアームそのもの（Batch を
指名し、seed の組を持ち、verdict と observation を持つ）が混ざっています。これは
Experiment / ExperimentRun にそのまま入るので、Observation にはしません。

アームが Generation を指名していて Batch を指名していない記録は、Run に組み直せません。
1アームの Generation が複数の Batch にまたがっている（当時 count=1 で1枚ずつ回していた）
ためで、Run にすると存在しない実行単位を捏造することになります。この形は Observation
として写し、axis を `parameter`、採用された Generation を `generation_ids` に入れます。
アーム分けは chimera に対応する行が無いので持ち込みません。JSONL 側に残ります。

## Request

chimera を control plane、GPU 機を worker とする配置（[worker-protocol.md](worker-protocol.md)）の
ジョブキュー1行です。worker が claim して実行し、結果を ingest してから状態を書き戻します。

主な属性:

``` text
id
kind              generate | finalize | repair | masked_redraw
status            queued | running | done | failed | cancelled
payload_json
payload_hash
recipe_ref
run_id
worker_id
attempt
max_attempts
claimed_at
heartbeat_at
finished_at
error
result_json
idempotency_key
created_by        brain | mcp | gui | system
created_at
updated_at
```

`run_id` は `kind = generate` で、ExperimentRun から自動起票された行にだけ付きます。
`payload` は kind ごとの request.json v1 相当の内容（generate）または
`{ generation_id, options }`（finalize / repair / masked_redraw）です。masked_redraw の
options は明示的な矩形 `regions` と非空の `prompt_patch` を必須とし、低〜中程度の
`denoise`、`mask_padding`、`mask_feather` を保持します。契約全体（状態遷移、API、payload
の形、idempotency の導出）は [worker-protocol.md](worker-protocol.md) が正本です。

不変条件:

-   requests 行は物理削除しません。`cancelled` は `queued` からだけ入れる終端です。
-   `run_id` を持つ generate の `done` は、requests 行の更新と対応する
    ExperimentRun への `batch_id` の attach を単一トランザクションで行います。
    request だけが done になって Run に batch が付かない状態は作りません。
-   ExperimentRun 作成時、Experiment に `base_recipe` があり status が
    active / stabilized なら、Run の INSERT と同じトランザクションで
    kind=generate の requests 行を自動起票します（1 Run につき1回、
    `idempotency_key = run:{run_id}`）。Experiment に `base_generation_id`
    もあれば、この自動起票 payload には `references: [{ generation_id,
    purpose: "rebuild" }]` が付きます（未設定なら `references` キー自体を省きます）。

## PairwiseJudgment

同じ seed の baseline run / arm run の生成結果を人間が盲検で対比較した記録です。Web GUI の
A/B Judge View（[ui.md](ui.md#a-b-judge-view)参照）でのみ作られます。

主な属性:

``` text
id
experiment_id
baseline_run_id
arm_run_id
seed
left_generation_id
right_generation_id
verdict
judged_at
```

verdict の候補:

``` text
left
right
tie
```

`left_generation_id` / `right_generation_id` は表示時にランダムに割り当てた向きで、`verdict`
はその向きへの回答です。どちらの Generation が baseline / arm 側だったかは列自体には残らず、各
Generation の `batch_id`（baseline run / arm run のどちらの batch から出たか）と突き合わせて
その都度導きます（API の `winner` フィールド）。この向き付けにより、GUI 上で人間が
baseline / arm のどちらを見ているか判別できません（盲検性）。

不変条件:

-   `(baseline_run_id, arm_run_id, seed)` は一意です。同じ組み合わせへの2回目の judgment は409です。
-   PairwiseJudgment は物理削除しません。

## Batch

**1生成リクエスト = 1 Batch** と定義します。

「seed 違いで9枚」は1 Batchです。Claude が結果を反芻し prompt
を修正して再度9枚生成した場合は別 Batch です。

主な属性:

``` text
id
experiment_id
raw_instruction
recipe
prompt
negative_prompt
parameters_json
git_commit
git_dirty
note
bookmark
status
created_at
```

status の候補:

``` text
created
running
completed
partial
failed
```

## ComfyJob

ComfyUI への実際の1リクエストです。

現在の運用では、9枚生成時にキューへ9回投入されるため、

``` text
1 Batch = 9 ComfyJobs
```

が基本です。

将来1 ComfyJobから複数outputが生成される可能性を許容します。

``` text
Batch 1:N ComfyJob
ComfyJob 1:N Generation
```

主な属性:

``` text
id
batch_id
comfy_prompt_id
seed
index
status
graph
render_facts_json
created_at
updated_at
```

`graph` は ComfyUI に投稿した prompt グラフ（JSON）です。Job のレコード単体から
`/prompt` へ再投稿して生成を再現できるようにするために保存します。

`render_facts_json` は `graph` から抽出した派生データ（checkpoint / models /
sampler ごとの steps・cfg・denoise・seed・prompt・latent / canvas / lora /
controlnet / seed / output のキャッシュ、`version` フィールドで抽出ロジックの
バージョンを持つ）です。`graph` を PATCH した時点で抽出して保存しますが、
それ以前に `graph` だけが入った既存行のために NULL も許容し、その場合は
最初の読み取り時に抽出して書き戻します（遅延キャッシュ、一括バックフィルは
しません）。保存済みの `version` が現在の `RENDER_FACTS_VERSION`
未満（v1キャッシュのように `version` フィールド自体が無い場合を含む）も
同様に「未抽出」扱いとし、最初の読み取り時に再抽出して書き戻します。
抽出ロジックとルールは `src/lib/render-facts.ts` / [api.md](api.md#comfyjob) 参照。

## Generation

生成画像そのものの永続単位です。

1 Generation は必ず1 Batchに属します。別の Experiment / Story
で再利用しても、元の Batch 所属は変更しません。

MVPでは1 Generationにつき Character は0..1です。

主な属性:

``` text
id
short_id
batch_id
comfy_job_id
character_id
seed
original_filename
r2_object_key
note
rating
bookmark
semantic_schema_version
summary
semantic_json
summary_status
summary_model
summary_updated_at
created_at
```

Generation は原則物理削除しません。失敗画像も履歴として保持し、Tag /
status 等で扱います。

## GenerationAsset

Generation 本体（`r2_object_key` が指す完成画像 = composite）に対して、線画・マスク・分解レイヤー・PSD
等の**レイヤーアセット**を追加で紐付けます。

``` text
Generation 1:N GenerationAsset
```

主な属性:

``` text
id
generation_id
role
region
r2_object_key
content_type
size
created_at
updated_at
```

`role` はアセットの種類、`region` は体のどの部位かを表す任意区分です。両方とも自由文字列（enum
にしない）ですが、以下を推奨語彙とします。

role:

``` text
composite       完成画像。generations.r2_object_key が正であり、
                GenerationAsset には入れない
lineart-draft
lineart-inked
mask
layer
base
shadow
highlight
part
depth
meta
psd
```

region:

``` text
skin
hair
clothes
legs
tights
socks
shoes
face
```

region は自由文字列で、絵ごとに増えて構いません。

`region` が空文字（`''`）のとき「部位区分のない全体アセット」を表します。NULL
は使いません（SQLite の `UNIQUE` は NULL 同士を別値として扱うため、`region`
込みの一意性が壊れます）。API 境界ではキー省略・明示 `null`
のどちらも受理し、いずれも `''` に正規化します。レスポンスでは逆に `''` を
`null` に戻します。

`(generation_id, role, region)` は一意です。同じ組み合わせへの再投稿は新しい行を追加せず、既存行を**置換**します（最新版のみ保持）。Generation
本体に適用される「物理削除しない」不変条件は GenerationAsset
には適用しません — 置換は明示的な仕様です。

## Character

検索の第一級属性です。

``` text
id
name
aliases
```

MVPでは複数キャラクター画像を対象外とします。

## BatchReference

**新しい Batch を生成するために、過去 Generation
の何を参照したか**を表す強い provenance です。

``` text
Generation ──▶ Batch
```

例:

``` text
G123 -- pose ----\
                  > B200
G456 -- outfit --/
```

主な属性:

``` text
id
source_generation_id
target_batch_id
purpose
aspect
instruction
created_at
```

purpose 例:

``` text
composition
reference
rebuild
continuity
```

aspect は Core semantic と揃えつつ拡張可能です。

``` text
pose
expression
outfit
style
composition
other
```

## BatchRelation

生成試行としての Batch 間関係です。

``` text
B001 -- refinement --> B002
```

Claude
の自動再試行と、人間の追加指示による再試行を同じモデルで表現し、actor
で区別します。

``` text
id
source_batch_id
target_batch_id
type
actor
reason
raw_instruction
created_at
```

actor:

``` text
human
claude
```

type 例:

``` text
refinement
retry
variation
```

## Story

生成 provenance とは独立した、作品・世界観上の連続性です。

Story は独立エンティティとして扱います。Tag は分類用途であり、Story の
sequence / branch / merge を Tag 階層に押し込みません。

主な属性:

``` text
id
name
description
note
bookmark
created_at
```

## StoryRelation

Story 上の Batch 間の遷移です。

分岐・合流を許す DAG とします。

``` text
B010
 ├── "海へ行く" ──▶ B020
 └── "帰宅する" ──▶ B021
```

主な属性:

``` text
id
story_id
source_batch_id
target_batch_id
raw_instruction
label
description
generated_by
created_at
updated_at
```

`label` / `description` は原則 Claude
が会話から自動生成して即時保存し、人間は必要な場合のみ後編集します。

Story は「何の続きか」を表し、BatchReference
は「何を材料にしたか」を表します。両者を混同しません。

## Tag

Tag 名は自由入力です。ただし UI / Claude とも既存 Tag
の再利用を推奨します。

``` text
tags
- id
- name
- description
- created_at
- updated_at
```

FK 整合性を維持するため、assignment は対象ごとに分けます。

``` text
generation_tags
batch_tags
story_tags
experiment_tags
```

Tag は rename / delete 可能です。

assignment には可能なら以下を保持します。

``` text
created_by: human | claude
created_at
```

## Rating

MVPでは Generation のみ3段階評価を持ちます。

``` text
bad
neutral
good
```

Tag と Rating は別概念です。

運用基準:

``` text
bad      失敗。破綻しており材料にもならない
neutral  惜しい・判断保留（デフォルト）
good     採用圏
```

4段階以上には拡張しません。「超気に入った」は Bookmark で表現します。
「惜しい」の理由は Rating ではなく Tag（`#pose-good` / `#hand-bad` 等）と
semantic metadata の strengths / defects が担います。Claude は
「neutral + defects の記述」から惜しさの内容を読み取れるため、
Rating は粗いフィルタ軸に徹します。

Rating を付けるのは人間のみです。Claude は人間の Rating と semantic
metadata を読んで改善案を設計する側であり、Rating を書き込みません
（Claude による画像検品は、人間がどうしても判断できない場合の
フォールバックに限ります）。

## Bookmark

Bookmark は「後から素早く呼び出す」ための状態です。

以下すべてに対応します。

``` text
Generation
Batch
Story
Experiment
```

Favorite ではなく Bookmark と呼びます。品質評価の段階ではありません。
「超気に入った」Generation は再利用したい Generation と実質同じ集合なので、
Rating を4段階に増やす代わりに Bookmark で表現します。

## Note / Summary

各主要エンティティは人間用 `note` を持てます。

Generation はさらに Claude が生成する `summary` / semantic metadata
を持ちます。

Bookmark にメモを付与せず、メモは対象エンティティ自身に保持します。

## Semantic Metadata

Core は固定し、拡張属性を許可します。

``` json
{
  "schema_version": 1,
  "summary": "...",
  "core": {
    "pose": null,
    "expression": null,
    "outfit": null,
    "style": null,
    "composition": null
  },
  "strengths": [],
  "defects": [],
  "attributes": {}
}
```

Core は Claude / API 間の安定した共通語彙です。判断不能な値は `null`
とします。

`attributes` は lighting、camera angle、stockings
等、将来追加される任意の semantic 情報を保持します。

schema version を必須とし、将来の変更時に過去 Generation 全件を強制
migration しない設計とします。

## Relation Separation

以下の3種類を統合してはいけません。

  Relation         意味
  ---------------- ----------------------------------------------
  BatchReference   過去Generationの何を生成材料として利用したか
  BatchRelation    前Batchを受けてどう再試行したか
  StoryRelation    作品・世界観としてどう続くか

この分離は本システムの重要な設計制約です。
