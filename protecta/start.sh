#!/usr/bin/env bash
#
# Boot the full protecta stack on this machine: a local Twenty server in Docker
# plus the protecta app synced into it.
#
#   ./start.sh                start the server, then sync the app once
#   ./start.sh --watch        same, but keep watching src/ and re-sync on change
#   ./start.sh --port 3000
#   ./start.sh --new-api-key  mint a fresh workspace API key in the container first
#   ./start.sh --reseed       re-run the dev seed in the container, then sync
#
# The app is not a standalone process: it is compiled and synced into a running
# Twenty workspace by the `twenty` CLI. This script just wires those steps up.
#
# The dev image seeds the "Apple" workspace (tim@apple.dev) on first boot. That
# seed can outlast the CLI's three-minute watch and be reported as "Failed"
# while it is merely slow. When it really did not finish, the container comes up
# healthy but without a workspace, and every API key is then rejected with
# "You must be authenticated". This script detects that state and re-runs the
# seed before it tries to mint a key.
#
# Environment:
#   TWENTY_API_KEY        API key for the local workspace. Without it the script
#                         reuses .twenty-api-key, mints a key in the running
#                         container (./create-api-key.sh), or falls back to an
#                         interactive login when a terminal is attached.
#   TWENTY_API_KEY_FILE   key file to read/write (default: <script dir>/.twenty-api-key)
#   TWENTY_CONTAINER      container name (default: twenty-app-dev)
#   SEED_REPAIR=0         never re-run the dev seed, only report the state
#   PKG_MANAGER           npm (default) or yarn, to install the app's dependencies.
#   SKIP_INSTALL=1        don't install the app's node_modules
#   SKIP_REMOTE=1         don't (re)authenticate the CLI remote
#   SKIP_NODE_BOOTSTRAP=1 don't re-run under Node 24 via npx on old system Node

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
PORT=2020
WATCH=0
REMOTE_NAME="protecta-local"
REMOTE_NAME="${TWENTY_REMOTE_NAME:-$REMOTE_NAME}"
KEY_FILE="${TWENTY_API_KEY_FILE:-$SCRIPT_DIR/.twenty-api-key}"
CREATE_KEY_SCRIPT="$SCRIPT_DIR/create-api-key.sh"
NEW_API_KEY=0
RESEED=0
REPAIR_SEED="${SEED_REPAIR:-1}"
CONTAINER="${TWENTY_CONTAINER:-twenty-app-dev}"
ORIGINAL_ARGS=("$@")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch|-w) WATCH=1; shift ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --new-api-key) NEW_API_KEY=1; shift ;;
    --reseed) RESEED=1; shift ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

SERVER_URL="http://localhost:$PORT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    \033[1;33m%s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

with_timeout() {
  if [[ -n "${TIMEOUT_BIN:-}" ]]; then "$TIMEOUT_BIN" 120 "$@"; else "$@"; fi
}

[[ -d "$APP_DIR" ]] || die "App directory not found: $APP_DIR"

# --- API key probing ---------------------------------------------------------
#
# Same request the `twenty` CLI uses to validate a remote. Sets PROBE_STATE
# (ok|rejected|forbidden|unreachable|unexpected), PROBE_DETAIL and PROBE_FOR_WS.

PROBE_STATE=""
PROBE_DETAIL=""
PROBE_FOR_WS=""

probe_api_key() {
  local url="$1" key="$2" body status code

  PROBE_STATE="unreachable"
  PROBE_DETAIL=""
  PROBE_FOR_WS=""

  body="$(mktemp)"
  if ! status="$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' \
      -X POST "${url%/}/metadata" \
      -H "Authorization: Bearer ${key}" \
      -H 'Content-Type: application/json' \
      -H 'Accept: */*' \
      -d '{"query":"query ProtectaKeyCheck { currentWorkspace { id displayName } }"}' \
      2>/dev/null)"; then
    rm -f "$body"
    return 3
  fi

  # One JSON line in, one value out; no `head`, which would trip pipefail.
  PROBE_FOR_WS="$(sed -n 's/.*"displayName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$body")"
  PROBE_FOR_WS="${PROBE_FOR_WS%%$'\n'*}"
  if [[ -z "$PROBE_FOR_WS" ]]; then
    PROBE_FOR_WS="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$body")"
    PROBE_FOR_WS="${PROBE_FOR_WS%%$'\n'*}"
  fi

  code="$(sed -n 's/.*"code"[[:space:]]*:[[:space:]]*"\([A-Z_]*\)".*/\1/p' "$body")"
  code="${code%%$'\n'*}"
  PROBE_DETAIL="$(sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$body")"
  PROBE_DETAIL="${PROBE_DETAIL%%$'\n'*}"
  if [[ -z "$PROBE_DETAIL" ]]; then
    PROBE_DETAIL="HTTP ${status}"
  elif [[ -n "$code" ]]; then
    PROBE_DETAIL="${PROBE_DETAIL} (${code}, HTTP ${status})"
  fi

  if [[ "$status" == "200" ]] && grep -q '"currentWorkspace"' "$body" && ! grep -q '"errors"' "$body"; then
    rm -f "$body"
    PROBE_STATE="ok"
    return 0
  fi
  rm -f "$body"

  case "${code}:${status}" in
    FORBIDDEN:*|*:403) PROBE_STATE="forbidden"; return 2 ;;
    UNAUTHENTICATED:*|*:401) PROBE_STATE="rejected"; return 1 ;;
  esac

  PROBE_STATE="unexpected"
  return 4
}

