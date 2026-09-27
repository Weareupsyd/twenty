#!/usr/bin/env bash
# =============================================================================
# Protecta Bode platform - universal installer / control script
#
# One script runs everything in Docker: postgres, redis, API, portal (frontend),
# WhatsApp bot, email service, and the Protecta-branded KYC stack.
#
#   ./install.sh              # first-time install + start (default)
#   ./install.sh up           # build + start / rebuild changed services
#   ./install.sh down         # stop everything
#   ./install.sh restart      # restart the stack
#   ./install.sh logs [svc]   # follow logs (all or one service)
#   ./install.sh status       # what is running, on which ports
#   ./install.sh update       # rebuild and restart with the latest code
#   ./install.sh admin        # print the platform admin login
#   ./install.sh caddy        # build/start the optional HTTPS subdomain front door
#
# Ports are deliberately in the 18000 range so the stack can coexist with a
# AgriLink deployment (80/443/8000/8080/3001/3002/8010/8011) on the same host:
#     portal 18080 - API 18000 - KYC wizard 18081
# The installer asks whether to build Caddy for ports 80/443 after the stack
# starts. Say no when AgriLink already owns those ports; route the site there.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# Ports (override in .env)
API_PORT="${API_PORT:-18000}"
PORTAL_PORT="${PORTAL_PORT:-18080}"
KYC_PORT="${KYC_PORT:-18081}"

C="docker compose"

say()  { printf '\033[1;34m[protecta]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# ── helpers ──────────────────────────────────────────────────────────────────
rand_hex() { # $1 = bytes
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else python3 - "$1" <<'PY'
import secrets, sys
print(secrets.token_hex(int(sys.argv[1])))
PY
  fi
}

port_free() { # $1 = port
  # NOTE: never match bare 'grep -q .' against ss output - ss always prints a
  # header line, which would make every port look "in use". Match the
  # Local Address:Port column ($4) against ":$port" at end-of-field instead.
  if command -v ss >/dev/null 2>&1; then ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$1$"
  elif command -v netstat >/dev/null 2>&1; then ! netstat -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$1$"
  else curl -s --max-time 2 -o /dev/null "http://127.0.0.1:$1/" && return 1 || return 0
  fi
}

needs_secret() { # $1=key  true when missing or still a placeholder
  local v
  v="$(grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
  [ -z "$v" ] && return 0
  case "$v" in generate-*|change-me*|""|00000000*) return 0 ;; *) return 1 ;; esac
}

replace_or_append() { # $1=key $2=value
  if grep -qE "^$1=" .env 2>/dev/null; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

gen_secret_pair() {
  needs_secret SECRET_KEY       && replace_or_append SECRET_KEY       "$(rand_hex 32)" || true
  needs_secret INTERNAL_API_KEY && replace_or_append INTERNAL_API_KEY "$(rand_hex 32)" || true
  needs_secret PAYMENT_WEBHOOK_SECRET && replace_or_append PAYMENT_WEBHOOK_SECRET "$(rand_hex 32)" || true
  return 0
}

kyc_enc_key() { # KABILA_ENCRYPTION_KEY must be exactly 32 chars
  needs_secret KABILA_ENCRYPTION_KEY && replace_or_append KABILA_ENCRYPTION_KEY "$(rand_hex 16)" || true
  return 0
}

dedupe_env() { # keep the FIRST occurrence of each KEY= line, drop later dupes
  # install.sh reads keys with 'head -1' (first wins) while docker compose
  # uses last-wins, so duplicate keys make the two disagree (wrong ports,
  # empty URLs). De-duping first-wins keeps both readers in agreement.
  # Self-heals .env files generated from older .env.example revisions too.
  [ -s .env ] || return 0
  awk '/^[A-Za-z_][A-Za-z0-9_]*=/ { k=substr($0,1,index($0,"=")-1); if (seen[k]++) next } { print }' .env > .env.tmp \
    && mv .env.tmp .env
}

check_env() {
  if [ ! -s .env ]; then
    say "No .env found - creating one from .env.example with fresh secrets"
    cp .env.example .env
    dedupe_env
    gen_secret_pair
    kyc_enc_key
    say "Secrets generated (SECRET_KEY, INTERNAL_API_KEY, PAYMENT_WEBHOOK_SECRET, KABILA_ENCRYPTION_KEY)"
  else
    dedupe_env
    gen_secret_pair
    kyc_enc_key
  fi
  # Read just the keys we need (never 'source' .env - user values may contain
  # shell-hostile characters like < > or spaces).
  env_get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"' || true; }
  API_PORT="$(env_get API_PORT)";    API_PORT="${API_PORT:-18000}"
  PORTAL_PORT="$(env_get PORTAL_PORT)"; PORTAL_PORT="${PORTAL_PORT:-18080}"
  KYC_PORT="$(env_get KYC_PORT)";    KYC_PORT="${KYC_PORT:-18081}"
}

check_prereqs() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required ('docker compose'). Update Docker or install the compose plugin."
  docker info >/dev/null 2>&1 || die "Docker daemon is not running (try: sudo systemctl start docker, or start Docker Desktop)."
}

