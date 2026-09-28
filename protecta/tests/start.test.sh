#!/usr/bin/env bash
# Tests for start.sh. Docker, curl, the twenty CLI and create-api-key.sh are
# mocked: nothing here touches a real container, server or network.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/protecta/app/node_modules/.bin"
cp "$ROOT/start.sh" "$TMP/protecta/start.sh"

export COMMAND_LOG="$TMP/commands" CURL_COUNT="$TMP/curl-count"
export PATH="$TMP/bin:$PATH"
MINTED_TOKEN="eyJhbGciOiJIUzI1NiJ9.minted.token"

cat > "$TMP/bin/node" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "-v" ]]; then echo "v${TEST_NODE_MAJOR:-24}.10.0"; exit 0; fi
[[ "${TEST_NODE_MAJOR:-24}" == 24 ]]
MOCK
cat > "$TMP/bin/npm" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > "$TMP/bin/npx" <<'MOCK'
#!/usr/bin/env bash
printf 'npx %s\n' "$*" >> "$COMMAND_LOG"
# Emulate: npx --yes --package=node@24 -- bash <script> [args...]
shift 2 # --yes --package=node@24
if [[ "${1:-}" == "--" ]]; then shift; fi
shift  # bash
script="$1"; shift
TEST_NODE_MAJOR=24 PROTECTA_NODE_BOOTSTRAPPED=1 bash "$script" "$@"
MOCK
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) exit 0 ;;
  --version) echo 'Docker version 29.0.0' ;;
  inspect) echo "${TEST_RUNNING:-true}" ;;
esac
MOCK
cat > "$TMP/bin/curl" <<'MOCK'
#!/usr/bin/env bash
body_file="" prev="" key=""
for arg in "$@"; do
  [[ "$prev" == "-o" ]] && body_file="$arg"
  case "$arg" in Authorization:*) key="${arg#Authorization: Bearer }" ;; esac
  prev="$arg"
done

if [[ "$*" == *healthz* ]]; then
  count="$(cat "$CURL_COUNT" 2>/dev/null || echo 0)"
  echo "$((count + 1))" > "$CURL_COUNT"
  if [[ "${TEST_COLD:-0}" == 1 && "$count" == 0 ]]; then exit 7; fi
  echo '{"status":"ok"}'
  exit 0
fi

if [[ "$*" == *metadata* ]]; then
  rejected=0
  IFS='|' read -r -a bad_keys <<< "${TEST_REJECT_KEYS:-}"
  for bad in "${bad_keys[@]}"; do
    [[ -n "$bad" && "$key" == "$bad" ]] && rejected=1
  done
  if (( rejected )); then
    out='{"errors":[{"message":"Unauthenticated","extensions":{"code":"UNAUTHENTICATED"}}],"data":null}'
    code=401
  else
    out='{"data":{"currentWorkspace":{"id":"ws-1","displayName":"Apple"}}}'
    code=200
  fi
  [[ -n "$body_file" ]] && printf '%s' "$out" > "$body_file"
  echo "$code"
  exit 0
fi
exit 0
MOCK
cat > "$TMP/protecta/app/node_modules/.bin/twenty" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COMMAND_LOG"
if [[ "$1" == docker:start ]]; then exit 1; fi
if [[ "$1" == remote:status && "${TEST_REMOTE_VALID:-0}" == 1 ]]; then
  echo '  Auth:    api-key (valid)'
fi
exit 0
MOCK
cat > "$TMP/protecta/create-api-key.sh" <<MOCK
#!/usr/bin/env bash
printf 'create-api-key %s\n' "\$*" >> "\$COMMAND_LOG"
echo "     \033[1;34m==> minting (mock)\033[0m" >&2
echo "$MINTED_TOKEN"
MOCK
chmod +x "$TMP/bin/"* "$TMP/protecta/app/node_modules/.bin/twenty" "$TMP/protecta/create-api-key.sh"

run() { bash "$TMP/protecta/start.sh" --port 3030 > "$TMP/output" 2>&1; }
reset_env() {
  unset TWENTY_API_KEY TWENTY_API_KEY_FILE TEST_REJECT_KEYS TEST_HEALTHY TEST_RUNNING TEST_COLD \
    TEST_NODE_MAJOR TEST_REMOTE_VALID SKIP_NODE_BOOTSTRAP PKG_MANAGER 2>/dev/null || true
  export SKIP_INSTALL=1
  rm -f "$TMP/protecta/.twenty-api-key"
  : > "$COMMAND_LOG"
  rm -f "$CURL_COUNT"
}

# 1. Healthy server, key from the environment --------------------------------
reset_env
export TWENTY_API_KEY=test-only
run
grep -q 'remote:add --url http://localhost:3030 --as protecta-local --api-key test-only' "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
! grep -q 'docker:start' "$COMMAND_LOG"
! grep -q 'create-api-key' "$COMMAND_LOG"
echo 'PASS healthy server: uses selected port, the env key and syncs'

