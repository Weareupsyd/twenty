#!/usr/bin/env bash
# Tests for install.sh. Node, Docker, apt-get, systemctl, git, curl, tar and
# start.sh are mocked: nothing here installs packages, downloads Node or talks
# to a server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="$TMP/protecta"
mkdir -p "$BASE/app/node_modules/.bin" "$BASE/docgen/app" "$BASE/sms/app" "$TMP/bin" "$TMP/tools" "$TMP/node-tools" "$TMP/home"
cp "$ROOT/install.sh" "$BASE/install.sh"
cp "$ROOT/start.sh" "$BASE/start.sh.real"
cp "$ROOT/create-api-key.sh" "$BASE/create-api-key.sh"

export COMMAND_LOG="$TMP/commands" CURL_LOG="$TMP/curl-log" HOME="$TMP/home"
export TEST_APPS=$'f7d814ab-cbfd-48bc-9ee0-06a06daae1a4|Protecta Bode\nc92c1ffa-0652-4380-b82d-1eabb94945f5|Document Generator\nad58822e-4e44-41c2-8e48-ca60f5066f6c|SMS Messaging'
: > "$COMMAND_LOG"; : > "$CURL_LOG"

# start.sh stand-in: the installer's job is to call it, not to test it.
cat > "$BASE/start.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'start.sh %s\n' "$*" >> "$COMMAND_LOG"
[[ "${TEST_START_FAIL:-0}" == 1 ]] && { echo "boom" >&2; exit 1; }
echo "==> Ready (mock)"
MOCK
chmod +x "$BASE/start.sh"

# --- base tools (always on PATH) ---------------------------------------------
cat > "$TMP/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >> "$COMMAND_LOG"
exec "$@"
MOCK
cat > "$TMP/bin/apt-get" <<'MOCK'
#!/usr/bin/env bash
printf 'apt-get %s\n' "$*" >> "$COMMAND_LOG"
if [[ "$*" == *install* && "$*" == *docker* && -n "${DOCKER_TEMPLATE:-}" ]]; then
  install -m 755 "$DOCKER_TEMPLATE" "$(dirname "$DOCKER_TEMPLATE")/../bin/docker"
fi
exit 0
MOCK
cat > "$TMP/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "$COMMAND_LOG"
if [[ "$*" == *docker* ]]; then rm -f "$TMP_DAEMON_DOWN"; fi
exit 0
MOCK
cat > "$TMP/bin/service" <<'MOCK'
#!/usr/bin/env bash
printf 'service %s\n' "$*" >> "$COMMAND_LOG"
exit 0
MOCK
cat > "$TMP/bin/sha256sum" <<'MOCK'
#!/usr/bin/env bash
cat > /dev/null
echo "checksum: OK"
exit 0
MOCK
cat > "$TMP/bin/tar" <<'MOCK'
#!/usr/bin/env bash
printf 'tar %s\n' "$*" >> "$COMMAND_LOG"
dir=""; prev=""
for arg in "$@"; do
  [[ "$prev" == "-C" ]] && dir="$arg"
  prev="$arg"
done
[[ -n "$dir" ]] || exit 0
mkdir -p "$dir/bin"
cat > "$dir/bin/node" <<'NODE'
#!/usr/bin/env bash
if [[ "$1" == "-v" ]]; then echo "v24.21.0"; exit 0; fi
exit 0
NODE
chmod +x "$dir/bin/node"
exit 0
MOCK
cat > "$TMP/bin/curl" <<'MOCK'
#!/usr/bin/env bash
out=""; prev=""
for arg in "$@"; do
  [[ "$prev" == "-o" ]] && out="$arg"
  prev="$arg"
done
printf 'curl %s\n' "$*" >> "$CURL_LOG"

if [[ "$*" == *healthz* ]]; then
  [[ "${TEST_HEALTH:-1}" == 1 ]] && { echo '{"status":"ok"}'; exit 0; }
  exit 7
