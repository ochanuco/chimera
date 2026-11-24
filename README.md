# chimera

ComfyUI の生成を管理する Cloudflare Worker。本番は https://chimera.chanu.co 。

- 生成依頼（`request.json`）を requests キューで受け、GPU 機の worker（[chagama](https://github.com/ochanuco/chagama)）が WebSocket で取って描き、結果を ingest で返す
- 生成画像を R2 に、来歴（どの Request から描いたか、どの Generation を仕上げたか）・評価・タグを D1 に残す
- Web GUI でギャラリーを見て rating / bookmark を付け、描き直しや仕上げの再実行を積む
- `/mcp` の MCP サーバーから、agent が依頼・評価・Experiment の記録をする

認証はアプリに持たず、Cloudflare Access の内側に置く。

構成は Hono + TypeScript + zod、D1、R2。GUI は hono/jsx の SSR と vanilla JS。

## ドキュメント

設計の正本は [docs/](docs/README.md)。

| 文書 | 内容 |
| --- | --- |
| [architecture.md](docs/architecture.md) | 構成と責務、R2 の置き方 |
| [domain-model.md](docs/domain-model.md) | テーブルと関係、original の保持 |
| [generation-request.md](docs/generation-request.md) | `request.json` 契約 |
| [worker-protocol.md](docs/worker-protocol.md) | requests キューと worker の契約 |
| [api.md](docs/api.md) | Management API |
| [ui.md](docs/ui.md) | Web GUI |
| [experiment-agent.md](docs/experiment-agent.md) | MCP からの Experiment 運用 |

## 開発

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm exec wrangler d1 migrations apply chimera --local
pnpm exec wrangler dev   # http://localhost:8787
```

## デプロイ

main に push すると GitHub Actions の `deploy` workflow が production に出す。次のときだけ Environment `production-approval` の承認で止まる。

- 前回のデプロイの記録がない
- ロールバック
- 追加系でない migration を含む（CREATE TABLE / CREATE INDEX / ALTER TABLE ADD 以外の文がある、または既存の migration を変えた）

ロールバックは `deploy` を main 上のコミット SHA を指定して手動で実行する。

未適用の D1 migration は `wrangler deploy` の前に適用する。適用の前後で `scripts/d1-guard.mjs` がテーブルの行数を比べ、行が減ったテーブルや、行が入ったまま消えたテーブルがあれば Worker を出さずに止まる。意図した削除や改名は migration に `-- deploy: allow-row-loss <table>` と書いて通す。

PR ごとの preview は Cloudflare Workers Builds の Preview Builds が作る。Workers Builds の production build は `wrangler versions upload` までで、反映はしない（設定は Cloudflare ダッシュボード側）。
