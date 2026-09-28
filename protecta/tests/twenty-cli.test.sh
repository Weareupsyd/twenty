#!/usr/bin/env bash
# Tests for twenty.sh. Node, npm, npx and the twenty CLI are mocked: nothing
# here installs packages, downloads Node or talks to a server.
#
# The bug these tests pin down: `npx twenty` in an app folder without
# node_modules does not fail with "CLI missing", it downloads the unrelated
# `twenty` package from the registry and dies with "could not determine
# executable to run". twenty.sh must always use the app-local CLI instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="$TMP/protecta"
mkdir -p "$BASE/app/node_modules/.bin" "$BASE/docgen/app" "$BASE/sms/app" "$TMP/bin"
cp "$ROOT/twenty.sh" "$BASE/twenty.sh"
for app in app docgen/app sms/app; do
  printf '{ "name": "test-fixture", "version": "0.0.0" }\n' > "$BASE/$app/package.json"
  printf '{ "name": "test-fixture", "lockfileVersion": 3 }\n' > "$BASE/$app/package-lock.json"
done

export COMMAND_LOG="$TMP/commands"
export PATH="$TMP/bin:$PATH"
: > "$COMMAND_LOG"

cat > "$TMP/bin/node" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "-v" ]]; then echo "v${TEST_NODE_MAJOR:-24}.10.0"; exit 0; fi
[[ "${TEST_NODE_MAJOR:-24}" == 24 ]]
MOCK
cat > "$TMP/bin/npm" <<'MOCK'
#!/usr/bin/env bash
printf 'npm %s (cwd=%s)\n' "$*" "$PWD" >> "$COMMAND_LOG"
if [[ "$*" == *install* || "$*" == *ci* ]]; then
  [[ "${TEST_INSTALL_FAILS:-0}" == 1 ]] && exit 1
  [[ "${TEST_NO_CLI:-0}" == 1 ]] && exit 0
  mkdir -p "$PWD/node_modules/.bin"
  cat > "$PWD/node_modules/.bin/twenty" <<'CLI'
#!/usr/bin/env bash
printf 'cli %s (cwd=%s)\n' "$*" "$PWD" >> "$COMMAND_LOG"
exit "${TEST_CLI_EXIT:-0}"
CLI
  chmod +x "$PWD/node_modules/.bin/twenty"
fi
exit 0
MOCK
cat > "$TMP/bin/npx" <<'MOCK'
#!/usr/bin/env bash
printf 'npx %s\n' "$*" >> "$COMMAND_LOG"
# Emulate: npx --yes --package=node@24 -- bash <script> [args...]
shift 2 # --yes --package=node@24
[[ "${1:-}" == "--" ]] && shift
shift # bash
script="$1"; shift
TEST_NODE_MAJOR=24 PROTECTA_NODE_BOOTSTRAPPED=1 bash "$script" "$@"
MOCK
chmod +x "$TMP/bin/"*

# The app-local CLI. A missing one is what the old instructions ran into.
installed_cli() {
  mkdir -p "$1/node_modules/.bin"
  cat > "$1/node_modules/.bin/twenty" <<'CLI'
#!/usr/bin/env bash
printf 'cli %s (cwd=%s)\n' "$*" "$PWD" >> "$COMMAND_LOG"
exit "${TEST_CLI_EXIT:-0}"
CLI
  chmod +x "$1/node_modules/.bin/twenty"
}

run() { bash "$BASE/twenty.sh" "$@" > "$TMP/output" 2>&1; }
run_rc() {
  local rc=0
  run "$@" || rc=$?
  printf '%s' "$rc"
}
reset_apps() {
  rm -rf "$BASE/app/node_modules" "$BASE/docgen/app/node_modules" "$BASE/sms/app/node_modules"
  : > "$COMMAND_LOG"
}
first_line() { grep -n "$1" "$COMMAND_LOG" | head -1 | cut -d: -f1; }

# 1. App-local CLI is used, from the app's own directory ------------------------
reset_apps
installed_cli "$BASE/sms/app"
run sms apply .
grep -q "^cli apply \. (cwd=$BASE/sms/app)$" "$COMMAND_LOG"
! grep -q '^npx' "$COMMAND_LOG"
! grep -q '^npm' "$COMMAND_LOG"
echo 'PASS sms: runs the SMS app CLI in the SMS app directory'

