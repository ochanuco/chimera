#!/usr/bin/env bash
# 使い方: scripts/deploy.sh production
# 未適用の D1 migration を当ててから deploy する。適用済みかは d1_migrations で判定するので、
# ロールバック（古い ref）では当てるものがなく何もしない。
# migration があるときは scripts/d1-guard.mjs が適用前の Time Travel bookmark を取り、適用後に行が減っていたら Worker を出さずに止める。
# 行が入ったまま消えた（DROP や改名された）テーブルも、行が減ったものとして止める。意図した削除や改名は migration に `-- deploy: allow-row-loss <table>` と書く。
set -euo pipefail

if [ "${1:-}" != "production" ]; then
  echo "usage: scripts/deploy.sh production" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
state=$(mktemp)
trap 'rm -f "$state"' EXIT

node scripts/d1-guard.mjs before --driver wrangler --db chimera --dir migrations --state "$state"
pnpm exec wrangler d1 migrations apply chimera --remote
node scripts/d1-guard.mjs after --state "$state"
pnpm exec wrangler deploy