stack_ports() { # host ports published by THIS compose project's running containers
  # MUST always return 0: on a fresh host there are no containers, grep finds
  # nothing and exits 1 - under 'set -euo pipefail' that would silently kill
  # the whole installer at the 'ours="$(stack_ports)"' assignment.
  command -v docker >/dev/null 2>&1 || return 0
  docker ps --filter "label=com.docker.compose.project=protecta-bode" --format '{{.Ports}}' 2>/dev/null \
    | grep -oE ':[0-9]+->' | sed -E 's/[>:-]//g' | sort -u || true
  return 0
}

check_ports() {
  local conflicts=0 ours already_running=0
  ours="$(stack_ports || true)" # a docker hiccup must never abort the installer
  [ -n "$ours" ] && already_running=1
  for p in "$API_PORT" "$PORTAL_PORT" "$KYC_PORT"; do
    if port_free "$p"; then
      say "Port $p is free"
    elif printf '%s\n' "$ours" | grep -qx "$p"; then
      say "Port $p is served by the Protecta Bode stack already - it will be recreated with the current code"
    else
      warn "Port $p is already in use by another program - free it or set a different port in .env (API_PORT / PORTAL_PORT / KYC_PORT)"
      conflicts=1
    fi
  done
  [ "$conflicts" -eq 0 ] || die "Resolve the port conflicts above, then run ./install.sh again"
  if [ "$already_running" -eq 1 ]; then
    say "Stack is already running - recreating containers now (data volumes are kept)"
  fi
  return 0
}

caddy_running() {
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --filter "label=com.docker.compose.project=protecta-bode" \
    --filter "label=com.docker.compose.service=caddy" --filter status=running -q 2>/dev/null \
    | grep -q .
}

check_caddy_ports() {
  local p ours
  ours="$(stack_ports || true)"
  for p in 80 443; do
    if port_free "$p" || printf '%s\n' "$ours" | grep -qx "$p"; then
      say "Caddy port $p is available to this stack"
    else
      warn "Port $p is already owned by another service. Do not start a second Caddy."
      warn "Use the existing front door and route the Protecta Bode site with platform/caddy/Caddyfile."
      return 1
    fi
  done
  return 0
}

start_caddy() {
  local domain
  domain="$(grep -E '^DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"' || true)"
  domain="${domain:-protectabode.weareupsyd.com}"
  if [ "$domain" = "localhost" ] || [ -z "$domain" ]; then
    warn "Set DOMAIN to a real DNS name in .env before enabling HTTPS Caddy."
    return 1
  fi
  if caddy_running; then
    say "Protecta Bode Caddy is already running for $domain"
    return 0
  fi
  check_caddy_ports || return 1
  say "Building the optional Caddy front door for $domain (DNS A record must point to this VPS)"
  if $C --profile https up -d --build caddy; then
    say "Caddy started. It will obtain a TLS certificate once DNS and ports 80/443 are reachable."
    return 0
  fi
  warn "Caddy did not start. The core portal/API/KYC services remain running."
  return 1
}

offer_caddy() {
  local domain answer
  if caddy_running; then
    say "HTTPS front door is active"
    return 0
  fi
  domain="$(grep -E '^DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"' || true)"
  domain="${domain:-protectabode.weareupsyd.com}"
  if [ ! -t 0 ]; then
    say "Non-interactive run: Caddy was not enabled. Run './install.sh caddy' after DNS points to this VPS and ports 80/443 are free."
    return 0
  fi
  printf '\nBuild and start Caddy to serve https://%s on ports 80/443? [y/N] ' "$domain"
  IFS= read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES|Yes) start_caddy || true ;;
    *) say "No - leaving Caddy off. The portal remains available on the direct host ports." ;;
  esac
}

