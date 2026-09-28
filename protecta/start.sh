#!/usr/bin/env bash
#
# Boot the full protecta stack on this machine: a local Twenty server in Docker
# plus the protecta app synced into it.
#
#   ./start.sh            start the server, then sync the app once
#   ./start.sh --watch    same, but keep watching src/ and re-sync on change
#   ./start.sh --port 3000
#
# The app is not a standalone process: it is compiled and synced into a running
# Twenty workspace by the `twenty` CLI. This script just wires those steps up.
#
# Environment:
#   TWENTY_API_KEY   API key for the local workspace. Needed to run unattended;
#                    without it the script falls back to an interactive login.
#   PKG_MANAGER      npm (default) or yarn, to install the app's dependencies.
#   SKIP_INSTALL=1   don't install the app's node_modules
#   SKIP_REMOTE=1    don't (re)authenticate the CLI remote

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
PORT=2020
WATCH=0
REMOTE_NAME="protecta-local"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch|-w) WATCH=1; shift ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

SERVER_URL="http://localhost:$PORT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -d "$APP_DIR" ]] || die "App directory not found: $APP_DIR"

# --- Preflight ---------------------------------------------------------------

step "Checking prerequisites"

command -v node >/dev/null || die "node is not installed. Install Node 24.5+ (within Node 24)."
command -v npm >/dev/null || die "npm is not installed."
command -v curl >/dev/null || die "curl is not installed."

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 5 ? 0 : 1)'; then
  die "Node $(node -v) is unsupported; Twenty SDK 2.43 requires Node 24.5+ within Node 24."
fi
info "node $(node -v)"

command -v docker >/dev/null || die "docker is not installed. Twenty runs as the twentycrm/twenty-app-dev container."
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable. Start it (e.g. 'sudo systemctl start docker')."
info "docker $(docker --version | awk '{print $3}') (daemon up)"

# --- App dependencies --------------------------------------------------------
#
# The build resolves tsc and twenty-client-sdk from the app's own node_modules,
# so this install is mandatory before any sync will work.

if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
  step "Skipping dependency install (SKIP_INSTALL=1)"
else
  step "Installing app dependencies"

  # Reinstall when a manifest changed since the last install, otherwise a
  # package.json edit would be silently ignored on the next run.
  NEEDS_INSTALL=1
  if [[ -x "$APP_DIR/node_modules/.bin/twenty" ]]; then
    NEEDS_INSTALL=0
    for manifest in package.json package-lock.json yarn.lock; do
      if [[ -f "$APP_DIR/$manifest" && "$APP_DIR/$manifest" -nt "$APP_DIR/node_modules/.bin/twenty" ]]; then
        info "$manifest changed since last install"
        NEEDS_INSTALL=1
        break
      fi
    done
  fi

  if (( ! NEEDS_INSTALL )); then
    info "dependencies are up to date, skipping install"
  else
    if [[ -n "${PKG_MANAGER:-}" ]]; then
      MANAGER="$PKG_MANAGER"
    elif [[ -f "$APP_DIR/package-lock.json" ]]; then
      MANAGER="npm"
    else
      MANAGER="yarn"
    fi

    case "$MANAGER" in
      npm)
        command -v npm >/dev/null || die "PKG_MANAGER=npm but npm is missing."
        if [[ -f "$APP_DIR/package-lock.json" ]]; then
          (cd "$APP_DIR" && npm ci --no-audit --no-fund)
        else
          (cd "$APP_DIR" && npm install --no-audit --no-fund)
        fi
        ;;
      yarn)
        command -v yarn >/dev/null || die "PKG_MANAGER=yarn but yarn is missing (try: corepack enable)."
        (cd "$APP_DIR" && yarn install)
        ;;
      *) die "Unsupported PKG_MANAGER: $MANAGER (use npm or yarn)" ;;
    esac
    info "installed with $MANAGER"
  fi
fi

TWENTY="$APP_DIR/node_modules/.bin/twenty"
[[ -x "$TWENTY" ]] || die "The twenty CLI is not installed at $TWENTY. Re-run without SKIP_INSTALL=1."

# --- Twenty server -----------------------------------------------------------
#
# Idempotent: re-running against a healthy server is a no-op. The image version
# is resolved from the app's engines.twenty range, so it matches the app.

step "Starting Twenty server (port $PORT)"

if curl -fsS --max-time 2 "$SERVER_URL/healthz" >/dev/null 2>&1; then
  info "already healthy at $SERVER_URL"
else
  if ! "$TWENTY" docker:start --port "$PORT"; then
    if [[ "$(docker inspect --format '{{.State.Running}}' twenty-app-dev 2>/dev/null || true)" != "true" ]]; then
      die "Twenty did not start. Inspect: docker logs --tail 200 twenty-app-dev"
    fi
    info "CLI startup wait ended, but the container is running; allowing extra time for first-boot seeding."
  fi
