# chimera

ComfyUI Generation Manager（Management API + Web GUI）。Cloudflare Workers + D1 + R2、Hono + TypeScript + zod。GUI は hono/jsx SSR + vanilla JS（`src/ui/static.ts` を `/assets/*` で配信）。

## 正本と構成

- 設計は `docs/*.md` が正本。実装と食い違う変更をするときは docs も更新する
- Python CLI（request.json の送り手）は別リポジトリ comfyui-recipes の `comfyui_recipes` パッケージ（`comfy-recipes generate` CLI、実装は `src/comfyui_recipes/application/generate.py`）。API の互換性を壊す変更はそちらへの影響を確認する
- `src/app.ts` が Hono app の組み立て。API は `src/routes/*.ts`、SSR ページは `src/routes/pages.tsx` + `src/ui/`、スキーマは `src/schemas/`

## 検証

```sh
npm run typecheck && npm test
```

テストは @cloudflare/vitest-plugin（旧 vitest-pool-workers の後継）。migrations は `test/apply-migrations.ts` で自動適用される。

## 設計上の不変条件（壊さないこと）

- Relation 3種の分離: BatchReference（生成材料）/ BatchRelation（再試行）/ StoryRelation（作品上の続き）を統合しない
- Generation は物理削除しない。削除より rating / tag によるラベリング
- 冪等性: Batch / Job 作成は idempotency_key、ingest は (comfy_job_id, comfy_output_index) unique。再送は既存レコードを 200 で返す
- ingest は D1 INSERT → R2 PUT の順（行が ID / R2 key を確定し、orphan object を作らない）。R2 key は `generations/{generation_id}/original.png`
- `references` / `refinement` / `story` はキー省略と明示 null の両方を「該当なし」として受理する（request.json 契約）
- SSR ページから API を呼ぶときは `src/lib/internal-api.ts` の `internalApiRequest` を使う（`app.request` にパスだけ渡すと origin が localhost になり絶対 URL が壊れる）
- 認証はアプリ内に実装しない（Cloudflare Access 境界）。workers.dev ルートは無効のまま維持する
- GUI が積んでよいのは semantic 判断を伴わない再実行（finalize）だけ。GUI が触るのは自分の D1 の requests 行のみで、ComfyUI へは到達しない（`docs/worker-protocol.md`）。Compare は semantic metadata の diff 表示まで（指示テキスト生成はしない）

## 本番

- https://chimera.chanu.co （D1 `chimera` / R2 `chimera-images`）
- デプロイ: `npx wrangler deploy`。スキーマ変更時は先に `npx wrangler d1 migrations apply chimera --remote`
- API 疎通確認用の Service Token は 1Password `chimera-claude-agent`（`op` で取得、コミット禁止）
- 本番でテストデータを作ったら削除まで行う（`wrangler d1 execute --remote` + `wrangler r2 object delete --remote`）