fi
if [[ "$*" == *SHASUMS256.txt* ]]; then
  printf 'deadbeef  node-v24.21.0-linux-x64.tar.gz\n' > "$out"
  exit 0
fi
if [[ "$*" == *node-v24*-linux-*.tar.gz* ]]; then
  printf 'fake tarball\n' > "$out"
  exit 0
fi
if [[ "$*" == *metadata* ]]; then
  printf '%s' '{"data":{"currentWorkspace":{"id":"ws","displayName":"Apple"}}}' > "$out"
  echo 200
  exit 0
fi
exit 0
MOCK
cat > "$TMP/bin/git" <<'MOCK'
#!/usr/bin/env bash
printf 'git %s\n' "$*" >> "$COMMAND_LOG"
if [[ "${1:-}" == "clone" ]]; then
  # git clone --depth=1 --single-branch --branch B <repo> <dir>
  args=("$@")
  dir="${args[${#args[@]}-1]}"
  mkdir -p "$dir/protecta/app"
  cp "$CLONE_TEMPLATE_INSTALL" "$dir/protecta/install.sh"
  cp "$CLONE_TEMPLATE_START" "$dir/protecta/start.sh"
  exit 0
fi
exit 0
MOCK
chmod +x "$TMP/bin/"*

# --- optional tools (added to PATH per test) ---------------------------------
cat > "$TMP/node-tools/node" <<'MOCK'
#!/usr/bin/env bash
if [[ "${TEST_NODE:-ok}" == "old" ]]; then
  if [[ "$1" == "-v" ]]; then echo "v20.20.2"; exit 0; fi
  exit 1
fi
if [[ "$1" == "-v" ]]; then echo "v24.21.0"; exit 0; fi
exit 0
MOCK
cat > "$TMP/node-tools/npm" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > "$TMP/node-tools/npx" <<'MOCK'
#!/usr/bin/env bash
printf 'npx %s\n' "$*" >> "$COMMAND_LOG"
exit 0
MOCK
cat > "$TMP/tools/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) [[ -f "$TMP_DAEMON_DOWN" ]] && exit 1; exit 0 ;;
  --version) echo 'Docker version 29.7.2' ;;
  inspect)
    case "$*" in
      *State.Running*) echo true ;;
      *Config.Env*) echo "NODE_PORT=${TEST_PORT:-2020}" ;;
      *) echo "" ;;
    esac
    ;;
  exec)
    printf 'docker exec %s\n' "$*" >> "$COMMAND_LOG"
    if [[ "$*" == *activationStatus* ]]; then printf '%s\n' "${TEST_WORKSPACE_STATE:-ACTIVE}"; exit 0; fi
    if [[ "$*" == *psql* ]]; then printf '%s\n' "${TEST_APPS:-}"; fi
    ;;
esac
exit 0
MOCK
chmod +x "$TMP/tools/"* "$TMP/node-tools/"*
export TMP_DAEMON_DOWN="$TMP/daemon-down"

reset() {
  unset TEST_NODE TEST_HEALTH TEST_PORT TEST_APPS TEST_START_FAIL SKIP_DOCKER_INSTALL SKIP_NODE_INSTALL \
    TEST_WORKSPACE_STATE CLEAN_ENV 2>/dev/null || true
  export TEST_APPS=$'f7d814ab-cbfd-48bc-9ee0-06a06daae1a4|Protecta Bode\nc92c1ffa-0652-4380-b82d-1eabb94945f5|Document Generator\nad58822e-4e44-41c2-8e48-ca60f5066f6c|SMS Messaging'
  export PATH="$TMP/bin:$TMP/node-tools:$TMP/tools:/usr/bin:/bin"
  rm -f "$TMP_DAEMON_DOWN"
  rm -rf "$HOME/.twenty-node24"
  : > "$COMMAND_LOG"; : > "$CURL_LOG"
}