describe_probe_failure() {
  local key_source="$1"

  case "$PROBE_STATE" in
    rejected)
      cat >&2 <<EOF

  The server rejected that key: ${PROBE_DETAIL}

  A Twenty API key only works on the instance that issued it. Usual causes:
    1. the key was created on a different Twenty (cloud, another VPS, another port);
    2. the key was created in another workspace of this instance;
    3. the key was revoked or expired, or pasted incompletely.

EOF
      ;;
    forbidden)
      cat >&2 <<EOF

  The key is valid but lacks permissions: ${PROBE_DETAIL}

  Create it with a role that can manage applications and API keys (Admin).

EOF
      ;;
    unreachable)
      cat >&2 <<EOF

  Could not reach ${SERVER_URL}/metadata. Is the Twenty server running?

EOF
      ;;
    *)
      cat >&2 <<EOF

  Unexpected answer from ${SERVER_URL}/metadata: ${PROBE_DETAIL}

EOF
      ;;
  esac

  if [[ -n "$key_source" ]]; then
    info "key source: $key_source"
  fi
  return 0
}

# Create an API key inside the local container (no browser needed). On success
# TWENTY_API_KEY holds the new token.
mint_api_key() {
  local created

  [[ -f "$CREATE_KEY_SCRIPT" ]] || return 1

  # It prints the token on stdout and its progress on stderr, which stays
  # visible so a failure explains itself.
  if ! created="$(bash "$CREATE_KEY_SCRIPT" --stdout)"; then
    return 1
  fi
  created="$(printf '%s\n' "$created" | tail -n 1)"
  [[ -n "$created" ]] || return 1

  TWENTY_API_KEY="$created"
  KEY_SOURCE="newly created key ($KEY_FILE)"

  # Keep it for the next run. create-api-key.sh saves too; this also covers a
  # helper invoked with a different --key-file.
  if (umask 077; printf '%s\n' "$TWENTY_API_KEY" > "$KEY_FILE") 2>/dev/null; then
    chmod 600 "$KEY_FILE" 2>/dev/null || true
  fi

  return 0
}

# --- Workspace (seed) state --------------------------------------------------
#
# An API key only authenticates when the workspace and the workspace member it
# names exist in the database. On a first boot those rows come from the dev
# seed, which the container runs while the Twenty CLI is still watching it: the
# CLI gives up after three minutes and prints "Seeding workspace data... Failed"
# even when the seed is still running. If it never finishes, the container is
# healthy but holds no usable workspace, and every key is rejected with
# "You must be authenticated" — so the key is not the problem, the workspace is.

DEV_WORKSPACE_ID="20202020-1c25-4d02-bf25-6aeccf7ea419"
SEED_COMMAND="yarn command:prod workspace:seed:dev --light"

# Runs one SQL statement inside the container; rows come back '|'-separated.
# Empty output means the query (or the container) failed.
container_sql() {
  docker exec -e PGPASSWORD=twenty -w /app/packages/twenty-server "$CONTAINER" \
    sh -c 'psql -h localhost -U twenty -d default -tA -F "|" -c "$1"' _ "$1" 2>/dev/null || true
}

# The workspace a key was issued for, read from the (unverified) JWT payload.
# Prints nothing when the key is not a decodable JWT.
key_workspace_id() {
  local key="$1" payload="" decoded=""

  command -v base64 >/dev/null 2>&1 || return 1
  [[ "$key" == *.*.* ]] || return 1

  payload="${key#*.}"
  payload="${payload%%.*}"
  payload="${payload//-/+}"
  payload="${payload//_//}"
  case $(( ${#payload} % 4 )) in
    2) payload="${payload}==" ;;
    3) payload="${payload}=" ;;
    1) return 1 ;;
  esac

  decoded="$(printf '%s' "$payload" | base64 -d 2>/dev/null)" || return 1
  # One value out of one line, without `head`, which would trip pipefail.
  decoded="$(sed -n 's/.*"workspaceId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$decoded")"
  [[ -n "$decoded" ]] || return 1

  printf '%s\n' "${decoded%%$'\n'*}"
  return 0
}

