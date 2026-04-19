#!/usr/bin/env bash
# Deploy the chatgb-worker Worker using credentials from .env.
#
# Usage:
#   scripts/deploy-worker.sh            # build + deploy
#   scripts/deploy-worker.sh --dry-run  # validate config without deploying
#
# .env must contain (both fields are already set for this repo):
#   CLOUDFLARE_API_TOKEN=...
#   CLOUDFLARE_ACCOUNT_ID=...

set -euo pipefail

if [ ! -f .env ]; then
  echo "error: .env not found. See docs/worker-migration.md." >&2
  exit 1
fi

# Export only the Cloudflare creds so the rest of .env doesn't leak into
# wrangler's process env.
CLOUDFLARE_API_TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' .env | head -n1 | cut -d= -f2-)
CLOUDFLARE_ACCOUNT_ID=$(grep -E '^CLOUDFLARE_ACCOUNT_ID=' .env | head -n1 | cut -d= -f2-)

if [ -z "${CLOUDFLARE_API_TOKEN}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID}" ]; then
  echo "error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set in .env." >&2
  exit 1
fi

export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

if [ "${1:-}" != "--dry-run" ]; then
  echo "==> Building dist/"
  npm run build
fi

echo "==> wrangler deploy ${*:-}"
./node_modules/.bin/wrangler deploy "$@"
