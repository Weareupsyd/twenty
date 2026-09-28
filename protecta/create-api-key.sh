#!/usr/bin/env bash
#
# Create a Twenty API key for the workspace running inside the local
# twenty-app-dev container, without opening a browser.
#
#   ./create-api-key.sh                     mint a key and explain how to use it
#   ./create-api-key.sh --check             test $TWENTY_API_KEY / .twenty-api-key
#   ./create-api-key.sh --list              list the workspaces in the container
#   ./create-api-key.sh --workspace-id <u>  pick a workspace explicitly
#   ./create-api-key.sh --stdout            print only the token (for scripts)
#
# Why this exists: on a headless VPS the interactive login prints a
# http://localhost:2020/authorize... URL that the operator's browser cannot
# reach, and Settings -> API keys needs a browser too. The dev image ships the
# server CLI, so the key can be minted inside the container instead.
#
# The token is written to .twenty-api-key (chmod 600, git-ignored) unless
# --no-save is given; start.sh picks that file up automatically.
#
# Environment:
#   TWENTY_CONTAINER     container name (default: twenty-app-dev)
#   TWENTY_SERVER_URL    server URL (default: http://localhost:$NODE_PORT of it)
#   TWENTY_API_KEY       key to test with --check
#   TWENTY_API_KEY_FILE  key file (default: <script dir>/.twenty-api-key)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${TWENTY_CONTAINER:-twenty-app-dev}"
KEY_FILE="${TWENTY_API_KEY_FILE:-$SCRIPT_DIR/.twenty-api-key}"
KEY_NAME="protecta-cli"
EXPIRES_IN=""
WORKSPACE_ID=""
SERVER_URL="${TWENTY_SERVER_URL:-}"
MODE="create"
SAVE=1
TOKEN_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--verify) MODE="check"; shift ;;
    --list) MODE="list"; shift ;;
    --workspace-id) WORKSPACE_ID="${2:?--workspace-id needs a value}"; shift 2 ;;
    --workspace-id=*) WORKSPACE_ID="${1#*=}"; shift ;;
    --name) KEY_NAME="${2:?--name needs a value}"; shift 2 ;;
    --name=*) KEY_NAME="${1#*=}"; shift ;;
    --expires-in) EXPIRES_IN="${2:?--expires-in needs a value}"; shift 2 ;;
    --expires-in=*) EXPIRES_IN="${1#*=}"; shift ;;
    --container) CONTAINER="${2:?--container needs a value}"; shift 2 ;;
    --container=*) CONTAINER="${1#*=}"; shift ;;
    --url) SERVER_URL="${2:?--url needs a value}"; shift 2 ;;
    --url=*) SERVER_URL="${1#*=}"; shift ;;
    --port) SERVER_URL="http://localhost:${2:?--port needs a value}"; shift 2 ;;
    --port=*) SERVER_URL="http://localhost:${1#*=}"; shift ;;
    --key-file) KEY_FILE="${2:?--key-file needs a value}"; shift 2 ;;
    --key-file=*) KEY_FILE="${1#*=}"; shift ;;
    --no-save) SAVE=0; shift ;;
    --stdout) TOKEN_ONLY=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# Human-facing output goes to stderr in --stdout mode, so that stdout carries
# the token and nothing else.
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*" >&2; }
info() { printf '    %s\n' "$*" >&2; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# API key probe
#
# Sends the same request the `twenty` CLI uses to validate a remote
# (POST /metadata -> currentWorkspace). Sets:
#   PROBE_STATE   ok | rejected | forbidden | unreachable | unexpected
#   PROBE_DETAIL  short server message, safe to print (never the key)
#   PROBE_FOR_WS  workspace the key belongs to
# ---------------------------------------------------------------------------
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

  # One JSON line in, one value out; no `head` because early-exiting readers
  # trip over `set -o pipefail`.
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

explain_probe_failure() {
  local key_origin="$1"

  case "$PROBE_STATE" in
    rejected)
      cat >&2 <<EOF

  The server rejected the key: ${PROBE_DETAIL}

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

  if [[ -n "$key_origin" ]]; then
    info "key source: $key_origin"
  fi
}