# Where the container's workspaces stand. Sets:
#   SEED_STATE    ok | pending | partial | absent | unknown
#   SEED_DETAIL   one line describing it
#   WORKSPACE_ROWS  "meta|<count>|..." and "row|<id>|<name>|<status>|<schema>"
SEED_STATE="unknown"
SEED_DETAIL=""
WORKSPACE_ROWS=""

read_seed_state() {
  local line id name status schema members rows

  SEED_STATE="unknown"
  SEED_DETAIL=""
  WORKSPACE_ROWS=""
  rows="$(container_sql "SELECT 'meta', count(*)::text, '', '', '' FROM core.workspace WHERE \"deletedAt\" IS NULL UNION ALL SELECT 'row', id, coalesce(\"displayName\", ''), \"activationStatus\", coalesce(\"databaseSchema\", '') FROM core.workspace WHERE \"deletedAt\" IS NULL ORDER BY 1, 2")"

  if [[ -z "$rows" ]]; then
    SEED_DETAIL="could not read core.workspace inside '$CONTAINER'"
    return 0
  fi

  # One workspace per line: the marker line is dropped and the 'row' tag
  # stripped, so a plain id|name|... answer works just as well.
  WORKSPACE_ROWS="$(sed -e '/^meta|/d' -e 's/^row|//' <<<"$rows")"

  if [[ -z "$WORKSPACE_ROWS" ]]; then
    SEED_STATE="absent"
    SEED_DETAIL="no workspace was ever created in '$CONTAINER'"
    return 0
  fi

  line="$(grep -m1 "^${DEV_WORKSPACE_ID}|" <<<"$WORKSPACE_ROWS" || true)"
  [[ -n "$line" ]] || line="$(sed -n 1p <<<"$WORKSPACE_ROWS")"
  IFS='|' read -r id name status schema <<<"$line"

  if [[ -z "$status" ]]; then
    SEED_DETAIL="the workspace list could not be read completely"
  elif [[ "$status" != "ACTIVE" ]]; then
    SEED_STATE="pending"
    SEED_DETAIL="workspace ${name:-$id} is still in $status: the first-boot seed never finished"
  else
    members=""
    if [[ -n "$schema" ]]; then
      members="$(container_sql "SELECT count(*) FROM \"$schema\".\"workspaceMember\" WHERE \"deletedAt\" IS NULL")"
    fi
    if [[ -z "$members" ]]; then
      SEED_DETAIL="workspace ${name:-$id} is active but its members could not be counted"
    elif (( members == 0 )); then
      SEED_STATE="partial"
      SEED_DETAIL="workspace ${name:-$id} is active but holds no members"
    else
      SEED_STATE="ok"
      SEED_DETAIL="workspace ${name:-$id} is active with $members member(s)"
    fi
  fi

  return 0
}

# True only for the states that a re-run of the seed can repair.
seed_is_broken() {
  [[ "$SEED_STATE" == "absent" || "$SEED_STATE" == "pending" || "$SEED_STATE" == "partial" ]]
}

# Lists the container's workspaces and the seed verdict. Used to explain a
# rejected key before deciding whether to repair or to stop.
explain_key_context() {
  local key="$1" id name status schema wanted

  wanted="$(key_workspace_id "$key" || true)"
  if [[ -n "$wanted" ]]; then
    info "the key was issued for workspace $wanted"
  fi

  read_seed_state
  if [[ -n "$WORKSPACE_ROWS" ]]; then
    info "container '$CONTAINER' reports:"
    while IFS='|' read -r id name status schema; do
      [[ -n "$id" ]] || continue
      info "  - ${name:-$id}  ${status:-unknown}"
    done <<<"$WORKSPACE_ROWS"
  fi
  info "seed: $SEED_DETAIL"
  return 0
}

