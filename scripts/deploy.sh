#!/usr/bin/env bash
# 使い方: scripts/deploy.sh production
# 未適用の D1 migration を当ててから deploy する。適用済みかは d1_migrations で判定するので、
# ロールバック（古い ref）では当てるものがなく何もしない。
set -euo pipefail

if [ "${1:-}" != "production" ]; then
  echo "usage: scripts/deploy.sh production" >&2
  exit 2
fi

pnpm exec wrangler d1 migrations apply chimera --remote
pnpm exec wrangler deploy
