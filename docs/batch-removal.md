# Batch の廃止

Batch を廃止し、生成の単位を Request に一本化する設計と移行手順です。
移行が終わったら、ここに書いた最終形を domain-model.md / worker-protocol.md / generation-request.md / api.md / ui.md / experiment-agent.md へ反映し、このファイルは削除します。
それまでは、現行の挙動は各正本、移行後の形はこのファイルが正です。

## 廃止する理由

Batch は「1 生成リクエスト = 1 Batch」として定義されていますが、実態は Request の結果を写した行です。

- 案の比較（対照 + A〜F）は patch が案ごとに違うので、構造上 1 案 1 Batch になる。案をまとめる単位は Experiment → Run で、Batch はまとまりとして働かない
- 通常生成の Batch の 6 割強は 1 枚だけで、seed 違いを束ねる役割も果たしていない
- Batch 間の関係のうち、BatchRelation は refinement にしか使われておらず（1,437 件すべて）、StoryRelation / Story / Batch の tag・bookmark は 0 件
- Batch の列（recipe / instruction / patches / pins / git_commit）は Request の payload と重複し、実際に送った prompt は Job の graph / render_facts にある

（件数は 2026-10-03 時点の本番）

## 最終形

```
Experiment → Run → Request → ComfyJob → Generation
```

### Request

worker への生成要求 1 件です。generate / finalize / repair / masked_redraw / import のどれも、Generation は必ず Request に属します。
Batch が持っていた要求単位の情報は Request に移します。

| 列 | 中身 |
|---|---|
| `short_id` | 新設。移行した Batch はその `short_id` を引き継ぐ |
| `recipe` | worker が解決した recipe。graph-mode は NULL |
| `raw_instruction` | `request.instruction` |
| `parameters_json` | 解決済み parameters（`kind` / `pose` / `prompt_patch` を含む） |
| `patches_json` / `pose_fingerprint` | request 自身の patch 層と、組み立て済み本文の digest |
| `preset_versions_json` | 生成時の preset pin |
| `git_commit` / `git_dirty` | recipe リポジトリの commit |

既存の `run_id` / `status` / `payload_json` / `result_json` / `idempotency_key` はそのまま残します。
解決済みの値は worker が生成前に報告します（後述の worker 契約）。

実際に送った prompt / negative は Request に持たせません。
batch 単位の finalize のように 1 Request が複数の source を扱うと prompt が source ごとに違うので、prompt は Job の `graph` / `render_facts` を正とします。

### ComfyJob

`batch_id` を `request_id` に置き換えます。
`source_generation_id` を新設し、finalize / repair / masked_redraw の Job では仕上げ元の Generation を指します。

### Generation

- `request_id`: 所属 Request
- `refines_generation_id`: 仕上げ元の Generation。ingest 時に Job の `source_generation_id` から写す。raw Generation は NULL

今の `batches.refines_generation_id`（BatchRelation と rebuild Reference から導出していた値）は、この Generation 間の直接参照に置き換わります。

### 関係は 2 種

| 関係 | 向き | 用途 |
|---|---|---|
| 素材参照（RequestReference） | Generation → Request | 生成材料。`purpose` / `aspect` / `instruction` を持つ。今の BatchReference のうち `purpose = rebuild` 以外 |
| 仕上げ元 | Generation → Generation | `generations.refines_generation_id`。今の BatchRelation（refinement）と rebuild Reference を統合 |

再試行の BatchRelation と Story（StoryRelation）は廃止します。
この 2 種を統合しないことを、新しい不変条件とします。

### Experiment

Run の結果は `requests.run_id` で引きます。`experiment_runs.batch_id` は廃止します。
1 Run に done の generate Request は高々 1 件です。
A/B 判定（`pairwise_judgments`）は Generation の `request.run_id` で Run を特定します。

### 廃止するもの

- テーブル: `batches` / `batch_relations` / `batch_tags` / `story_relations` / `stories`。`batch_references` は RequestReference へ移す
- API: `/api/v1/batches*`、`/api/v1/stories*`、`GET /api/v1/graph` の Batch ノード
- MCP: `list_batch`。`get_generation` の `batch` ブロックは `request` ブロックになる
- GUI: `/batches`、Bookmarks の Batch 欄、Compare の `batch` 行。`/b/{short_id}` は、同じ `short_id` を持つ Request の最初の Generation へ redirect する（Discord などに貼られた URL を壊さない）

