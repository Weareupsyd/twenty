#!/usr/bin/env bash
# set-public-url.sh — set PUBLIC_BASE_URL application variable for Protecta Bode
# Usage:
#   ./scripts/set-public-url.sh https://protectabode.weareupsyd.com
#   PUBLIC_BASE_URL=https://protectabode.weareupsyd.com ./scripts/set-public-url.sh
#
# Requires TWENTY_API_KEY or .twenty-api-key and a running Twenty server.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="${TWENTY_API_KEY_FILE:-$SCRIPT_DIR/.twenty-api-key}"
PORT_FILE="$SCRIPT_DIR/.twenty-port"
PORT="2020"
if [[ -f "$PORT_FILE" ]]; then
  PORT="$(cat "$PORT_FILE" 2>/dev/null || echo 2020)"
fi

URL="${1:-${PUBLIC_BASE_URL:-}}"
if [[ -z "$URL" ]]; then
  echo "Usage: $0 https://protectabode.weareupsyd.com" >&2
  exit 2
fi

# Normalize: remove trailing slash
URL="${URL%/}"

if [[ -n "${TWENTY_API_KEY:-}" ]]; then
  KEY="$TWENTY_API_KEY"
elif [[ -s "$KEY_FILE" ]]; then
  KEY="$(tr -d '\r\n' < "$KEY_FILE")"
else
  echo "Error: TWENTY_API_KEY not set and $KEY_FILE not found" >&2
  exit 1
fi

SERVER_URL="${SERVER_URL:-http://localhost:${PORT}}"
# Try to detect port from running container
if command -v docker >/dev/null 2>&1; then
  DETECTED_PORT="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' twenty-app-dev 2>/dev/null | sed -n 's/^NODE_PORT=\([0-9]*\)$/\1/p' | head -n1 || true)"
  if [[ -n "$DETECTED_PORT" ]]; then
    SERVER_URL="http://localhost:$DETECTED_PORT"
  fi
fi

echo "==> Setting PUBLIC_BASE_URL to $URL"
echo "    Server: $SERVER_URL"
echo "    Key: ${KEY:0:8}..."

# Use Twenty's metadata API to update application variable?
# The application variables are managed via the app manifest, but we can set
# them via the Twenty CLI if available, or via direct GraphQL.

# Try GraphQL mutation to update application variable
# This is a best-effort: if it fails, we instruct manual steps.

# First, find the Protecta application ID
APP_ID="f7d814ab-cbfd-48bc-9ee0-06a06daae1a4"

# We need to use the REST API? Actually application variables are updated via
# twenty CLI apply or via Settings UI. The simplest reliable way is to use
# the Twenty CLI's `twenty` command if available, or tell user to set via UI.

# Attempt via GraphQL: update application variable
# Note: The actual mutation may vary by Twenty version; we try common ones.

GRAPHQL_QUERY=$(cat <<EOF
mutation {
  updateApplicationVariable(
    applicationId: "$APP_ID",
    key: "PUBLIC_BASE_URL",
    value: "$URL"
  ) {
    id
  }
}
EOF
)

RESPONSE=$(curl -sS --max-time 15 -X POST "$SERVER_URL/metadata" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$GRAPHQL_QUERY" | jq -Rs .)}" || true)

if echo "$RESPONSE" | grep -qi "PUBLIC_BASE_URL\|updateApplicationVariable\|ok"; then
  echo "Response: $RESPONSE" | head -c 500
  echo ""
  echo "✓ Attempted to set PUBLIC_BASE_URL via GraphQL. Verify in Settings → Protecta Bode → Variables."
else
  echo "GraphQL attempt response (may need manual):"
  echo "$RESPONSE" | head -c 1000
  echo ""
  echo "If GraphQL failed, set it manually:"
  echo "  1. Open $SERVER_URL or $URL"
  echo "  2. Settings → Apps → Protecta Bode → Variables"
  echo "  3. Set PUBLIC_BASE_URL = $URL"
  echo "  4. Save"
fi

echo ""
echo "Also set via environment for local dev:"
echo "  PUBLIC_BASE_URL=$URL is used to build absolute links for quotes, policies, and WhatsApp webhooks."
echo ""
echo "For Evolution webhook, use:"
echo "  $URL/s/protecta/whatsapp/webhook"
echo ""
echo "Done."
