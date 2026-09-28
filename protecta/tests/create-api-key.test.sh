#!/usr/bin/env bash
# Tests for create-api-key.sh. Docker and curl are mocked: nothing here touches
# a real container, server or network.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cp "$ROOT/create-api-key.sh" "$TMP/create-api-key.sh"

export COMMAND_LOG="$TMP/commands"
export TEST_VALID_KEY="eyJhbGciOiJIUzI1NiJ9.good.token"
export TEST_TOKEN="eyJhbGciOiJIUzI1NiJ9.fresh.token"
# A rejected key, shaped like a Twenty API key so its workspace can be decoded.
export TEST_BAD_KEY='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIyMDIwMjAyMC05ZTNiLTQ2ZDQtYTU1Ni04OGI5ZGRjMmIwMzQiLCJ3b3Jrc3BhY2VJZCI6IjIwMjAyMDIwLTFjMjUtNGQwMi1iZjI1LTZhZWNjZjdlYTQxOSIsInR5cGUiOiJBQ0NFU1MifQ.signature'
export PATH="$TMP/bin:$PATH"
DEV_WS="20202020-1c25-4d02-bf25-6aeccf7ea419"
: > "$COMMAND_LOG"

cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) exit 0 ;;
  inspect)
    case "$*" in
      *State.Running*) echo "${TEST_RUNNING:-true}" ;;
      *Config.Env*) echo "NODE_PORT=2020" ;;
      *) echo "" ;;
    esac
    exit 0
    ;;
  exec)
    printf '%s\n' "$*" >> "$COMMAND_LOG"
    if [[ "$*" == *"SELECT 'meta'"* ]]; then
      printf '%s\n' "${TEST_SEED_ROWS:-meta|1|||}"
      [[ -n "${TEST_SEED_ROWS:-}" ]] || printf '%s\n' 'row|20202020-1c25-4d02-bf25-6aeccf7ea419|Apple|ACTIVE|workspace_test'
      exit 0
    fi
    if [[ "$*" == *workspaceMember* ]]; then
      echo "${TEST_MEMBER_COUNT:-12}"
      exit 0
    fi
    if [[ "$*" == *psql* ]]; then
      printf '%s\n' "${TEST_WORKSPACES:-20202020-1c25-4d02-bf25-6aeccf7ea419|Apple}"
      exit 0
    fi
    if [[ "${TEST_GENERATE_FAIL:-0}" == 1 ]]; then
      echo "error: connection refused" >&2
      exit 1
    fi
    if [[ "${TEST_NO_TOKEN:-0}" == 1 ]]; then
      echo "[Nest] 20  - LOG [GenerateApiKeyCommand] No Admin role found"
      exit 0
    fi
    echo "[Nest] 20  - 09/28/2026, 4:13:00 PM   LOG [GenerateApiKeyCommand] TOKEN:${TEST_TOKEN}"
    exit 0
    ;;
esac
exit 0
MOCK

cat > "$TMP/bin/curl" <<'MOCK'
#!/usr/bin/env bash
body_file=""
key=""
prev=""
for arg in "$@"; do
  case "$prev" in
    -o) body_file="$arg" ;;
  esac
  case "$arg" in
    Authorization:*) key="${arg#Authorization: Bearer }" ;;
  esac
  prev="$arg"
done

if [[ "$*" == *healthz* ]]; then
  [[ "${TEST_HEALTHY:-1}" == 1 ]] && { echo '{"status":"ok"}'; exit 0; }
  exit 7
fi

if [[ "$*" == *metadata* ]]; then
  accepted=0
  IFS='|' read -r -a valid_keys <<< "${TEST_VALID_KEYS:-${TEST_VALID_KEY}|${TEST_TOKEN}}"
  for candidate in "${valid_keys[@]}"; do
    [[ -n "$candidate" && "$key" == "$candidate" ]] && accepted=1
  done
  if (( accepted )); then
    out='{"data":{"currentWorkspace":{"id":"20202020-1c25-4d02-bf25-6aeccf7ea419","displayName":"Apple"}}}'
    code=200
  else
    out='{"errors":[{"message":"Unauthenticated","extensions":{"code":"UNAUTHENTICATED"}}],"data":null}'
    code=401
  fi
  [[ -n "$body_file" ]] && printf '%s' "$out" > "$body_file"
  echo "$code"
  exit 0
fi
exit 0
MOCK

chmod +x "$TMP/bin/"*
key_file="$TMP/key"
script="$TMP/create-api-key.sh"

# --- default: seeded dev workspace, token saved, verified --------------------
: > "$COMMAND_LOG"
bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"
grep -q 'yarn command:prod workspace:generate-api-key' "$COMMAND_LOG"
grep -qE "_ ${DEV_WS} protecta-cli$" "$COMMAND_LOG"
grep -q 'API key ready' "$TMP/out"
grep -q "Token:       $TEST_TOKEN" "$TMP/out"
[[ "$(cat "$key_file")" == "$TEST_TOKEN" ]]
[[ "$(stat -c '%a' "$key_file")" == "600" ]]
echo 'PASS create: mints in the dev workspace, verifies and saves the token'

# --- --stdout prints only the token -----------------------------------------
: > "$COMMAND_LOG"
stdout="$(bash "$script" --key-file "$key_file" --stdout)"
[[ "$stdout" == "$TEST_TOKEN" ]]
echo 'PASS --stdout: stdout carries the token and nothing else'

# --- a single non-dev workspace is picked automatically ---------------------
: > "$COMMAND_LOG"
env TEST_WORKSPACES="11111111-2222-3333-4444-555555555555|Protecta" \
  bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"