# 2. Cold start: the CLI times out but the container keeps seeding ------------
reset_env
export TEST_COLD=1
run
grep -q 'docker:start --port 3030' "$COMMAND_LOG"
grep -q 'allowing extra time' "$TMP/output"
grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS initial timeout: waits for running container and continues'

# 3. Container stopped (server not up yet) ------------------------------------
reset_env
export TEST_RUNNING=false TEST_COLD=1
if run; then echo 'Expected stopped-container failure'; exit 1; fi
! grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS stopped container: does not sync'

# 4. Unsupported Node without bootstrap ---------------------------------------
reset_env
export TEST_NODE_MAJOR=20 SKIP_NODE_BOOTSTRAP=1
if run; then echo 'Expected unsupported Node failure'; exit 1; fi
grep -q 'requires Node 24.5+' "$TMP/output"
! grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS rejects unsupported Node when the bootstrap is disabled'

# 5. Unsupported Node: start.sh re-runs itself under Node 24 ------------------
reset_env
export TEST_NODE_MAJOR=20
run
grep -q 're-running this script under Node 24' "$TMP/output"
grep -q 'npx --yes --package=node@24 -- bash .*start.sh --port 3030' "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
! grep -q 'requires Node 24.5+' "$TMP/output"
echo 'PASS old system Node: re-executes through npx and syncs'

# 6. Rejected key from the environment fails fast, without an OAuth prompt ----
reset_env
export TWENTY_API_KEY=stale-key TEST_REJECT_KEYS=stale-key
if run; then echo 'Expected rejected-key failure'; exit 1; fi
grep -q 'only works on the instance that issued it' "$TMP/output"
grep -q './start.sh --new-api-key' "$TMP/output"
! grep -q 'remote:add' "$COMMAND_LOG"
! grep -q '^apply ' "$COMMAND_LOG"
! grep -q 'authorize?' "$TMP/output"
echo 'PASS rejected env key: explains why and never starts the OAuth prompt'

# 7. Key file is used when the environment is not set ------------------------
reset_env
printf '%s\n' 'eyJhbGciOiJIUzI1NiJ9.saved.token' > "$TMP/protecta/.twenty-api-key"
run
grep -q 'remote:add .*--api-key eyJhbGciOiJIUzI1NiJ9.saved.token' "$COMMAND_LOG"
! grep -q 'create-api-key' "$COMMAND_LOG"
echo 'PASS saved key file: picked up without TWENTY_API_KEY'

# 8. No key anywhere: one is minted inside the container ---------------------
reset_env
run
grep -q 'create-api-key --stdout' "$COMMAND_LOG"
grep -q "remote:add .*--api-key $MINTED_TOKEN" "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
[[ "$(cat "$TMP/protecta/.twenty-api-key")" == "$MINTED_TOKEN" ]]
echo 'PASS no key: mints one in the container instead of asking for a browser'

# 9. Stale key file: replaced automatically ----------------------------------
reset_env
printf '%s\n' 'eyJhbGciOiJIUzI1NiJ9.stale.token' > "$TMP/protecta/.twenty-api-key"
TEST_REJECT_KEYS=eyJhbGciOiJIUzI1NiJ9.stale.token run
grep -q 'the saved key is no longer valid; creating a new one' "$TMP/output"
grep -q "remote:add .*--api-key $MINTED_TOKEN" "$COMMAND_LOG"
echo 'PASS stale key file: a fresh key is minted and used'

# 10. No key and no way to mint: instructions instead of a hang ---------------
reset_env
mv "$TMP/protecta/create-api-key.sh" "$TMP/protecta/create-api-key.sh.disabled"
if run; then echo 'Expected failure without a key or a minting helper'; exit 1; fi
grep -q './create-api-key.sh' "$TMP/output"
! grep -q 'remote:add' "$COMMAND_LOG"
mv "$TMP/protecta/create-api-key.sh.disabled" "$TMP/protecta/create-api-key.sh"
echo 'PASS no key, no helper: fails with instructions instead of hanging'

# 11. --new-api-key rotates even a valid env key -----------------------------
reset_env
export TWENTY_API_KEY=still-valid
if ! bash "$TMP/protecta/start.sh" --port 3030 --new-api-key > "$TMP/output" 2>&1; then
  cat "$TMP/output"
  echo 'Expected --new-api-key to succeed'
  exit 1
fi
grep -q 'create-api-key --stdout' "$COMMAND_LOG"
grep -q "remote:add .*--api-key $MINTED_TOKEN" "$COMMAND_LOG"
! grep -q -- '--api-key still-valid' "$COMMAND_LOG"
echo 'PASS --new-api-key: rotates the key and uses the new one'

# 12. No key but an authenticated remote already exists ----------------------
reset_env
export TEST_REMOTE_VALID=1
run
! grep -q 'create-api-key' "$COMMAND_LOG"
grep -q 'remote:use protecta-local' "$COMMAND_LOG"
! grep -q 'remote:add' "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS existing remote: reused without touching the API key'