run() { bash "$BASE/install.sh" "$@" > "$TMP/out" 2> "$TMP/err"; }

# --- 1. help -----------------------------------------------------------------
reset
if ! run --help; then echo 'Expected --help to succeed'; exit 1; fi
grep -q 'Protecta all-in-one installer' "$TMP/out"
grep -q -- '--skip-prereqs' "$TMP/out"
echo 'PASS --help: prints the installer usage'

# --- 2. everything already present: installs and verifies --------------------
reset
run --port 3030
grep -q 'start.sh --port 3030' "$COMMAND_LOG"
grep -q 'docker exec.*psql.*core.application' "$COMMAND_LOG"
grep -q 'installed: Protecta Bode' "$TMP/out"
grep -q 'installed: Document Generator' "$TMP/out"
grep -q 'installed: SMS Messaging' "$TMP/out"
grep -q 'All 3 apps are installed and registered' "$TMP/out"
grep -q 'Install complete' "$TMP/out"
! grep -q 'apt-get' "$COMMAND_LOG"
! grep -q 'nodejs.org' "$CURL_LOG"
echo 'PASS happy path: provisions nothing, deploys and verifies all three apps'

# --- 3. old system Node: left to the npx bootstrap in start.sh ---------------
reset
export TEST_NODE=old
run
grep -q 'start.sh will re-run under Node 24 via npx' "$TMP/out"
! grep -q 'nodejs.org' "$CURL_LOG"
grep -q 'Install complete' "$TMP/out"
echo 'PASS old Node: defers to the npx bootstrap instead of installing Node'

# --- 4. no Node and no npx: downloads Node 24 --------------------------------
reset
export PATH="$TMP/bin:$TMP/tools:/usr/bin:/bin"   # no node, no npm, no npx
run
grep -q 'Installing Node 24' "$TMP/out"
grep -q 'SHASUMS256.txt' "$CURL_LOG"
grep -q 'node-v24.21.0-linux-x64.tar.gz' "$CURL_LOG"
[[ -x "$HOME/.twenty-node24/bin/node" ]]
grep -q 'node v24.21.0 installed in' "$TMP/out"
grep -q 'start.sh' "$COMMAND_LOG"
echo 'PASS missing Node: downloads Node 24 into the home directory and continues'

# --- 5. Docker missing: installs it and starts the daemon --------------------
reset
export DOCKER_TEMPLATE="$TMP/tools/docker"
cp "$TMP/tools/docker" "$TMP/bin/.docker-template"
export PATH="$TMP/bin:$TMP/node-tools:/usr/bin:/bin"   # no docker on PATH
run
grep -q 'apt-get install -y -qq docker.io' "$COMMAND_LOG"
grep -q 'systemctl enable --now docker' "$COMMAND_LOG"
grep -q 'docker 29.7.2 (daemon up)' "$TMP/out"
grep -q 'Install complete' "$TMP/out"
echo 'PASS missing Docker: installs docker.io, starts the daemon and deploys'

# --- 6. daemon down but installed: starts it and recovers --------------------
reset
touch "$TMP_DAEMON_DOWN"
run
grep -q 'daemon is not reachable; starting it' "$TMP/out"
grep -q 'systemctl enable --now docker' "$COMMAND_LOG"
grep -q 'docker daemon is up' "$TMP/out"
grep -q 'Install complete' "$TMP/out"
echo 'PASS stopped daemon: starts Docker and continues'

# --- 7. a missing app fails the verification --------------------------------
reset
export TEST_APPS=$'f7d814ab-cbfd-48bc-9ee0-06a06daae1a4|Protecta Bode'
if run; then echo 'Expected verification failure'; exit 1; fi
grep -q 'missing:   Document Generator' "$TMP/err"
grep -q 'missing:   SMS Messaging' "$TMP/err"
grep -q '2 app(s) are not registered' "$TMP/err"
grep -q 're-run ./start.sh to retry the sync' "$TMP/err"
echo 'PASS verification: reports the apps that are missing and exits non-zero'

