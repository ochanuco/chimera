#!/usr/bin/env bash
# production への昇格 PR の check。deploy の dry-run で wrangler 設定とバンドルが通ることを確かめ、
# 未適用の migration を一覧に出す。migration の適用自体は Workers Builds の deploy command
# （`wrangler d1 migrations apply` → `wrangler deploy`）が行う。
set -euo pipefail

expected=1
for f in $(ls migrations/*.sql | sort); do
  n=$(basename "$f" | sed -E 's/^([0-9]{4})_.*/\1/')
  if [ "$n" != "$(printf '%04d' "$expected")" ]; then
    echo "::error::unexpected migration number in $f (expected $(printf '%04d' "$expected"))"
    exit 1
  fi
  expected=$((expected + 1))
done

pnpm exec wrangler deploy --dry-run --outdir=.wrangler-dry-run

# CLOUDFLARE_API_TOKEN があれば本番 D1 の未適用 migration を一覧に出す。無ければ skip
# （Workers Builds が deploy 前に apply するので、ここでは fail にしない）
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  pnpm exec wrangler d1 migrations list chimera --remote
fi