Batch の `note`（2 件）は、Request の最初の Generation の note へ追記して移します。

## worker 契約の変更

worker は `POST /api/v1/batches` を使わず、Request に直接書きます。

1. claim した Request に、解決済みの値を `PUT /api/v1/requests/{id}/resolution` で報告する（`recipe` / `parameters` / `patches` / `pose_fingerprint` / `preset_versions` / `git_commit` / `git_dirty` / 素材参照）。同じ値の再送は 200 で、応答に Job の再開情報（`jobs[]`、今の `POST /batches` 再送と同じ形）を含める
2. Job は `POST /api/v1/requests/{id}/jobs` で作る。キーは今と同じ `request:{request_id}:job:{index}`。finalize / repair / masked_redraw では `source_generation_id` を渡す
3. ingest は今と同じ `POST /api/v1/jobs/{jobId}/generations`
4. `PATCH /requests/{id}` の `done.result` は `generation_ids` だけになる（`batch_id` は不要）

request.json の `refinement` / `story` キーは、comfyui-recipes が送らなくなるまで受理して無視します。
キー省略と明示 null の両方を受理する現行の契約は維持します。

worker のキューを通らない画像（手加工、合成、poster などのスクリプト出力）は、今は `POST /batches` を直接叩いて登録しています。
これは `kind = import` の Request として扱います。
登録する側が `POST /api/v1/requests` に `kind: import`、`status: done` で Request を作り、同じ Request に Job と Generation を ingest します。
worker は `import` を claim しません。

## 移行

各段階は単独でリリースでき、途中で止めても本番は動き続けます。

### 段階 1: 新しい列と表を足し、両方に書く

- migration: `requests` に上の列と `short_id`、`comfy_jobs.request_id` / `source_generation_id`、`generations.request_id` / `refines_generation_id`、`request_references` を追加
- backfill:
  - `result_json.batch_id` で Request と対応する Batch は、その Request に列を写す
  - 対応する Request の無い Batch（1,824 件）は、Batch ごとに Request を 1 件補う。`id` は Batch の `id`、`status = done`、`created_by = system`、`idempotency_key = batch:{batch_id}`、`kind` は `parameters_json.kind` が repair / masked_redraw ならそれ、refines があれば finalize、`parameters_json.kind` が他の値（poster / prepaint / hand-edit など）なら import、どれでもなければ generate
  - Job / Generation の `request_id`、Generation の `refines_generation_id`、`request_references` を埋める
  - `experiment_runs.batch_id` があって対応 Request の無い Run（91 件）は、補った Request に `run_id` を付ける
- `POST /api/v1/batches` などの既存経路は、Batch と同時に Request 側の列も書く

### 段階 2: 読む側を Request / Generation に切り替える

- `derive_request` / 昇格 / pose pin 判定 / plain_render 判定 / 系譜 / original purge の保護条件 / Gallery の refines / A/B 判定を、新しい列から読む
- MCP `get_generation` に `request` ブロックを出し、`list_batch` を外す
- GUI の Batch ページを外し、`/b/` を redirect に置き換える。Generation 詳細に「同じ Request の Generation」を出す
- Story と再試行 Relation の API / GUI を外す

### 段階 3: worker を新しい契約へ移す

- chimera に `PUT /requests/{id}/resolution` と `POST /requests/{id}/jobs` を追加
- comfyui-recipes の worker と CLI を切り替える
- `kind = import` を受け付け、手加工・合成のスクリプトを切り替える
- 本番で `POST /api/v1/batches` が一定期間呼ばれていないことを確認する

### 段階 4: 撤去

- `/api/v1/batches*` と互換の書き込みを外す
- migration で `batches` / `batch_relations` / `batch_references` / `batch_tags` / `story_relations` / `stories` と、`comfy_jobs.batch_id` / `generations.batch_id` / `experiment_runs.batch_id` を削除
- 各正本 docs と CLAUDE.md の不変条件を最終形に書き換え、このファイルを削除

## 未決

- graph-mode（recipe なし）の Batch 2 件を、Request として残すか