# ---------------------------------------------------------------------------
# In-container helpers
# ---------------------------------------------------------------------------

resolve_server_url() {
  local port

  if [[ -n "$SERVER_URL" ]]; then
    return 0
  fi

  port="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null \
    | sed -n 's/^NODE_PORT=\([0-9][0-9]*\)$/\1/p' | head -n 1)"
  SERVER_URL="http://localhost:${port:-2020}"
}

container_state() {
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo "missing"
}

list_workspaces() {
  docker exec -e PGPASSWORD=twenty "$CONTAINER" sh -c \
    'psql -h localhost -U twenty -d default -tAc "$1"' _ \
    "SELECT id, coalesce(\"displayName\", '') FROM core.workspace WHERE \"deletedAt\" IS NULL ORDER BY \"createdAt\"" \
    2>/dev/null
}

# The all-in-one dev image seeds this workspace on first boot.
DEV_WORKSPACE_ID="20202020-1c25-4d02-bf25-6aeccf7ea419"

resolve_workspace_id() {
  local rows n

  if [[ -n "$WORKSPACE_ID" ]]; then
    return 0
  fi

  rows="$(list_workspaces || true)"
  if [[ -z "$rows" ]]; then
    die "Could not read the workspace list from '$CONTAINER'. Check: docker logs --tail 200 $CONTAINER"
  fi

  if grep -q "^${DEV_WORKSPACE_ID}|" <<<"$rows"; then
    WORKSPACE_ID="$DEV_WORKSPACE_ID"
    return 0
  fi

  n="$(grep -c . <<<"$rows" || true)"
  if [[ "$n" == "1" ]]; then
    WORKSPACE_ID="${rows%%|*}"
    return 0
  fi

  {
    printf '\n'
    printf "  '%s' holds more than one workspace. Pick one with --workspace-id:\n\n" "$CONTAINER"
    while IFS='|' read -r id name; do
      [[ -n "$id" ]] || continue
      printf '    %s  %s\n' "$id" "${name:-(no name)}"
    done <<<"$rows"
    printf '\n'
  } >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

if [[ "$MODE" == "list" ]]; then
  command -v docker >/dev/null || die "docker is not installed."
  if [[ "$(container_state)" != "true" ]]; then
    die "Container '$CONTAINER' is not running. Start Twenty first (./start.sh)."
  fi
  step "Workspaces in '$CONTAINER'"
  rows="$(list_workspaces || true)"
  if [[ -z "$rows" ]]; then
    die "No workspaces found. The server may still be seeding; check docker logs --tail 200 $CONTAINER"
  fi
  while IFS='|' read -r id name; do
    [[ -n "$id" ]] || continue
    info "${name:-(no name)}  $id"
  done <<<"$rows"
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  command -v docker >/dev/null || die "docker is not installed."
  if [[ "$(container_state)" != "true" ]]; then
    die "Container '$CONTAINER' is not running. Start Twenty first (./start.sh)."
  fi
  resolve_server_url
  info "container '$CONTAINER' is running; server: $SERVER_URL"

  KEY="${TWENTY_API_KEY:-}"
  KEY_ORIGIN="\$TWENTY_API_KEY"
  if [[ -z "$KEY" && -f "$KEY_FILE" ]]; then
    KEY="$(tr -d '\r\n' < "$KEY_FILE")"
    KEY_ORIGIN="$KEY_FILE"
  fi
  [[ -n "$KEY" ]] || die "No key to check: export TWENTY_API_KEY or create $KEY_FILE (./create-api-key.sh)."

  step "Checking the key against $SERVER_URL"
  if probe_api_key "$SERVER_URL" "$KEY"; then
    info "the server accepted it (HTTP 200)"
    info "workspace: ${PROBE_FOR_WS:-(unknown)}"
    info "source:    $KEY_ORIGIN"
    printf '\n\033[1;32m==> Key is usable with the twenty CLI\033[0m\n' >&2
    exit 0
  fi

  explain_probe_failure "$KEY_ORIGIN"
  printf '\n\033[1;31m==> Key is not usable (%s)\033[0m\n' "$PROBE_STATE" >&2
  exit 1
fi

# --- create -----------------------------------------------------------------

command -v docker >/dev/null || die "docker is not installed."
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable."

step "Checking the Twenty container"
case "$(container_state)" in
  true) info "'$CONTAINER' is running" ;;
  false) die "Container '$CONTAINER' exists but is stopped. Start it: docker start $CONTAINER (or ./start.sh)." ;;
  *) die "Container '$CONTAINER' not found. Run ./start.sh once, or pass --container <name>." ;;
