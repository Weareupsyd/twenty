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
printf 'npm %s (cwd=%s)\n' "$*" "$PWD" >> "$COMMAND_LOG"
# TEST_LOCK_STALE=1: npm ci refuses a lockfile that does not match package.json.
if [[ "$*" == ci* && "${TEST_LOCK_STALE:-0}" == 1 ]]; then
  cat >&2 <<'ERR'
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error Missing: @hugeicons/react@1.1.10 from lock file
ERR
  exit 1
fi
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
  exec)
    printf 'docker exec %s\n' "$*" >> "$COMMAND_LOG"
    if [[ "$*" == *seed:dev* ]]; then
      printf '%s\n' "${TEST_SEED_LOG:-[Nest] LOG DevSeederService finished}"
      touch "${SEED_MARKER:-/dev/null}"
      exit 0
    fi
    if [[ "$*" == *cache:flush* ]]; then exit 0; fi
    if [[ "$*" == *workspaceMember* ]]; then
      echo "${TEST_MEMBER_COUNT:-12}"
      exit 0
    fi
    if [[ "$*" == *core.workspace* ]]; then
      rows_file=""
      if [[ -f "${SEED_MARKER:-/nonexistent}" ]]; then
        rows_file="${TEST_WORKSPACE_ROWS_AFTER_FILE:-}"
      else
        rows_file="${TEST_WORKSPACE_ROWS_FILE:-}"
      fi
      if [[ -n "$rows_file" && -f "$rows_file" ]]; then
        cat "$rows_file"
      else
        echo 'meta|1|||'
        echo 'row|20202020-1c25-4d02-bf25-6aeccf7ea419|Apple|ACTIVE|workspace_test'
      fi
      exit 0
    fi
    exit 0
    ;;
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
    TEST_NODE_MAJOR TEST_REMOTE_VALID SKIP_NODE_BOOTSTRAP PKG_MANAGER SEED_REPAIR \
    TEST_WORKSPACE_ROWS_FILE TEST_WORKSPACE_ROWS_AFTER_FILE TEST_MEMBER_COUNT TEST_SEED_LOG \
    2>/dev/null || true
  export SKIP_INSTALL=1
  rm -f "$TMP/protecta/.twenty-api-key" "$SEED_MARKER"
  : > "$COMMAND_LOG"
  rm -f "$CURL_COUNT"
}

# Rows the mocked psql reports. The seeded workspace is healthy by default; the
# broken variant reproduces a first-boot seed that never activated the workspace.
export SEED_MARKER="$TMP/seeded"
# A rejected key, shaped like a Twenty API key so its workspace can be read.
STALE_KEY='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIyMDIwMjAyMC05ZTNiLTQ2ZDQtYTU1Ni04OGI5ZGRjMmIwMzQiLCJ3b3Jrc3BhY2VJZCI6IjIwMjAyMDIwLTFjMjUtNGQwMi1iZjI1LTZhZWNjZjdlYTQxOSIsInR5cGUiOiJBQ0NFU1MifQ.signature'
BROKEN_ROWS="$TMP/rows-broken"
printf '%s\n' 'meta|1|||' \
  'row|20202020-1c25-4d02-bf25-6aeccf7ea419|Apple|PENDING_CREATION|workspace_test' > "$BROKEN_ROWS"

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

# 13. Rejected key on an instance whose first-boot seed never finished --------
# The key is not the problem: the workspace it names was never created, so the
# seed is re-run, a key is minted and the deployment continues.
reset_env
export TWENTY_API_KEY="$STALE_KEY" TEST_REJECT_KEYS="$STALE_KEY"
export TEST_WORKSPACE_ROWS_FILE="$BROKEN_ROWS"
run
grep -q 'the key was issued for workspace 20202020-1c25-4d02-bf25-6aeccf7ea419' "$TMP/output"
grep -q 'PENDING_CREATION' "$TMP/output"
grep -q 'seed:dev' "$COMMAND_LOG"
grep -q 'create-api-key --stdout' "$COMMAND_LOG"
grep -q "remote:add .*--api-key $MINTED_TOKEN" "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
grep -q 'the first-boot seed never finished' "$TMP/output"
echo 'PASS rejected key + unfinished seed: re-seeds, mints a key and syncs'

# 14. The same broken instance with SEED_REPAIR=0: report, do not touch it -----
reset_env
export TWENTY_API_KEY="$STALE_KEY" TEST_REJECT_KEYS="$STALE_KEY" SEED_REPAIR=0
export TEST_WORKSPACE_ROWS_FILE="$BROKEN_ROWS"
if run; then echo 'Expected failure with SEED_REPAIR=0'; exit 1; fi
! grep -q 'seed:dev' "$COMMAND_LOG"
! grep -q 'create-api-key' "$COMMAND_LOG"
grep -q 'the first-boot seed never finished' "$TMP/output"
grep -q './start.sh --reseed' "$TMP/output"
echo 'PASS SEED_REPAIR=0: diagnoses the workspace without re-seeding'

# 15. A repair that does not help stops the deployment -----------------------
# The seed returns non-zero and the workspace is still PENDING_CREATION.
reset_env
export TWENTY_API_KEY="$STALE_KEY" TEST_REJECT_KEYS="$STALE_KEY"
export TEST_WORKSPACE_ROWS_FILE="$BROKEN_ROWS" TEST_WORKSPACE_ROWS_AFTER_FILE="$BROKEN_ROWS"
if run; then echo 'Expected failure when the seed cannot be repaired'; exit 1; fi
grep -q 'seed:dev' "$COMMAND_LOG"
! grep -q '^apply ' "$COMMAND_LOG"
grep -q 'still in PENDING_CREATION' "$TMP/output"
echo 'PASS failed repair: stops before syncing and keeps the diagnosis'

