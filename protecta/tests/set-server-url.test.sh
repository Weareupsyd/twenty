#!/usr/bin/env bash
# Tests for scripts/set-server-url.sh. Docker and curl are mocked: nothing here
# touches a real container, daemon or network. Each case reproduces one way the
# published SERVER_URL goes wrong and asserts the script repairs exactly that.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
script="$ROOT/scripts/set-server-url.sh"

export COMMAND_LOG="$TMP/commands"
export PATH="$TMP/bin:$PATH"

cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$COMMAND_LOG"
case "$1" in
  info) exit "${TEST_DOCKER_DOWN:-0}" ;;
  ps) printf '%s\n' "${TEST_CONTAINERS:-twenty-app-dev}" | tr ' ' '\n'; exit 0 ;;
  inspect)
    fmt="$3"; name="${@: -1}"
    case "$fmt" in
      *Config.Env*)
        [[ "$name" == twenty-app-dev* ]] || exit 0
        printf '%b\n' "${TEST_TWENTY_ENV:-SERVER_URL=http://localhost:2020\nNODE_PORT=2020\nPATH=/usr/bin}"
        ;;
      *Config.Image*) echo "${TEST_IMAGE:-twentycrm/twenty-app-dev:latest}" ;;
      *NetworkSettings.Ports*) echo "${TEST_PORT:-2020}" ;;
      *NetworkSettings.Networks*) printf '%b\n' "${TEST_NETS:-bridge\nprotecta-ai}" ;;
      *RestartPolicy.Name*) echo "${TEST_RESTART:-unless-stopped}" ;;
      *HostConfig.Binds*) printf '%b\n' "${TEST_BINDS:-twenty-app-dev-data:/data/postgres}" ;;
      *HostConfig.ExtraHosts*) printf '%b\n' "${TEST_EXTRA_HOSTS:-}" ;;
    esac
    exit 0
    ;;
  run) exit "${TEST_RUN_FAILS:-0}" ;;
  *) exit 0 ;;
esac
MOCK

cat > "$TMP/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$COMMAND_LOG"
[[ "${TEST_HEALTHY:-1}" == 1 ]] || exit 7
echo '{"status":"ok"}'
MOCK

# The health wait polls for up to three minutes; keep the test instant.
cat > "$TMP/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK

chmod +x "$TMP/bin/docker" "$TMP/bin/curl" "$TMP/bin/sleep"

run() { bash "$script" "$@" > "$TMP/output" 2>&1; }
reset_env() {
  unset TEST_DOCKER_DOWN TEST_CONTAINERS TEST_TWENTY_ENV TEST_IMAGE TEST_PORT \
    TEST_NETS TEST_RESTART TEST_BINDS TEST_EXTRA_HOSTS TEST_RUN_FAILS TEST_HEALTHY \
    PUBLIC_URL PUBLIC_BASE_URL 2>/dev/null || true
  : > "$COMMAND_LOG"
}

# 1. Without --apply it reports and changes nothing ---------------------------
# A container keeps the environment it was created with, so the script has to
# say that a recreate is needed instead of pretending the change took effect.
reset_env
run --url https://crm.example.com
grep -q 'Publishes now:  http://localhost:2020' "$TMP/output"
grep -q 'Should publish: https://crm.example.com' "$TMP/output"
grep -q -- '--url https://crm.example.com --apply' "$TMP/output"
! grep -q '^docker run' "$COMMAND_LOG"
! grep -q '^docker stop' "$COMMAND_LOG"
! grep -q '^docker rename' "$COMMAND_LOG"
echo 'PASS no --apply: reports the mismatch and changes nothing'

