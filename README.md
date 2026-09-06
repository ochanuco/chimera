# chimera — ComfyUI Generation Manager

ComfyUI で生成した画像を、単なる置き場ではなく生成探索の provenance・Story・評価・semantic 情報つきで永続管理する Web GUI / Management API。Cloudflare Workers + D1 + R2、Hono + TypeScript。

設計ドキュメントは [docs/](docs/README.md) が正本。画面は [docs/ui.md](docs/ui.md)、API は [docs/api.md](docs/api.md)、クライアント（comfyui-recipes の `comfy-recipes generate` CLI）との `request.json` 契約は [docs/generation-request.md](docs/generation-request.md)。

## 開発

```sh
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest (@cloudflare/vitest-plugin)
npx wrangler d1 migrations apply chimera --local
npx wrangler dev         # http://localhost:8787
```

## デプロイ

`main` に merge すると `production release PR` workflow が `production` への昇格 PR を作る。その PR を merge すると Cloudflare Workers Builds が `npm run deploy:production`（D1 migrations apply → wrangler deploy）を実行する。`wrangler deploy` の手打ちはしない。
