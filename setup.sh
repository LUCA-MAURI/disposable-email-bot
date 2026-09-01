#!/usr/bin/env bash
# One-time setup. Run inside the project directory:
#
#   BOT_TOKEN=123:ABC OWNER_ID=12345 ./setup.sh
#
# Before: `npx wrangler login`, and your domain in wrangler.toml.
set -euo pipefail
cd "$(dirname "$0")"

: "${BOT_TOKEN:?BOT_TOKEN is required (from @BotFather)}"
: "${OWNER_ID:?OWNER_ID is required (your Telegram chat id)}"

DOMAIN=$(grep -E '^DOMAIN' wrangler.toml | cut -d'"' -f2)
[[ "$DOMAIN" == "example.com" ]] && { echo "Put your domain in wrangler.toml first (DOMAIN, PUBLIC_BASE, routes)"; exit 1; }

npm install

# 1. KV namespace. Idempotent: once the id is in wrangler.toml it is reused.
if grep -q PUT_KV_ID_HERE wrangler.toml; then
  echo "== creating the KV namespace"
  KV_ID=$(npx wrangler kv namespace create MAIL 2>&1 | grep -oE '"?id"? *[:=] *"[a-f0-9]{32}"' | grep -oE '[a-f0-9]{32}')
  [[ -z "$KV_ID" ]] && { echo "KV id not found in wrangler's output: create it by hand and put the id in wrangler.toml"; exit 1; }
  perl -pi -e "s/PUT_KV_ID_HERE/$KV_ID/" wrangler.toml
  echo "   KV_ID=$KV_ID"
fi

# 2. Secrets. Stored by Cloudflare, never in a file here.
WEBHOOK_SECRET=$(openssl rand -hex 24)
echo "== uploading the secrets"
printf '%s' "$BOT_TOKEN"       | npx wrangler secret put BOT_TOKEN
printf '%s' "$OWNER_ID"        | npx wrangler secret put OWNER_ID
printf '%s' "$WEBHOOK_SECRET"  | npx wrangler secret put WEBHOOK_SECRET

# 3. Deploy
echo "== deploying"
npx wrangler deploy

# 4. Telegram webhook -> Worker, authenticated by the secret token
PUBLIC_BASE=$(grep -E '^PUBLIC_BASE' wrangler.toml | cut -d'"' -f2)
echo "== registering the webhook at $PUBLIC_BASE/tg"
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"${PUBLIC_BASE}/tg\",\"secret_token\":\"${WEBHOOK_SECRET}\",\"allowed_updates\":[\"message\"]}"
echo

cat <<MSG

Done. One last step BY HAND (Cloudflare does not expose it on the CLI):

  dash.cloudflare.com -> $DOMAIN -> Email -> Email Routing
  -> Routing rules -> Catch-all address -> Action: "Send to a Worker" -> disposable-email-bot -> Save

Then, in Telegram: /new netflix
MSG
