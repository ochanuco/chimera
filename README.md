# chimera — ComfyUI Generation Manager

ComfyUI で生成した画像を、単なる置き場ではなく生成探索の provenance・Story・評価・semantic 情報つきで永続管理する Web GUI / Management API。

設計ドキュメントは [docs/](docs/README.md) が正本。

## 使い方

### Web GUI

| パス | 内容 |
|---|---|
| `/gallery` | 画像グリッド。Character / Tag / Date / Rating / Bookmark で検索、カード上で rating・bookmark 変更 |
| `/batches`, `/b/{short_id}` | 生成リクエスト単位の一覧・詳細 |
| `/g/{short_id}` | Generation 詳細（canonical URL）。Summary / Semantic / References / Story / Prompt / Seed / Git などは折りたたみ表示 |
| `/stories`, `/stories/{id}` | Story の一覧・DAG 表示。relation の label はインライン編集可 |
| `/bookmarks` | Bookmark した Generation / Batch / Story / Experiment |
| `/compare?ids=a,b` | 2〜9枚比較。aspect を選んで Claude へ渡す指示テキストを生成・コピー |
| `/graph` | 生成履歴全体の Graph 表示。Reference / Refinement / Story の3種のエッジを視覚的に区別、パン/ズーム可能 |

### API

`/api/v1/*`。全エンドポイントは [docs/api.md](docs/api.md) を参照。代表的な流れ:

```
POST /api/v1/batches                      # 生成リクエスト登録（idempotency_key 必須）
POST /api/v1/batches/{id}/jobs            # ComfyJob 登録
POST /api/v1/jobs/{id}/generations        # 画像 ingest（multipart: metadata + image）
GET  /api/v1/generations?character=...    # 検索
GET  /api/v1/generations/{id}/context     # Claude 向け軽量 context
PUT  /api/v1/generations/{id}/semantic    # semantic metadata 保存
```

Batch / Job 作成と ingest は冪等（同一 idempotency_key / 同一 (job, output_index) の再送は既存を返す）。

クライアントは comfyui-recipes の `scripts/generate.py`（`request.json` 契約は [docs/generation-request.md](docs/generation-request.md)）。

## 開発

```sh
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest (@cloudflare/vitest-plugin)
npx wrangler d1 migrations apply chimera --local
npx wrangler dev         # http://localhost:8787
```

## デプロイ

```sh
npx wrangler d1 migrations apply chimera --remote   # スキーマ変更があるときのみ
npx wrangler deploy
```

リソースは D1 `chimera`、R2 `chimera-images`（`wrangler.jsonc` にバインド済み）。workers.dev ルートは Access を迂回させないため無効化してある。
