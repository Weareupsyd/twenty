#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/protecta/app/node_modules/.bin"
cp "$ROOT/start.sh" "$TMP/protecta/start.sh"
export COMMAND_LOG="$TMP/commands" CURL_COUNT="$TMP/curl-count"
export TWENTY_API_KEY=test-only SKIP_INSTALL=1
export PATH="$TMP/bin:$PATH"
cat > "$TMP/bin/node" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "-v" ]]; then echo "v${TEST_NODE_MAJOR:-24}.10.0"; exit 0; fi
[[ "${TEST_NODE_MAJOR:-24}" == 24 ]]
MOCK
cat > "$TMP/bin/npm" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) exit 0;;
  --version) echo 'Docker version 29.0.0';;
  inspect) echo "${TEST_RUNNING:-true}";;
esac
MOCK
cat > "$TMP/bin/curl" <<'MOCK'
#!/usr/bin/env bash
count="$(cat "$CURL_COUNT" 2>/dev/null || echo 0)"
echo "$((count + 1))" > "$CURL_COUNT"
if [[ "${TEST_COLD:-0}" == 1 && "$count" == 0 ]]; then exit 7; fi
echo '{"status":"ok"}'
MOCK
cat > "$TMP/protecta/app/node_modules/.bin/twenty" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COMMAND_LOG"
if [[ "$1" == docker:start ]]; then exit 1; fi
exit 0
MOCK
chmod +x "$TMP/bin/"* "$TMP/protecta/app/node_modules/.bin/twenty"
run() { bash "$TMP/protecta/start.sh" --port 3030 > "$TMP/output" 2>&1; }

run
grep -q 'remote:add --url http://localhost:3030 --as protecta-local' "$COMMAND_LOG"
grep -q '^apply ' "$COMMAND_LOG"
! grep -q 'docker:start' "$COMMAND_LOG"
echo 'PASS healthy server: uses selected port and syncs'

: > "$COMMAND_LOG"; rm -f "$CURL_COUNT"
export TEST_COLD=1
run
grep -q 'docker:start --port 3030' "$COMMAND_LOG"
grep -q 'allowing extra time' "$TMP/output"
grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS initial timeout: waits for running container and continues'

: > "$COMMAND_LOG"; rm -f "$CURL_COUNT"
export TEST_RUNNING=false
if run; then echo 'Expected stopped-container failure'; exit 1; fi
! grep -q '^apply ' "$COMMAND_LOG"
echo 'PASS stopped container: does not sync'

export TEST_NODE_MAJOR=20
if run; then echo 'Expected unsupported Node failure'; exit 1; fi
grep -q 'requires Node 24.5+' "$TMP/output"
echo 'PASS rejects unsupported Node'