grep -qE '_ 11111111-2222-3333-4444-555555555555 protecta-cli$' "$COMMAND_LOG"
echo 'PASS create: uses the only workspace when it is not the seeded one'

# --- several workspaces without the dev one: refuse and list -----------------
: > "$COMMAND_LOG"
if env TEST_WORKSPACES=$'11111111-2222-3333-4444-555555555555|Protecta\n66666666-7777-8888-9999-000000000000|Bode' \
    bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected failure on ambiguous workspaces'; exit 1
fi
! grep -q 'generate-api-key' "$COMMAND_LOG"
grep -q '11111111-2222-3333-4444-555555555555' "$TMP/err"
grep -q '66666666-7777-8888-9999-000000000000' "$TMP/err"
grep -q 'more than one workspace' "$TMP/err"
echo 'PASS create: asks for --workspace-id when several workspaces exist'

# --- explicit flags are forwarded -------------------------------------------
: > "$COMMAND_LOG"
env TEST_WORKSPACES=$'11111111-2222-3333-4444-555555555555|Protecta\n66666666-7777-8888-9999-000000000000|Bode' \
  bash "$script" --key-file "$key_file" --workspace-id 66666666-7777-8888-9999-000000000000 \
    --name custom-key --expires-in 30 > "$TMP/out" 2> "$TMP/err"
grep -q -- '--expires-in "$3" _ 66666666-7777-8888-9999-000000000000 custom-key 30' "$COMMAND_LOG"
echo 'PASS create: honours --workspace-id, --name and --expires-in'

# --- a token the server rejects is not saved --------------------------------
: > "$COMMAND_LOG"
rm -f "$key_file"
if env TEST_VALID_KEYS="$TEST_VALID_KEY"     bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected failure when the server rejects the new token'; exit 1
fi
[[ ! -f "$key_file" ]]
grep -q 'not accepted' "$TMP/err"
echo 'PASS create: an unverifiable token fails instead of being saved'

# --- server CLI failures surface the container output -----------------------
: > "$COMMAND_LOG"
if env TEST_GENERATE_FAIL=1 bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected failure when the in-container command fails'; exit 1
fi
grep -q 'connection refused' "$TMP/err"
echo 'PASS create: reports the in-container command failure'

if env TEST_NO_TOKEN=1 bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected failure when no token is printed'; exit 1
fi
grep -q 'printed no token' "$TMP/err"
echo 'PASS create: explains a missing token (no Admin role)'

# --- unusable container states ----------------------------------------------
if env TEST_RUNNING=false bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected failure when the container is stopped'; exit 1
fi
grep -q 'stopped' "$TMP/err"

if env TEST_HEALTHY=0 bash "$script" --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected failure when the server is unhealthy'; exit 1
fi
grep -q 'not healthy' "$TMP/err"
echo 'PASS create: refuses a stopped container and an unhealthy server'

# --- --check ----------------------------------------------------------------
# The rejection test above removed the file, so seed it again from the key the
# mock server accepts.
printf '%s\n' "$TEST_VALID_KEY" > "$key_file"
bash "$script" --check --key-file "$key_file" > "$TMP/out" 2> "$TMP/err" \
  || { echo 'Expected --check to pass for a valid key'; cat "$TMP/err"; exit 1; }
grep -q 'Key is usable' "$TMP/err"
grep -q 'Apple' "$TMP/err"

if env TWENTY_API_KEY="eyJhbGciOiJIUzI1NiJ9.bad.token" bash "$script" --check --key-file "$key_file" \
    > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected --check to fail for a rejected key'; exit 1
fi
grep -q 'Key is not usable' "$TMP/err"
grep -q 'only works on the instance that issued it' "$TMP/err"
echo 'PASS --check: accepts a good key and explains a rejected one'

# --- --list -----------------------------------------------------------------
env TEST_WORKSPACES=$'11111111-2222-3333-4444-555555555555|Protecta\n66666666-7777-8888-9999-000000000000|Bode' \
  bash "$script" --list > "$TMP/out" 2> "$TMP/err"
grep -q 'Protecta  11111111-2222-3333-4444-555555555555' "$TMP/err"
grep -q 'Bode  66666666-7777-8888-9999-000000000000' "$TMP/err"
echo 'PASS --list: prints the workspaces held by the container'

# --- --list: an unfinished first-boot seed is called out ---------------------
env TEST_WORKSPACES='20202020-1c25-4d02-bf25-6aeccf7ea419|Apple|PENDING_CREATION' \
  bash "$script" --list > "$TMP/out" 2> "$TMP/err"
grep -q 'PENDING_CREATION, first-boot seed unfinished' "$TMP/err"
echo 'PASS --list: flags a workspace the seed never activated'

# --- --check: a rejected key is explained together with the container state --
: > "$COMMAND_LOG"
if env TWENTY_API_KEY="$TEST_BAD_KEY" TEST_SEED_ROWS="$(printf '%s\n' 'meta|1|||' 'row|20202020-1c25-4d02-bf25-6aeccf7ea419|Apple|PENDING_CREATION|workspace_test')" \
    bash "$script" --check --key-file "$key_file" > "$TMP/out" 2> "$TMP/err"; then
  echo 'Expected --check to fail for a rejected key'; exit 1
fi
grep -q 'the key was issued for workspace' "$TMP/err"
grep -q 'still in PENDING_CREATION' "$TMP/err"
grep -q 'repair it with: ./start.sh --reseed' "$TMP/err"
echo 'PASS --check: rejected key on an unfinished seed points at the repair'
