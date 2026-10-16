# chimera

ComfyUI Generation Manager（Management API + Web GUI）。Cloudflare Workers + D1 + R2、Hono + TypeScript + zod。GUI は hono/jsx SSR + vanilla JS（`src/ui/static.ts` を `/assets/*` で配信）。

## 正本と構成

- 設計は `docs/*.md` が正本。実装と食い違う変更をするときは docs も更新する
- Python CLI（request.json の送り手）は別リポジトリ chagama の `chagama` パッケージ（`comfy-recipes generate` CLI、実装は `src/chagama/application/generate.py`）。API の互換性を壊す変更はそちらへの影響を確認する
- `src/app.ts` が Hono app の組み立て。API は `src/routes/*.ts`、SSR ページは `src/routes/pages.tsx` + `src/ui/`、スキーマは `src/schemas/`

## 検証

```sh
pnpm run typecheck && pnpm test
```

テストは @cloudflare/vitest-plugin（旧 vitest-pool-workers の後継）。migrations は `test/apply-migrations.ts` で自動適用される。

## 設計上の不変条件（壊さないこと）

- 関係 2 種の分離: 素材参照（Generation → Request、request_references）と仕上げ元（Generation → Generation、generations.refines_generation_id）を統合しない
- Generation は物理削除しない。削除より rating / tag によるラベリング。original 画像（`generations/{id}/original.png`）も削除しない（redraw / deliver が読むため）。過去に削除済みの行（`original_purged_at`）は preview で読める（`docs/domain-model.md`「original の保持」）
- 冪等性: Request / Job 作成は idempotency_key、ingest は (comfy_job_id, comfy_output_index) unique。再送は既存レコードを 200 で返す
- ingest は D1 INSERT → R2 PUT の順（行が ID / R2 key を確定し、orphan object を作らない）。R2 key は `generations/{generation_id}/original.png`
- `references` / `refinement` / `story` はキー省略と明示 null の両方を「該当なし」として受理する（request.json 契約）
- SSR ページから API を呼ぶときは `src/lib/internal-api.ts` の `internalApiRequest` を使う（`app.request` にパスだけ渡すと origin が localhost になり絶対 URL が壊れる）
- 認証はアプリ内に実装しない（Cloudflare Access 境界）。workers.dev ルートは無効のまま維持する
- GUI が積んでよいのは semantic 判断を伴わない再実行（redraw / deliver / saturation / stage / lighting / dof。stage の写真は登録済みの写真を選ぶだけ。stage の枠は位置・辺・ブラシの幾何指定だけ）と、リロール（元絵の generate payload をそのまま seed だけ変えて 4 枚振り直す。recipe・prompt は触らない）と、pin の再描画（絵柄チェック: pin 済み pose を pin の seed・recipe 既定のまま plain render する。GUI は prompt を書かない）だけ。GUI が触るのは自分の D1 の requests 行と、写真ページ（`/photos`）とワークベンチの背景フェーズがアップロードする写真（import の Request / Job / Generation と R2 の original）のみで、ComfyUI へは到達しない（`docs/worker-protocol.md`）。Compare は semantic metadata の diff 表示まで（指示テキスト生成はしない）

## 本番

- https://chimera.chanu.co （D1 `chimera` / R2 `chimera-images`）
- デプロイは main へのマージで GitHub Actions の `deploy` workflow が自動で実行する（`scripts/deploy.sh production` = `wrangler deploy`）。承認が要るのは、前回の記録がない・ロールバック・`migrations/` の変更を含むときだけで、Environment `production-approval` で止まる。何が出るかと承認の要否は run の `plan` ジョブの Job Summary に出る。手動実行（入力 `ref` は main か main 上の SHA）はロールバック用。`pnpm exec wrangler deploy` の手打ちはしない
- D1 migration はデプロイでは適用しない。migration を含む PR ごとに手で `wrangler d1 migrations apply chimera --remote` を実行する
- Workers Builds は PR ごとの Preview Builds だけが使う。production build の deploy command は `pnpm exec wrangler versions upload`（Cloudflare ダッシュボードで設定。リポジトリには無い）で、反映はしない
- API 疎通確認用の Service Token は 1Password `chimera-claude-agent`（`op` で取得、コミット禁止）
- 本番でテストデータを作ったら削除まで行う（`wrangler d1 execute --remote` + `wrangler r2 object delete --remote`）
- GPU 機の起床（`docs/worker-protocol.md`「GPU 機の起床」）は `WOL_BASE_URL` / `WOL_CLIENT_ID` / `WOL_CLIENT_SECRET` secret（1Password `chabatake-services/wol`）。未設定なら起床しないだけでキュー投入は動く
- telemetry は `POSTHOG_KEY` secret（`pnpm exec wrangler secret put POSTHOG_KEY`、1Password `posthog`）で有効化。ローカルは `.dev.vars`
