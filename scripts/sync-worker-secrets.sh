#!/usr/bin/env bash
# Pipe secrets from .env into the chatgb-worker Worker.
#
# Values are read line-by-line and piped directly into
# `wrangler secret put` so they never appear in shell output or
# process argv. Only the key names are logged.

set -euo pipefail

if [ ! -f .env ]; then
  echo "error: .env not found." >&2
  exit 1
fi

CLOUDFLARE_API_TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' .env | head -n1 | cut -d= -f2-)
CLOUDFLARE_ACCOUNT_ID=$(grep -E '^CLOUDFLARE_ACCOUNT_ID=' .env | head -n1 | cut -d= -f2-)
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

KEYS=(
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  OPENROUTER_API_KEY
  MCP_SERVER_URL
  MCP_TOKEN_ISSUE_URL
  MCP_TOKEN_ISSUE_SECRET
  MCP_TOKEN_ENCRYPTION_KEY
  ADMIN_EMAIL
  APP_URL
  INVITE_APP_URL
  ALLOWED_EMAIL_DOMAINS
  RESEND_API_KEY
  RESEND_WEBHOOK_SECRET
  RESEND_FROM_EMAIL
  CRON_SECRET
  DATA_RETENTION_DAYS
  SOFT_DELETE_GRACE_DAYS
  AUDIT_LOG_RETENTION_DAYS
  COUNCIL_NATIONAL_SOURCE_PREFERENCE
  COUNCIL_NATIONAL_WHATGOV_MPS_TABLE
  COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE
  ADMIN_API_URL
)

missing=()
for key in "${KEYS[@]}"; do
  value=$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    missing+=("$key")
    continue
  fi
  echo "==> secret put $key"
  printf "%s" "$value" | ./node_modules/.bin/wrangler secret put "$key" \
    --config=wrangler.worker.jsonc >/dev/null
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "note: these keys were absent from .env and were not set on the Worker:"
  printf '  - %s\n' "${missing[@]}"
fi

echo
echo "done. Run scripts/deploy-worker.sh to apply."