# Re-runs the dev seed inside the container. The seeder logs its own errors and
# still exits 0, so the result is decided by re-reading the state afterwards.
repair_seed() {
  local log

  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" == "true" ]] || {
    warn "container '$CONTAINER' is not running, cannot re-seed"
    return 1
  }

  log="$(mktemp)"
  step "Re-seeding the workspace in '$CONTAINER'"
  info "the first-boot seed did not finish; running it again (this can take minutes)"

  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" 1800 docker exec -w /app/packages/twenty-server "$CONTAINER" \
      sh -c "$SEED_COMMAND" >"$log" 2>&1 || true
  else
    docker exec -w /app/packages/twenty-server "$CONTAINER" \
      sh -c "$SEED_COMMAND" >"$log" 2>&1 || true
  fi

  if grep -qiE '(^|[^a-z])error' "$log"; then
    info "the seeder reported:"
    grep -iE '(^|[^a-z])error' "$log" | tail -n 3 | sed 's/^/        /'
  fi

  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" 120 docker exec -w /app/packages/twenty-server "$CONTAINER" \
      sh -c 'yarn command:prod cache:flush' >/dev/null 2>&1 || true
  fi

  read_seed_state
  if ! seed_is_broken; then
    info "the workspace is in place now: $SEED_DETAIL"
    rm -f "$log"
    return 0
  fi

  warn "$SEED_DETAIL"
  info "last lines of the seed:"
  tail -n 20 "$log" | sed 's/^/        /'
  rm -f "$log"
  return 1
}

# A key can only be minted for a workspace that exists and finished seeding.
ensure_seed_for_key() {
  read_seed_state
  seed_is_broken || return 0

  if [[ "$REPAIR_SEED" != "1" ]]; then
    warn "$SEED_DETAIL (SEED_REPAIR=0, not re-seeding)"
    return 0
  fi

  info "$SEED_DETAIL"
  repair_seed || warn "the dev seed still looks incomplete; the next step may fail"
  return 0
}

# --- Preflight ---------------------------------------------------------------

step "Checking prerequisites"

TIMEOUT_BIN=""
command -v timeout >/dev/null && TIMEOUT_BIN="timeout"

command -v node >/dev/null || die "node is not installed. Install Node 24.5+ (within Node 24)."
command -v npm >/dev/null || die "npm is not installed."
command -v curl >/dev/null || die "curl is not installed."

node_is_supported() {
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 5 ? 0 : 1)'
}

if ! node_is_supported; then
  # System Node is usually older than what the Twenty SDK needs. Rather than
  # asking the operator to remember a wrapper, re-run this script under the
  # Node 24 npx ships (cached after the first run).
  if [[ "${PROTECTA_NODE_BOOTSTRAPPED:-0}" == "1" ]]; then
    die "Node $(node -v) is unsupported and the Node 24 bootstrap did not take effect. Install Node 24.5+ or run: npx --yes --package=node@24 -- bash ./start.sh"
  fi

  if [[ "${SKIP_NODE_BOOTSTRAP:-0}" == "1" ]] || ! command -v npx >/dev/null; then
    die "Node $(node -v) is unsupported; Twenty SDK 2.43 requires Node 24.5+ within Node 24.
  Run it with Node 24 (no install needed):
    npx --yes --package=node@24 -- bash ./start.sh
  or install Node 24, e.g. with nvm: nvm install 24 && nvm use 24"
  fi

  info "system Node $(node -v) is too old for the Twenty SDK"
  info "re-running this script under Node 24 (npx, downloaded once)"
  export PROTECTA_NODE_BOOTSTRAPPED=1
  exec npx --yes --package=node@24 -- bash "$SCRIPT_DIR/start.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
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
    if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" != "true" ]]; then
      die "Twenty did not start. Inspect: docker logs --tail 200 $CONTAINER"
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
#
# API keys are resolved in this order:
#   1. TWENTY_API_KEY from the environment (--new-api-key forces a fresh one),
#   2. .twenty-api-key written by ./create-api-key.sh,
#   3. a key minted inside the local container,
#   4. an already authenticated remote,
#   5. an interactive login, when a terminal is attached.

KEY_SOURCE=""

if [[ "${SKIP_REMOTE:-0}" == "1" ]]; then
  step "Skipping remote setup (SKIP_REMOTE=1)"