# --- 8. --no-verify and --skip-prereqs ---------------------------------------
reset
run --no-verify --skip-prereqs
grep -q 'Skipping prerequisite provisioning' "$TMP/out"
grep -q 'Skipping verification' "$TMP/out"
! grep -q 'apt-get' "$COMMAND_LOG"
! grep -q 'core.application' "$COMMAND_LOG"
grep -q 'Install complete' "$TMP/out"
echo 'PASS flags: --skip-prereqs and --no-verify trim the run'

# --- 9. bootstrap mode: run from outside a checkout --------------------------
reset
standalone="$TMP/standalone"
mkdir -p "$standalone"
cp "$ROOT/install.sh" "$standalone/install.sh"
export CLONE_TEMPLATE_INSTALL="$ROOT/install.sh" CLONE_TEMPLATE_START="$BASE/start.sh"
target="$TMP/cloned"
bash "$standalone/install.sh" --dir "$target" --branch test-branch > "$TMP/out" 2> "$TMP/err"
grep -q "git clone --depth=1 --single-branch --branch test-branch" "$COMMAND_LOG"
grep -q 're-running the installer from' "$TMP/out"
grep -q 'Install complete' "$TMP/out"
[[ -f "$target/protecta/app/.keep" || -d "$target/protecta/app" ]]
echo 'PASS bootstrap: clones the branch, re-runs itself and installs from there'

# --- 10. re-running is safe --------------------------------------------------
reset
run > /dev/null
run
grep -q 'Install complete' "$TMP/out"
[[ "$(grep -c 'start.sh' "$COMMAND_LOG")" -ge 2 ]]
echo 'PASS idempotent: a second install run succeeds against the same checkout'

# --- 11. --reseed is forwarded to start.sh -----------------------------------
reset
run --port 3030 --reseed
grep -q 'start.sh --port 3030 --reseed' "$COMMAND_LOG"
grep -q 'Install complete' "$TMP/out"
echo 'PASS --reseed: forwarded to start.sh'

# --- 12. a missing app on an unfinished seed points at the repair ------------
reset
export TEST_APPS=$'f7d814ab-cbfd-48bc-9ee0-06a06daae1a4|Protecta Bode' TEST_WORKSPACE_STATE=PENDING_CREATION
if run; then echo 'Expected verification failure'; exit 1; fi
grep -q 'still in PENDING_CREATION' "$TMP/err"
grep -q 'the first-boot seed never finished' "$TMP/err"
grep -q './start.sh --reseed' "$TMP/err"
echo 'PASS verification: an unfinished seed is named as the cause'

# --- 13. --with-caddy tells start.sh the URL browsers use --------------------
# The container is created before Caddy is configured, so the domain has to be
# handed to start.sh: SERVER_URL is what Twenty publishes, and localhost there
# makes a browser call http://localhost:<port>/rest/...
reset
run --port 3030 --with-caddy
grep -q 'start.sh --port 3030 --public-url https://protectabode.weareupsyd.com --apply-public-url' "$COMMAND_LOG"
grep -q 'Install complete' "$TMP/out"
echo 'PASS --with-caddy: the public URL is forwarded to start.sh'

reset
run --port 3030 --with-caddy --domain crm.example.com
grep -q 'start.sh --port 3030 --public-url https://crm.example.com --apply-public-url' "$COMMAND_LOG"
echo 'PASS --domain: the chosen domain is the published URL'

# Without Caddy nothing is guessed: the operator states PUBLIC_URL explicitly.
reset
run --port 3030
grep -q 'start.sh --port 3030' "$COMMAND_LOG"
! grep -q -- '--public-url' "$COMMAND_LOG"
echo 'PASS without Caddy: no public URL is invented'
