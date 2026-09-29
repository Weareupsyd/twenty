#!/usr/bin/env bash
# setup-evolution-webhook.sh — configure Evolution API default webhook to talk to Twenty CRM
# Usage:
#   ./scripts/setup-evolution-webhook.sh
#   ./scripts/setup-evolution-webhook.sh --base-url http://localhost:8080 --instance protecta --api-key YOUR_KEY --webhook https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
#   EVOLUTION_API_URL=http://localhost:8080 EVOLUTION_INSTANCE=protecta EVOLUTION_API_KEY=xxx WEBHOOK_URL=https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook ./scripts/setup-evolution-webhook.sh
#
# This is the webhook Evolution will POST inbound WhatsApp messages to.
# Twenty CRM endpoint: /s/protecta/whatsapp/webhook
# It must be publicly reachable from Evolution (not localhost) when using the hosted domain.

set -euo pipefail

BASE_URL="${EVOLUTION_API_URL:-http://localhost:8080}"
INSTANCE="${EVOLUTION_INSTANCE:-protecta}"
API_KEY="${EVOLUTION_API_KEY:-}"
WEBHOOK_URL="${WEBHOOK_URL:-https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --base-url=*) BASE_URL="${1#*=}"; shift ;;
    --instance) INSTANCE="$2"; shift 2 ;;
    --instance=*) INSTANCE="${1#*=}"; shift ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --api-key=*) API_KEY="${1#*=}"; shift ;;
    --webhook) WEBHOOK_URL="$2"; shift 2 ;;
    --webhook=*) WEBHOOK_URL="${1#*=}"; shift ;;
    -h|--help)
      echo "Usage: $0 [--base-url URL] [--instance NAME] [--api-key KEY] [--webhook URL]"
      echo ""
      echo "Defaults:"
      echo "  BASE_URL: $BASE_URL"
      echo "  INSTANCE: $INSTANCE"
      echo "  WEBHOOK:  $WEBHOOK_URL"
      echo ""
      echo "Env vars: EVOLUTION_API_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY, WEBHOOK_URL"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$API_KEY" ]]; then
  echo "Error: EVOLUTION_API_KEY is required (env or --api-key)" >&2
  echo "Find it in your Evolution dashboard or docker-compose env." >&2
  exit 1
fi

# Validate webhook URL
if [[ "$WEBHOOK_URL" != *"/s/protecta/whatsapp/webhook" ]]; then
  echo "Warning: WEBHOOK_URL should end with /s/protecta/whatsapp/webhook (got $WEBHOOK_URL)" >&2
fi

echo "==> Evolution API: $BASE_URL"
echo "    Instance: $INSTANCE"
echo "    Webhook:  $WEBHOOK_URL"
echo ""

# 1. Check connection state
echo "==> Checking instance connection state..."
curl -sS --max-time 15 \
  -H "apikey: $API_KEY" \
  "$BASE_URL/instance/connectionState/$INSTANCE" | jq . 2>/dev/null || curl -sS --max-time 15 -H "apikey: $API_KEY" "$BASE_URL/instance/connectionState/$INSTANCE" || echo "(no response)"

echo ""
echo "==> Setting webhook..."

# 2. Set webhook (new API format)
# See: https://doc.evolution-api.com/v1/api-reference/webhook/set-webhook
RESPONSE=$(curl -sS --max-time 20 -w "\n%{http_code}" \
  -X POST \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"webhook\": {
      \"enabled\": true,
      \"url\": \"$WEBHOOK_URL\",
      \"byEvents\": false,
      \"base64\": false,
      \"events\": [\"MESSAGES_UPSERT\"]
    }
  }" \
  "$BASE_URL/webhook/set/$INSTANCE" || true)

BODY=$(echo "$RESPONSE" | sed '$d')
CODE=$(echo "$RESPONSE" | tail -n1)

echo "HTTP $CODE"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [[ "$CODE" == "200" || "$CODE" == "201" ]]; then
  echo ""
  echo "==> Webhook set successfully!"
  echo "    Evolution will now POST inbound WhatsApp messages to:"
  echo "    $WEBHOOK_URL"
  echo ""
  echo "    Test: send 'menu' on WhatsApp to the bot number."
  echo "    Check Twenty logs: docker logs -f twenty-app-dev | grep -i whatsapp"
else
  echo ""
  echo "==> Failed to set webhook (HTTP $CODE)"
  echo "    Try also the legacy endpoint /webhook/set (some versions):"
  echo "    curl -X POST -H \"apikey: \$API_KEY\" -H \"Content-Type: application/json\" \\"
  echo "      -d '{\"webhook\":{\"enabled\":true,\"url\":\"$WEBHOOK_URL\",\"byEvents\":false,\"events\":[\"MESSAGES_UPSERT\"]}}' \\"
  echo "      $BASE_URL/webhook/set/$INSTANCE"
  exit 1
fi

# 3. Verify webhook
echo ""
echo "==> Verifying webhook..."
curl -sS --max-time 15 -H "apikey: $API_KEY" "$BASE_URL/webhook/find/$INSTANCE" | jq . 2>/dev/null || curl -sS --max-time 15 -H "apikey: $API_KEY" "$BASE_URL/webhook/find/$INSTANCE" || echo "(no response)"

echo ""
echo "Done."
