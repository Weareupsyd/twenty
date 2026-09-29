#!/usr/bin/env bash
# setup-caddy.sh — configure Caddy reverse proxy for https://protectabode.weareupsyd.com
# Usage:
#   ./scripts/setup-caddy.sh
#   ./scripts/setup-caddy.sh --domain protectabode.weareupsyd.com --port 2020 --email admin@weareupsyd.com
#   DOMAIN=protectabode.weareupsyd.com PORT=2020 EMAIL=admin@weareupsyd.com ./scripts/setup-caddy.sh
#
# This installs Caddy (if missing), writes /etc/caddy/Caddyfile from the template,
# and reloads Caddy. Requires root or sudo.
#
# For Docker mode, use docker-compose.caddy.yml instead:
#   docker compose -f docker-compose.caddy.yml up -d

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${DOMAIN:-protectabode.weareupsyd.com}"
PORT="${PORT:-2020}"
EMAIL="${EMAIL:-admin@weareupsyd.com}"
EVOLUTION_DOMAIN="${EVOLUTION_DOMAIN:-evolution.protectabode.weareupsyd.com}"
WITH_EVOLUTION="${WITH_EVOLUTION:-1}"
CADDYFILE_SRC="$SCRIPT_DIR/Caddyfile"
CADDYFILE_DST="/etc/caddy/Caddyfile"
LOG_DIR="/var/log/caddy"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --email) EMAIL="$2"; shift 2 ;;
    --email=*) EMAIL="${1#*=}"; shift ;;
    --evolution-domain) EVOLUTION_DOMAIN="$2"; shift 2 ;;
    --evolution-domain=*) EVOLUTION_DOMAIN="${1#*=}"; shift ;;
    --without-evolution) WITH_EVOLUTION=0; shift ;;
    --with-evolution) WITH_EVOLUTION=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--domain DOMAIN] [--port PORT] [--email EMAIL] [--evolution-domain DOMAIN] [--without-evolution]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "Error: need root or sudo to configure Caddy" >&2
    exit 1
  fi
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }

ensure_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    info "caddy $(caddy version 2>/dev/null || echo found)"
    return 0
  fi

  step "Installing Caddy"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq caddy
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y 'dnf-command(copr)'
    $SUDO dnf copr enable -y @caddy/caddy
    $SUDO dnf install -y caddy
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y yum-plugin-copr
    $SUDO yum copr enable -y @caddy/caddy
    $SUDO yum install -y caddy
  else
    echo "Error: unsupported package manager, install Caddy manually: https://caddyserver.com/docs/install" >&2
    exit 1
  fi

  command -v caddy >/dev/null 2>&1 || { echo "Caddy install failed" >&2; exit 1; }
  info "caddy installed: $(caddy version)"
}