# 2. --apply recreates the container with the public URL ----------------------
# Everything else — image, port, volumes, networks, restart policy and the other
# environment variables such as Ollama's — has to survive the recreate.
reset_env
export TEST_TWENTY_ENV='SERVER_URL=http://localhost:2020\nNODE_PORT=2020\nOLLAMA_BASE_URL=http://ollama:11434/v1\nPATH=/usr/bin'
run --url https://crm.example.com --apply
grep -q '^docker stop twenty-app-dev$' "$COMMAND_LOG"
grep -q '^docker rename twenty-app-dev twenty-app-dev-before-server-url$' "$COMMAND_LOG"
run_line="$(grep '^docker run' "$COMMAND_LOG")"
[[ "$run_line" == *'-e SERVER_URL=https://crm.example.com'* ]]
[[ "$run_line" == *'-e OLLAMA_BASE_URL=http://ollama:11434/v1'* ]]
[[ "$run_line" != *'NODE_PORT=http://localhost'* ]]
[[ "$run_line" == *'-v twenty-app-dev-data:/data/postgres'* ]]
[[ "$run_line" == *'--restart unless-stopped'* ]]
[[ "$run_line" == *'-p 2020:2020'* ]]
[[ "$run_line" == *'--network bridge'* ]]
[[ "$run_line" == *'twentycrm/twenty-app-dev:latest'* ]]
grep -q '^docker network connect protecta-ai twenty-app-dev$' "$COMMAND_LOG"
grep -q '^docker rm twenty-app-dev-before-server-url$' "$COMMAND_LOG"
grep -q 'now publishes https://crm.example.com' "$TMP/output"
echo 'PASS --apply: recreates with the public URL and keeps the rest'

# 3. An unreachable new container is rolled back ------------------------------
reset_env
export TEST_RUN_FAILS=1
if run --url https://crm.example.com --apply; then
  echo 'expected a failure when the new container does not start' >&2
  exit 1
fi
grep -q '^docker rm -f twenty-app-dev$' "$COMMAND_LOG"
grep -q '^docker rename twenty-app-dev-before-server-url twenty-app-dev$' "$COMMAND_LOG"
grep -q '^docker start twenty-app-dev$' "$COMMAND_LOG"
grep -q 'Restoring the previous one' "$TMP/output"
echo 'PASS failed recreate: the previous container is restored'

# 4. A container that never became healthy is left for inspection -------------
reset_env
export TEST_HEALTHY=0
if run --url https://crm.example.com --apply; then
  echo 'expected a failure when the new container stays unhealthy' >&2
  exit 1
fi
! grep -q '^docker rm twenty-app-dev-before-server-url$' "$COMMAND_LOG"
grep -q 'did not become healthy' "$TMP/output"
grep -q 'twenty-app-dev-before-server-url' "$TMP/output"
echo 'PASS unhealthy recreate: keeps the backup and explains the rollback'

# 5. The right URL already set is a no-op -------------------------------------
reset_env
export TEST_TWENTY_ENV='SERVER_URL=https://crm.example.com\nNODE_PORT=2020'
run --url https://crm.example.com
grep -q 'Nothing to do' "$TMP/output"
! grep -q '^docker stop' "$COMMAND_LOG"
echo 'PASS already published: nothing is recreated'

# 6. A URL with a path or a missing container is refused ----------------------
reset_env
if run --url https://crm.example.com/twenty; then
  echo 'expected a path URL to be refused' >&2
  exit 1
fi
grep -q 'expected http(s)://host' "$TMP/output"

reset_env
export TEST_CONTAINERS='something-else'
if run --url https://crm.example.com; then
  echo 'expected a missing container to be reported' >&2
  exit 1
fi
grep -q 'Container twenty-app-dev does not exist' "$TMP/output"
grep -q 'PUBLIC_URL=https://crm.example.com ./start.sh' "$TMP/output"
echo 'PASS bad input: refuses a path URL and a missing container'

# 7. The Caddyfile supplies the domain only where Caddy is installed ----------
# The committed Caddyfile is a template in every checkout, so a development
# machine must not publish the production domain from it.
reset_env
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/bin/caddy"
chmod +x "$TMP/bin/caddy"
run
grep -q 'Should publish: https://protectabode.weareupsyd.com' "$TMP/output"
rm -f "$TMP/bin/caddy"

reset_env
if run; then
  echo 'expected no target URL without Caddy installed' >&2
  exit 1
fi
grep -q 'No target URL' "$TMP/output"
echo 'PASS no --url: the Caddyfile is used with Caddy, refused without it'

# 8. PUBLIC_URL from the environment is honoured ------------------------------
reset_env
export PUBLIC_URL='http://203.0.113.10:2020/'
run
grep -q 'Should publish: http://203.0.113.10:2020' "$TMP/output"
echo 'PASS PUBLIC_URL: trailing slash dropped and used as the target'

# 9. CADDYFILE points at another site file ------------------------------------
reset_env
printf 'crm.other.example {\n    reverse_proxy localhost:2020\n}\n' > "$TMP/Caddyfile"
CADDYFILE="$TMP/Caddyfile" run
grep -q 'Should publish: https://crm.other.example' "$TMP/output"
echo 'PASS CADDYFILE: an explicit site file is read without Caddy installed'