fi

# The CLI waits 180s. A fresh database can need longer; wait up to another
# 10 minutes without discarding the running container or its volumes.
info "waiting for $SERVER_URL/healthz"
SERVER_HEALTHY=0
for _ in $(seq 1 300); do
  if curl -fsS --max-time 2 "$SERVER_URL/healthz" 2>/dev/null | grep -qE '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    SERVER_HEALTHY=1
    break
  fi
  sleep 2
done

if (( ! SERVER_HEALTHY )); then
  info "logs: $TWENTY docker:logs -n 100"
  die "the server did not become healthy in time."
fi
info "server is up"

# --- Remote (authentication) -------------------------------------------------
#
# Every sync command needs a configured, authenticated remote. The config lives
# in ~/.twenty/config.json, so this persists between runs.

if [[ "${SKIP_REMOTE:-0}" == "1" ]]; then
  step "Skipping remote setup (SKIP_REMOTE=1)"
elif [[ -n "${TWENTY_API_KEY:-}" ]]; then
  step "Authenticating remote '$REMOTE_NAME'"
  "$TWENTY" remote:add --url "$SERVER_URL" --as "$REMOTE_NAME" --api-key "$TWENTY_API_KEY"
else
  step "Configuring remote '$REMOTE_NAME'"

  if "$TWENTY" remote:use "$REMOTE_NAME" >/dev/null 2>&1 && "$TWENTY" remote:status 2>/dev/null | grep -qE '\(valid\)'; then
    info "existing remote is already authenticated"
  else
    cat <<EOF
    No TWENTY_API_KEY set, so this needs an interactive login.

    In a browser, open $SERVER_URL and sign in as:
        tim@apple.dev / tim@apple.dev
    Then Settings -> API keys -> create a key, and export it:
        export TWENTY_API_KEY='<paste the key here>'

    On a headless box, the OAuth prompt below prints a URL you can open from
    any machine that can reach this server.
EOF
    "$TWENTY" remote:add --url "$SERVER_URL" --as "$REMOTE_NAME"
  fi
fi

# --- Sync the linked apps ----------------------------------------------------
#
# Standalone apps linked to Protecta through workspace events and routes:
# the Document Generator produces policy certificate documents (PDF + Word)
# when policies are issued; the SMS Sender notifies customers on quote,
# policy and claim events through EgoSMS, with per-language templates.

for LINKED_APP in docgen sms; do
  LINKED_DIR="$SCRIPT_DIR/$LINKED_APP/app"

  if [[ -d "$LINKED_DIR" ]]; then
    step "Syncing $LINKED_APP app"
    if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
      info "skipping dependency install (SKIP_INSTALL=1)"
    elif [[ ! -x "$LINKED_DIR/node_modules/.bin/twenty" ]]; then
      (cd "$LINKED_DIR" && npm install --no-audit --no-fund --legacy-peer-deps)
      info "installed with npm"
    else
      info "dependencies are up to date, skipping install"
    fi
    "$TWENTY" apply "$LINKED_DIR"
  fi
done

# --- Sync the app ------------------------------------------------------------
#
# `apply` builds the app and syncs it once. `dev` does the same and then watches
# src/, re-syncing on every change.

if (( WATCH )); then
  step "Syncing app and watching src/ (Ctrl-C to stop watching)"
  "$TWENTY" dev "$APP_DIR"
else
  step "Syncing app into the workspace"
  "$TWENTY" apply "$APP_DIR"
fi

# --- Done --------------------------------------------------------------------

cat <<EOF

$(printf '\033[1;32m==> Ready\033[0m')

    Workspace:  $SERVER_URL
    Login:      tim@apple.dev / tim@apple.dev

    App:        protecta-bode (synced from $APP_DIR)
    Docs app:   Document Generator (synced from $SCRIPT_DIR/docgen/app)
    SMS app:    SMS Sender (synced from $SCRIPT_DIR/sms/app)
    Landing:    $SERVER_URL/s/protecta/
    Documents:  $SERVER_URL/s/docgen/documents/view?policyNo=<policy no>
    SMS API:    POST $SERVER_URL/s/sms/send
    WhatsApp:   Settings → WhatsApp bot (Evolution API)
    Ollama:     ./enable-ollama.sh --pull && ./enable-ollama.sh --apply
    Stop:       $TWENTY docker:stop
    Logs:       $TWENTY docker:logs -f
    Status:     $TWENTY docker:status

    Note: the server is published on all interfaces, so $PORT is reachable
    from other machines once the host firewall allows it.

EOF
