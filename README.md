# chimera — ComfyUI Generation Manager

ComfyUI で生成した画像を、単なる置き場ではなく生成探索の provenance・評価・semantic 情報つきで永続管理する Web GUI / Management API。Cloudflare Workers + D1 + R2、Hono + TypeScript。

MCP には、既存 Generation を変更せず任意の矩形を garment / local inpaint する
`masked_redraw_generation` もあります。これは `repair_generation`（hands / feet 専用）とは
別の worker request kind で、結果は Job の `source_generation_id`（Generation の `refines_generation_id`）で仕上げ元を追跡します。

設計ドキュメントは [docs/](docs/README.md) が正本。画面は [docs/ui.md](docs/ui.md)、API は [docs/api.md](docs/api.md)、クライアント（chagama の `comfy-recipes generate` CLI）との `request.json` 契約は [docs/generation-request.md](docs/generation-request.md)。

## 開発

```sh
pnpm install
pnpm run typecheck       # tsc --noEmit
pnpm test                # vitest (@cloudflare/vitest-plugin)
pnpm exec wrangler d1 migrations apply chimera --local
pnpm exec wrangler dev   # http://localhost:8787
```

## デプロイ

production へは、main への push で GitHub Actions の `deploy` workflow が出す。前回の記録がない、ロールバック、追加系でない migration（CREATE TABLE / CREATE INDEX / ALTER TABLE ADD 以外の文を含む、または既存 migration の変更）のときだけ、Environment `production-approval` の承認で止まる。ロールバックは `deploy` を main 上のコミット SHA を指定して手動で実行する。未適用の D1 migration は `wrangler deploy` の前に適用され、前後で `scripts/d1-guard.mjs` がテーブルの行数を比べ、行が減ったテーブルか、行が入ったまま消えた（DROP や改名された）テーブルがあれば `wrangler deploy` の前に止まる。意図した削除や改名は、migration に `-- deploy: allow-row-loss <table>` と書いて通す。

PR ごとの preview は Cloudflare Workers Builds の Preview Builds が作る。Workers Builds の production build は `pnpm exec wrangler versions upload` でバージョンを上げるだけで、反映はしない（設定は Cloudflare ダッシュボード側）。