# 2. No arguments: builds and syncs that app ------------------------------------
reset_apps
installed_cli "$BASE/docgen/app"
run docgen
grep -q "^cli apply $BASE/docgen/app (cwd=$BASE/docgen/app)$" "$COMMAND_LOG"
! grep -q '^npx' "$COMMAND_LOG"
echo 'PASS docgen: defaults to apply <app folder> and never falls back to npx'

# 3. Missing dependencies are installed, then the CLI runs ----------------------
reset_apps
run sms apply .
grep -q "^npm install --no-audit --no-fund --legacy-peer-deps (cwd=$BASE/sms/app)$" "$COMMAND_LOG"
grep -q '^cli apply \. ' "$COMMAND_LOG"
[[ "$(first_line '^npm install')" -lt "$(first_line '^cli ')" ]]
! grep -q '^npx' "$COMMAND_LOG"
grep -q 'Installing dependencies in' "$TMP/output"
echo 'PASS missing dependencies: installs them for that app, then syncs'

# 4. The main app installs the way start.sh does --------------------------------
reset_apps
rm -rf "$BASE/app/node_modules"
run app plan app
grep -q "^npm ci --no-audit --no-fund (cwd=$BASE/app)$" "$COMMAND_LOG"
grep -q "^cli plan app (cwd=$BASE/app)$" "$COMMAND_LOG"
echo 'PASS app: uses npm ci and the Protecta CLI'

# 5. An install that produces no CLI is reported, not hidden --------------------
reset_apps
export TEST_NO_CLI=1
if run sms apply .; then echo 'Expected a failure when the CLI stays missing'; exit 1; fi
unset TEST_NO_CLI
grep -q 'The twenty CLI is not installed at' "$TMP/output"
grep -q 'npm install --no-audit --no-fund --legacy-peer-deps' "$TMP/output"
grep -q "unrelated 'twenty' package" "$TMP/output"
! grep -q '^cli ' "$COMMAND_LOG"
echo 'PASS missing CLI after install: explains it instead of running the wrong package'

# 6. A failing install stops before the CLI, with its exit code -----------------
reset_apps
export TEST_INSTALL_FAILS=1
rc="$(run_rc sms apply .)"
unset TEST_INSTALL_FAILS
[[ "$rc" != 0 ]]
! grep -q '^cli ' "$COMMAND_LOG"
echo 'PASS failed install: stops instead of syncing a half-installed app'

# 7. SKIP_INSTALL=1 keeps it from touching node_modules -------------------------
reset_apps
export SKIP_INSTALL=1
if run sms apply .; then echo 'Expected a failure with SKIP_INSTALL=1 and no CLI'; exit 1; fi
unset SKIP_INSTALL
! grep -q '^npm' "$COMMAND_LOG"
grep -q 'dependencies are missing, but SKIP_INSTALL=1' "$TMP/output"
echo 'PASS SKIP_INSTALL=1: reports the missing CLI without installing'

# 8. Manifests decide the install, and it settles after one reinstall ----------
reset_apps
installed_cli "$BASE/sms/app"            # node_modules without twenty.sh's stamp
run sms apply .
grep -q 'not recorded yet' "$TMP/output"
grep -q "^npm install .* (cwd=$BASE/sms/app)$" "$COMMAND_LOG"
grep -q '^cli apply \. ' "$COMMAND_LOG"
: > "$COMMAND_LOG"
run sms apply .
! grep -q '^npm' "$COMMAND_LOG"          # recorded now: no second install
grep -q '^cli apply \. ' "$COMMAND_LOG"
printf '{ "name": "test-fixture", "version": "0.0.1" }\n' > "$BASE/sms/app/package.json"
: > "$COMMAND_LOG"
run sms apply .
grep -q "the app's manifests changed since the last install" "$TMP/output"
grep -q "^npm install .* (cwd=$BASE/sms/app)$" "$COMMAND_LOG"
grep -q '^cli apply \. ' "$COMMAND_LOG"
: > "$COMMAND_LOG"
run sms apply .
! grep -q '^npm' "$COMMAND_LOG"
echo 'PASS manifest changes: install once, reinstall on an edit, then stay quiet'