write_caddyfile() {
  step "Writing Caddyfile for $DOMAIN → localhost:$PORT"

  $SUDO mkdir -p "$(dirname "$CADDYFILE_DST")" "$LOG_DIR"
  $SUDO touch "$LOG_DIR/protectabode.log" "$LOG_DIR/evolution.log" 2>/dev/null || true
  $SUDO chown -R caddy:caddy "$LOG_DIR" 2>/dev/null || $SUDO chown -R www-data:www-data "$LOG_DIR" 2>/dev/null || true

  # Generate Caddyfile from template if exists, else inline
  if [[ -f "$CADDYFILE_SRC" ]]; then
    info "using template $CADDYFILE_SRC"
    $SUDO cp "$CADDYFILE_SRC" "$CADDYFILE_DST.tmp"
  else
    info "template not found, generating inline"
    $SUDO tee "$CADDYFILE_DST.tmp" > /dev/null <<EOF
{
    email $EMAIL
    admin off
}

$DOMAIN {
    # Bare domain and legacy /admin open the public Protecta Bode landing.
    @openHome path / /admin /admin/*
    handle @openHome {
        redir /s/protecta/ permanent
    }
    reverse_proxy localhost:$PORT {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }
    encode gzip
    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
    }
    log {
        output file $LOG_DIR/protectabode.log
        level INFO
    }
}
EOF
  fi

  # Replace placeholders
  $SUDO sed -i "s/protectabode.weareupsyd.com/$DOMAIN/g" "$CADDYFILE_DST.tmp"
  $SUDO sed -i "s/localhost:2020/localhost:$PORT/g" "$CADDYFILE_DST.tmp"
  $SUDO sed -i "s/admin@weareupsyd.com/$EMAIL/g" "$CADDYFILE_DST.tmp"
  $SUDO sed -i "s/evolution.protectabode.weareupsyd.com/$EVOLUTION_DOMAIN/g" "$CADDYFILE_DST.tmp"

  if [[ "$WITH_EVOLUTION" == "0" ]]; then
    # Remove evolution block if not wanted
    $SUDO awk -v dom="$EVOLUTION_DOMAIN" '
      BEGIN { skip=0 }
      $0 ~ dom " \\{" { skip=1; next }
      skip==1 && /^\}/ { skip=0; next }
      skip==0 { print }
    ' "$CADDYFILE_DST.tmp" > "$CADDYFILE_DST.tmp2" && $SUDO mv "$CADDYFILE_DST.tmp2" "$CADDYFILE_DST.tmp"
  fi

  $SUDO mv "$CADDYFILE_DST.tmp" "$CADDYFILE_DST"
  info "wrote $CADDYFILE_DST"
  $SUDO caddy fmt --overwrite "$CADDYFILE_DST" 2>/dev/null || true
}

reload_caddy() {
  step "Reloading Caddy"
  if $SUDO systemctl is-active --quiet caddy 2>/dev/null; then
    $SUDO systemctl reload caddy || $SUDO systemctl restart caddy
    info "caddy reloaded via systemctl"
  elif $SUDO service caddy status >/dev/null 2>&1; then
    $SUDO service caddy reload || $SUDO service caddy restart
    info "caddy reloaded via service"
  else
    $SUDO systemctl enable --now caddy 2>/dev/null || $SUDO service caddy start 2>/dev/null || {
      info "starting caddy manually: caddy run --config $CADDYFILE_DST --adapter caddyfile"
      $SUDO caddy run --config "$CADDYFILE_DST" --adapter caddyfile --watch --environ &
      sleep 2
    }
  fi

  # Test config
  $SUDO caddy validate --config "$CADDYFILE_DST" --adapter caddyfile || {
    echo "Caddyfile validation failed, check $CADDYFILE_DST" >&2
    $SUDO cat "$CADDYFILE_DST"
    exit 1
  }

  info "Caddy is running, testing https://$DOMAIN (may take 30s for TLS)..."
  for i in $(seq 1 15); do
    if curl -fsS --max-time 5 "https://$DOMAIN/healthz" 2>/dev/null | grep -q '"status"'; then
      info "✓ https://$DOMAIN is up (TLS ready)"
      break
    fi
    if curl -fsS --max-time 5 "http://$DOMAIN/healthz" 2>/dev/null | grep -q '"status"'; then
      info "✓ http://$DOMAIN is up (TLS provisioning in background)"
      break
    fi
    sleep 2
  done
}

ensure_caddy
write_caddyfile
reload_caddy

cat <<EOF

==> Caddy configured for $DOMAIN

    Main:      https://$DOMAIN
    Landing:   https://$DOMAIN/s/protecta/
    Root:      https://$DOMAIN/       → redirects to /s/protecta/
    Legacy:    https://$DOMAIN/admin  → redirects to /s/protecta/
    Health:    https://$DOMAIN/s/protecta/health
    Webhook:   https://$DOMAIN/s/protecta/whatsapp/webhook  ← use this in Evolution API
    Evolution: https://$EVOLUTION_DOMAIN (if enabled, localhost:8080)
    Staff:     https://$DOMAIN/welcome (CRM sign-in)

    Logs:      $LOG_DIR/protectabode.log
    Caddyfile: $CADDYFILE_DST

    Next: configure Evolution webhook:
      EVOLUTION_API_KEY=xxx ./scripts/setup-evolution-webhook.sh --webhook https://$DOMAIN/s/protecta/whatsapp/webhook

EOF