wait_healthy() {
  local tries=0 max=90   # x2s = 3 minutes
  say "Waiting for services to come up (this can take a couple of minutes on first build)..."
  while [ "$tries" -lt "$max" ]; do
    if curl -sf --max-time 2 "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 \
       && curl -sf --max-time 2 -o /dev/null "http://127.0.0.1:$PORTAL_PORT/" 2>/dev/null \
       && curl -sf --max-time 2 -o /dev/null "http://127.0.0.1:$KYC_PORT/kyc/" 2>/dev/null; then
      say "API, portal and KYC wizard are up"
      return 0
    fi
    tries=$((tries + 1)); sleep 2
  done
  warn "Services did not report healthy in time. Check: $C logs --tail=50"
  return 1
}

print_urls() {
  local domain base kyc_base api_docs
  domain="$(grep -E '^DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"' || true)"
  if caddy_running && [ -n "$domain" ] && [ "$domain" != "localhost" ]; then
    base="https://$domain"
    kyc_base="$base/kyc/"
    api_docs="$base/docs"
  else
    base="http://localhost:$PORTAL_PORT"
    kyc_base="http://localhost:$KYC_PORT/kyc/"
    api_docs="http://localhost:$API_PORT/docs"
  fi
  cat <<EOF

  ============================================================
   Protecta Bode platform is running
  ============================================================
   Portal (start here)   $base
   API + Swagger         $api_docs
   KYC wizard            $kyc_base (direct host port redirects to /kyc/)

   Admin login           $(admin_line)

   Payment callback     ${base}/api/v1/payments/webhook/{provider}
   WhatsApp callback    /webhook (requires a public HTTPS Caddy/front-door route)

   Next steps:
     1. Complete KYC setup, then put its generated API key in .env as KYC_API_KEY=... and run ./install.sh restart.
     2. Copy PAYMENT_WEBHOOK_SECRET from .env into provider callback settings; callbacks sign the raw JSON body.
     3. For WhatsApp, set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_VERIFY_TOKEN in .env.
     4. To send real email, set EMAIL_OUTBOX=smtp plus SMTP_USER/SMTP_PASSWORD.
     5. Change the admin password immediately (./install.sh admin shows it).
EOF
  if caddy_running; then
    printf '   HTTPS subdomain      %s (confirm DNS and Caddy TLS status)\n' "$base"
  else
    printf '   HTTPS subdomain      not enabled; run ./install.sh caddy after DNS points here and ports 80/443 are free.\n'
  fi
  cat <<EOF
  ============================================================

EOF
}
admin_line() {
  local pw
  pw="$(grep -E '^ADMIN_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || true)"
  echo "phone +256000000000  password ${pw:-change-me-admin}  (CHANGE IT)"
}

# ── commands ─────────────────────────────────────────────────────────────────
cmd="${1:-up}"

case "$cmd" in
  up|install|start)
    check_prereqs
    check_env
    check_ports
    say "Building and starting the full stack (postgres, redis, email, api, portal, bot, kyc)..."
    if caddy_running; then $C --profile https up -d --build; else $C up -d --build; fi
    wait_healthy || true
    offer_caddy
    print_urls
    ;;
  down|stop)
    check_prereqs
    $C down
    say "Stack stopped (volumes kept - data survives). Use '$C down -v' yourself if you really want to wipe data."
    ;;
  restart)
    check_prereqs
    check_env
    if caddy_running; then $C --profile https restart; else $C restart; fi
    say "Stack restarted"
    ;;
  logs)
    check_prereqs
    svc="${2:-}"
    if [ -n "$svc" ]; then $C logs -f --tail=100 "$svc"; else $C logs -f --tail=60; fi
    ;;
  status|ps)
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then $C ps; else warn "Docker not running - showing host ports only"; fi
    echo
    for p in "$API_PORT" "$PORTAL_PORT" "$KYC_PORT"; do
      if port_free "$p"; then echo "  port $p: down"; else echo "  port $p: serving"; fi
    done
    if caddy_running; then echo "  Caddy HTTPS: running"; else echo "  Caddy HTTPS: not running"; fi
    ;;
  update)
    check_prereqs
    check_env
    say "Rebuilding with the latest code..."
    if caddy_running; then $C --profile https up -d --build; else $C up -d --build; fi
    wait_healthy || true
    offer_caddy
    print_urls
    ;;
  caddy|https)
    check_prereqs
    check_env
    check_ports
    start_caddy || die "Could not start Caddy; see the warning above"
    wait_healthy || true
    print_urls
    ;;
  admin)
    check_env
    admin_line
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