esac

resolve_server_url
if ! curl -fsS --max-time 5 "${SERVER_URL%/}/healthz" >/dev/null 2>&1; then
  die "Twenty is not healthy at $SERVER_URL. Check: docker logs --tail 200 $CONTAINER"
fi
info "server is healthy at $SERVER_URL"

resolve_workspace_id
info "workspace: $WORKSPACE_ID"

step "Creating API key '$KEY_NAME' inside '$CONTAINER'"
GENERATE_CMD='exec yarn command:prod workspace:generate-api-key --workspace-id "$1" --name "$2"'
if [[ -n "$EXPIRES_IN" ]]; then
  GENERATE_CMD+=' --expires-in "$3"'
  GENERATE_ARGS=("$WORKSPACE_ID" "$KEY_NAME" "$EXPIRES_IN")
else
  GENERATE_ARGS=("$WORKSPACE_ID" "$KEY_NAME")
fi

RUNNER=(docker exec -w /app/packages/twenty-server "$CONTAINER" sh -c "$GENERATE_CMD" _ "${GENERATE_ARGS[@]}")
if command -v timeout >/dev/null; then
  RUNNER=(timeout 300 "${RUNNER[@]}")
fi

if ! output="$("${RUNNER[@]}" 2>&1)"; then
  printf '%s\n' "$output" | tail -n 40 >&2
  die "The server CLI inside '$CONTAINER' failed to create the key. See the output above."
fi

TOKEN="$(sed -n 's/.*TOKEN:\([A-Za-z0-9._-]\{20,\}\).*/\1/p' <<<"$output" | tail -n 1)"
if [[ -z "$TOKEN" ]]; then
  printf '%s\n' "$output" | tail -n 20 >&2
  die "The command ran but printed no token. The workspace may have no Admin role; create the key in the UI instead (Settings -> API keys)."
fi
info "token created"

step "Verifying the token against the server"
if ! probe_api_key "$SERVER_URL" "$TOKEN"; then
  explain_probe_failure "key just created in $CONTAINER"
  die "The freshly created key was not accepted by $SERVER_URL."
fi
info "accepted by the server; workspace: ${PROBE_FOR_WS:-(unknown)}"

if (( SAVE )); then
  umask 077
  printf '%s\n' "$TOKEN" > "$KEY_FILE"
  chmod 600 "$KEY_FILE" 2>/dev/null || true
fi

if (( TOKEN_ONLY )); then
  printf '%s\n' "$TOKEN"
  exit 0
fi

printf '\n\033[1;32m==> API key ready\033[0m\n\n'
printf '    Token:       %s\n' "$TOKEN"
if (( SAVE )); then
  printf '    Saved to:    %s  (chmod 600, git-ignored)\n' "$KEY_FILE"
  cat <<EOF

    start.sh uses that file automatically while TWENTY_API_KEY is unset, so the
    next command is simply:

        ./start.sh

EOF
else
  cat <<EOF

    Nothing was saved (--no-save). Export it yourself:

        export TWENTY_API_KEY='$TOKEN'

EOF
fi
cat <<EOF
    Export it in this shell:
        export TWENTY_API_KEY="\$(cat $KEY_FILE)"

    Revoke it later in Settings -> API keys (name: $KEY_NAME).
    Do not commit the token or paste it into chat or issues.

EOF