# 8b. Timestamps do not matter: npm rewrites lockfiles while installing --------
reset_apps
installed_cli "$BASE/sms/app"
touch -d '2030-01-01' "$BASE/sms/app/package-lock.json"
run sms apply .
touch "$BASE/sms/app/node_modules/.bin"
: > "$COMMAND_LOG"
run sms apply .
! grep -q '^npm' "$COMMAND_LOG"
printf '{ "name": "test-fixture", "lockfileVersion": 3, "changed": 1 }\n' > "$BASE/sms/app/package-lock.json"
: > "$COMMAND_LOG"
run sms apply .
grep -q '^npm install' "$COMMAND_LOG"
echo 'PASS lockfile content: reinstall on a real edit, not on a new timestamp'

# 9. The CLI exit code is the script's exit code ---------------------------------
reset_apps
installed_cli "$BASE/sms/app"
export TEST_CLI_EXIT=3
rc="$(run_rc sms apply .)"
unset TEST_CLI_EXIT
[[ "$rc" == 3 ]]
grep -q 'the twenty CLI exited with status 3' "$TMP/output"
grep -q './start.sh sets up the' "$TMP/output"
echo 'PASS exit code: the CLI result is passed through and a failure gets a next step'

# 9b. A successful run prints no failure hint ----------------------------------
reset_apps
installed_cli "$BASE/sms/app"
run sms apply .
! grep -q 'exited with status' "$TMP/output"
echo 'PASS success: no next-step hint on a clean sync'

# 10. Old system Node: re-runs under Node 24 via npx ----------------------------
reset_apps
export TEST_NODE_MAJOR=20
run sms apply .
unset TEST_NODE_MAJOR
grep -q 're-running this script under Node 24' "$TMP/output"
grep -q "npx --yes --package=node@24 -- bash .*twenty.sh $BASE/sms/app apply \." "$COMMAND_LOG"
grep -q '^cli apply \. ' "$COMMAND_LOG"
! grep -q 'requires Node 24.5+' "$TMP/output"
echo 'PASS old system Node: re-executes through npx and still syncs'

# 10b. The Node 24 re-exec keeps a relative app path ----------------------------
reset_apps
export TEST_NODE_MAJOR=20
(cd "$BASE" && bash ./twenty.sh sms/app plan .) > "$TMP/output" 2>&1
unset TEST_NODE_MAJOR
grep -q "^cli plan \. (cwd=$BASE/sms/app)$" "$COMMAND_LOG"
! grep -q 'Unknown app' "$TMP/output"
echo 'PASS old system Node: a relative app path still resolves after the re-exec'

# 11. Old Node with the bootstrap disabled: message, no sync --------------------
reset_apps
export TEST_NODE_MAJOR=20 SKIP_NODE_BOOTSTRAP=1
if run sms apply .; then echo 'Expected unsupported Node to stop the run'; exit 1; fi
unset TEST_NODE_MAJOR SKIP_NODE_BOOTSTRAP
grep -q 'requires Node 24.5+' "$TMP/output"
! grep -q '^cli ' "$COMMAND_LOG"
! grep -q '^npm' "$COMMAND_LOG"
echo 'PASS unsupported Node: explains the requirement when the bootstrap is off'

# 12. A path to an app folder works too -----------------------------------------
reset_apps
installed_cli "$BASE/sms/app"
(cd "$BASE" && bash ./twenty.sh sms/app plan .) > "$TMP/output" 2>&1
grep -q "^cli plan \. (cwd=$BASE/sms/app)$" "$COMMAND_LOG"
echo 'PASS app folder: a path is accepted as well'

# 13. Unknown app: usage error, nothing is installed ---------------------------
reset_apps
rc="$(run_rc nonsense)"
[[ "$rc" == 2 ]]
grep -q "Unknown app 'nonsense'" "$TMP/output"
grep -q 'app, docgen, sms' "$TMP/output"
! grep -q '^npm' "$COMMAND_LOG"
! grep -q '^cli ' "$COMMAND_LOG"
echo 'PASS unknown app: refuses with usage instead of guessing'

# 14. --help prints the usage without running anything --------------------------
reset_apps
run --help
grep -q 'Usage: ./twenty.sh <app>' "$TMP/output"
grep -q './twenty.sh sms ' "$TMP/output"
grep -q 'app/node_modules/.bin/twenty' "$TMP/output"
! grep -q '^npm' "$COMMAND_LOG"
! grep -q '^npx' "$COMMAND_LOG"
! grep -q '^cli ' "$COMMAND_LOG"
echo 'PASS --help: prints the usage and touches nothing'
