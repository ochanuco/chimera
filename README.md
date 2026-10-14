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

production へのデプロイは、GitHub Actions の `deploy` workflow を `main`（または main 上のコミット SHA）を指定して手動で実行する。Environment `production` の承認後に `wrangler deploy` が走る。D1 migration はデプロイでは適用せず、migration を含む PR ごとに手で適用する。

PR ごとの preview は Cloudflare Workers Builds の Preview Builds が作る。Workers Builds の production build は `pnpm exec wrangler versions upload` でバージョンを上げるだけで、反映はしない（設定は Cloudflare ダッシュボード側）。