# 16. --reseed re-runs the seed even when no key was supplied -----------------
reset_env
export TEST_WORKSPACE_ROWS_FILE="$BROKEN_ROWS"
if ! bash "$TMP/protecta/start.sh" --port 3030 --reseed > "$TMP/output" 2>&1; then
  cat "$TMP/output"
  echo 'Expected --reseed to succeed'
  exit 1
fi
grep -q 'seed:dev' "$COMMAND_LOG"
grep -q 'the workspace is in place now' "$TMP/output"
grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS --reseed: repairs the workspace and continues to the sync'

# 17. No key on a broken instance: the seed runs before minting a key ---------
reset_env
export TEST_WORKSPACE_ROWS_FILE="$BROKEN_ROWS"
run
seed_line="$(grep -n 'seed:dev' "$COMMAND_LOG" | cut -d: -f1 | head -n 1)"
mint_line="$(grep -n 'create-api-key --stdout' "$COMMAND_LOG" | cut -d: -f1 | head -n 1)"
[[ -n "$seed_line" && -n "$mint_line" && "$seed_line" -lt "$mint_line" ]]
grep -q "remote:add .*--api-key $MINTED_TOKEN" "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS no key + unfinished seed: re-seeds before minting'

# 18. A stale lockfile is repaired instead of stopping the deployment ---------
# npm ci exits 1 when package-lock.json and package.json disagree. npm install
# rewrites the lockfile, so the deployment continues (this is what a Protecta
# checkout with an unregenerated lockfile used to break).
reset_env
printf '{ "name": "protecta-bode", "version": "1.0.0" }\n' > "$TMP/protecta/app/package.json"
printf '{ "name": "protecta-bode", "version": "1.0.0", "lockfileVersion": 3 }\n' > "$TMP/protecta/app/package-lock.json"
export SKIP_INSTALL=0 TEST_LOCK_STALE=1
touch "$TMP/protecta/app/package.json"          # newer than the installed CLI
run
unset TEST_LOCK_STALE SKIP_INSTALL
grep -q 'package-lock.json is out of sync with package.json' "$TMP/output"
grep -q 'repairing it with: npm install' "$TMP/output"
grep -q "^npm ci --no-audit --no-fund (cwd=$TMP/protecta/app)$" "$COMMAND_LOG"
grep -q "^npm install --no-audit --no-fund (cwd=$TMP/protecta/app)$" "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS stale lockfile: npm install repairs it, then the app still syncs'

# 19. Linked apps are synced twice, around the Protecta apply ----------------
# Each app's generated API client only knows the objects that existed when it
# was produced. Syncing docgen/sms before Protecta (so Protecta can see
# generatedDocument) and again after (so they can see insurancePolicy) is what
# keeps cross-app reads working; the verification step reports a client that
# still misses a field instead of letting the first download 500.
reset_env
mkdir -p "$TMP/protecta/docgen/app" \
  "$TMP/protecta/docgen/app/node_modules/twenty-client-sdk/dist/core/generated" \
  "$TMP/protecta/app/node_modules/twenty-client-sdk/dist/core/generated"
printf 'insurancePolicies insuranceQuotes\n' \
  > "$TMP/protecta/docgen/app/node_modules/twenty-client-sdk/dist/core/generated/schema.d.ts"
printf 'generatedDocuments\n' \
  > "$TMP/protecta/app/node_modules/twenty-client-sdk/dist/core/generated/schema.d.ts"
run
first_docgen="$(grep -n "^apply $TMP/protecta/docgen/app$" "$COMMAND_LOG" | head -n 1 | cut -d: -f1)"
protecta_apply="$(grep -n "^apply $TMP/protecta/app$" "$COMMAND_LOG" | head -n 1 | cut -d: -f1)"
second_docgen="$(grep -n "^apply $TMP/protecta/docgen/app$" "$COMMAND_LOG" | tail -n 1 | cut -d: -f1)"
[[ -n "$first_docgen" && -n "$protecta_apply" && -n "$second_docgen" ]]
[[ "$first_docgen" -lt "$protecta_apply" && "$protecta_apply" -lt "$second_docgen" ]]
grep -q 'Document Generator: can query insurancePolicies' "$TMP/output"
grep -q 'Protecta Bode: can query generatedDocuments' "$TMP/output"
echo 'PASS cross-app clients: linked apps synced before and after the app'

# 20. A client missing a cross-app object is reported at deploy time ---------
# Without this the failure surfaces much later as a 500 from the policy
# download route: the generated client refuses the query itself.
reset_env
printf 'people insuranceQuotes\n' \
  > "$TMP/protecta/docgen/app/node_modules/twenty-client-sdk/dist/core/generated/schema.d.ts"
rm -f "$TMP/protecta/app/node_modules/twenty-client-sdk/dist/core/generated/schema.d.ts"
run
grep -q "Document Generator: generated schema has no 'insurancePolicies'" "$TMP/output"
grep -q "Protecta Bode: generated schema has no 'generatedDocuments'" "$TMP/output"
grep -q 'run ./start.sh once more' "$TMP/output"
echo 'PASS cross-app clients: a missing object is reported with the remedy'