else
  if [[ -n "${TWENTY_API_KEY:-}" ]]; then
    KEY_SOURCE="\$TWENTY_API_KEY"
  elif [[ -s "$KEY_FILE" ]]; then
    TWENTY_API_KEY="$(tr -d '\r\n' < "$KEY_FILE" || true)"
    if [[ -n "$TWENTY_API_KEY" ]]; then
      KEY_SOURCE="$KEY_FILE"
    fi
  fi

  if (( RESEED )); then
    repair_seed || die "The dev seed did not produce a usable workspace.
  Inspect the seed output: docker logs --tail 300 $CONTAINER
  Then re-run: ./start.sh --reseed"
  fi

  NEED_KEY=$NEW_API_KEY
  if (( NEW_API_KEY )); then
    KEY_SOURCE="--new-api-key"
  elif [[ -n "$KEY_SOURCE" ]]; then
    step "Checking the workspace API key"
    if probe_api_key "$SERVER_URL" "$TWENTY_API_KEY"; then
      info "the server accepted it (workspace: ${PROBE_FOR_WS:-unknown})"
    else
      info "not accepted: ${PROBE_DETAIL}"
      if [[ "$KEY_SOURCE" == "$KEY_FILE" ]]; then
        info "the saved key is no longer valid; creating a new one"
        NEED_KEY=1
      else
        # The key may be fine and the workspace missing: the first-boot seed is
        # the usual culprit, because the CLI reports it as failed long before it
        # has finished. Look at the container before blaming the key.
        explain_key_context "$TWENTY_API_KEY"
        if seed_is_broken && [[ "$REPAIR_SEED" == "1" ]]; then
          info "the key cannot work yet: $SEED_DETAIL"
          if repair_seed; then
            info "minting a key for the repaired workspace"
            NEED_KEY=1
          fi
        fi

        if (( ! NEED_KEY )); then
          describe_probe_failure "$KEY_SOURCE"
          die "TWENTY_API_KEY was rejected by $SERVER_URL. No OAuth prompt was started on purpose.
  Fix without a browser:  ./start.sh --new-api-key
  Repair a failed first-boot seed: ./start.sh --reseed
  Or install a key from this instance: ./create-api-key.sh && ./start.sh
  To test an existing key:             ./create-api-key.sh --check"
        fi
      fi
    fi
  fi

  if (( NEED_KEY )); then
    ensure_seed_for_key
    step "Creating an API key in the local container"
    if ! mint_api_key; then
      die "Could not create an API key automatically. Run ./create-api-key.sh for details, or create one in
  Settings -> API keys of $SERVER_URL and export it as TWENTY_API_KEY."
    fi
    # create-api-key.sh verifies too; this keeps the workspace name in the log.
    if probe_api_key "$SERVER_URL" "$TWENTY_API_KEY"; then
      info "created and verified (workspace: ${PROBE_FOR_WS:-unknown})"
    else
      describe_probe_failure "$KEY_SOURCE"
      die "The newly created key was not accepted by $SERVER_URL."
    fi
  fi

  if [[ -n "$KEY_SOURCE" ]]; then
    step "Authenticating remote '$REMOTE_NAME'"
    "$TWENTY" remote:add --url "$SERVER_URL" --as "$REMOTE_NAME" --api-key "$TWENTY_API_KEY"
  else
    step "Configuring remote '$REMOTE_NAME'"

    # stdout is a pipe here, so the CLI cannot prompt for a 120s OAuth flow.
    if with_timeout "$TWENTY" remote:use "$REMOTE_NAME" >/dev/null 2>&1 \
      && with_timeout "$TWENTY" remote:status </dev/null 2>/dev/null | grep -qE '\(valid\)'; then
      info "existing remote is already authenticated"
    elif ensure_seed_for_key && mint_api_key; then
      info "no API key found; created one in the local container"
      "$TWENTY" remote:add --url "$SERVER_URL" --as "$REMOTE_NAME" --api-key "$TWENTY_API_KEY"
    elif [[ -t 0 && -t 1 ]]; then
      cat <<EOF
    No API key found, so this needs an interactive login.

    In a browser, open $SERVER_URL and sign in as:
        tim@apple.dev / tim@apple.dev
    Then Settings -> API keys -> create a key, and export it:
        export TWENTY_API_KEY='<paste the key here>'

    On a headless box, the OAuth prompt below prints a URL you can open from
    any machine that can reach this server.
EOF
      "$TWENTY" remote:add --url "$SERVER_URL" --as "$REMOTE_NAME"
    else
      die "No API key and no terminal to authenticate interactively.
  Create the key from this machine instead of a browser: ./create-api-key.sh
  then re-run: ./start.sh
  Already have a key? export TWENTY_API_KEY='<key>' (or write it to $KEY_FILE)"
    fi
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
    API key:    ./create-api-key.sh (mint) / ./start.sh --new-api-key (rotate)
    Reseed:     ./start.sh --reseed (when the first-boot seed never finished)
    One app:    ./twenty.sh app | docgen | sms (install, then apply just that app)
    Stop:       $TWENTY docker:stop
    Logs:       $TWENTY docker:logs -f
    Status:     $TWENTY docker:status

    Note: the server is published on all interfaces, so $PORT is reachable
    from other machines once the host firewall allows it.

EOF
