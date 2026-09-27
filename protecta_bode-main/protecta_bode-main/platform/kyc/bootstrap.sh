#!/usr/bin/env bash
# Bootstrap the vendored Kabila verification stack for AgriLink.
#
# Runs the stack's own first-run setup (POST /api/setup/initialize) to create
# the single service developer + API key, then prints the key. Idempotent:
# once a developer exists the setup endpoint refuses (403) and we instead
# report the already-configured key from $KABILA_API_KEY if present.
#
# Usage (from the repo root, after `docker compose up -d kyc-api`):
#   KABILA_API_KEY=... ./kyc-stack/bootstrap.sh      # sets/verifies the key
# or:
#   docker compose exec api ./kyc-stack/bootstrap-not-needed
# The normal path is start.sh, which calls this automatically.
set -euo pipefail

API_BASE="${KABILA_API_URL:-http://localhost:3001}"
NAME="${KABILA_SETUP_NAME:-AgriLink Service}"
EMAIL="${KABILA_SETUP_EMAIL:-service@agrilink.ug}"
COMPANY="${KABILA_SETUP_COMPANY:-AgriLink Uganda}"

echo "-> Waiting for the verification API at ${API_BASE} …"
for i in $(seq 1 60); do
  if curl --max-time 7 -fsS "${API_BASE}/api/health/ready" >/dev/null 2>&1; then break; fi
  sleep 3
  if [ "$i" = "60" ]; then
    echo " verification API did not become healthy in time" >&2
    exit 1
  fi
done

if [ -n "${KABILA_API_KEY:-}" ]; then
  echo "-> KABILA_API_KEY is set - verifying it works …"
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-API-Key: ${KABILA_API_KEY}" \
    "${API_BASE}/api/v2/verify/initialize" -X POST \
    -H "Content-Type: application/json" \
    -d '{"user_id":"agrilink-healthcheck","document_type":"national_id","issuing_country":"UG","addons":{"aml_screening":false}}' || true)
  # Only a successful verification initialization proves the key works.
  # A 5xx, timeout, or validation error must not be reported as accepted.
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    echo " the configured KABILA_API_KEY was rejected (HTTP $code)." >&2
    echo "  Clear it and re-run bootstrap to mint a fresh key." >&2
    exit 1
  fi
  case "$code" in
    2??) echo " KABILA_API_KEY accepted (HTTP $code)." ;;
    *) echo " verification service probe failed (HTTP $code); key was not verified." >&2; exit 1 ;;
  esac
  exit 0
fi

echo "-> No API key configured yet - creating the service developer + key …"
resp=$(curl -sS -X POST "${API_BASE}/api/setup/initialize" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${NAME}\",\"email\":\"${EMAIL}\",\"company\":\"${COMPANY}\"}" || true)

key=$(printf '%s' "$resp" | sed -n 's/.*"api_key":{"key":"\([^"]*\)".*/\1/p')
if [ -z "$key" ]; then
  if printf '%s' "$resp" | grep -qi "already completed"; then
    echo "! Setup already completed and no KABILA_API_KEY was provided."
    echo "  Create a key in the developer console or set KABILA_API_KEY to the"
    echo "  existing ik_… key, then re-run."
    exit 0
  fi
  echo " Could not mint an API key. Response was:" >&2
  echo "$resp" >&2
  exit 1
fi

echo ""
echo " Verification stack bootstrapped."
echo ""
echo "  Add this to the repo root .env (it is the key AgriLink's api uses):"
echo ""
echo "  KYC_API_KEY=${key}"
echo ""
