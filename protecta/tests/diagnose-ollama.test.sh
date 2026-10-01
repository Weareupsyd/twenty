#!/usr/bin/env bash
# Tests for scripts/diagnose-ollama.sh. Docker is mocked: nothing here touches a
# real container, daemon, network or database. Each case reproduces one way the
# Ollama chain breaks and asserts the script names that link, not another one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
script="$ROOT/scripts/diagnose-ollama.sh"

export COMMAND_LOG="$TMP/commands"
export PATH="$TMP/bin:$PATH"
: > "$COMMAND_LOG"

cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) exit "${TEST_DOCKER_DOWN:-0}" ;;
  ps)
    if [[ "$*" == *'-a'* ]]; then
      printf '%s\n' "${TEST_CONTAINERS:-twenty-app-dev ollama}" | tr ' ' '\n'
    else
      printf '%s\n' "${TEST_RUNNING_CONTAINERS:-twenty-app-dev ollama}" | tr ' ' '\n'
    fi
    exit 0
    ;;
  inspect)
    # docker inspect -f '<format>' <name>
    fmt="$3"; name="${@: -1}"
    case "$fmt" in
      *State.Running*)
        case "$name" in
          ollama) echo "${TEST_OLLAMA_RUNNING:-true}" ;;
          twenty-app-dev) echo "${TEST_TWENTY_RUNNING:-true}" ;;
          *) echo "missing" ;;
        esac
        ;;
      *Config.Env*)
        if [[ "$name" == "ollama" ]]; then exit 0; fi
        printf '%b\n' "${TEST_TWENTY_ENV:-}"
        ;;
      *NetworkSettings.Networks*)
        case "$name" in
          ollama) printf '%b\n' "${TEST_OLLAMA_NETS:-protecta-ai}" ;;
          *) printf '%b\n' "${TEST_TWENTY_NETS:-protecta-ai}" ;;
        esac
        ;;
    esac
    exit 0
    ;;
  exec)
    printf '%s\n' "$*" >> "$COMMAND_LOG"
    if [[ "$*" == *"ollama list"* ]]; then
      printf '%b\n' "${TEST_OLLAMA_LIST:-NAME ID SIZE MODIFIED\nllama3.2:latest abc123 2.0 GB 2 days ago}"
      exit "${TEST_OLLAMA_LIST_FAIL:-0}"
    fi
    if [[ "$*" == *psql* ]]; then
      # The script asks for one key per statement; answer from TEST_DB_<KEY>.
      key="$(printf '%s' "$*" | sed -n "s/.*key='\([A-Z_0-9]*\)'.*/\1/p")"
      [[ -n "$key" ]] || exit 0
      var="TEST_DB_$key"
      printf '%s\n' "${!var:-}"
      exit 0
    fi
    if [[ "$*" == *curl* ]]; then
      printf '%b\n' "${TEST_PROBE_BODY:-{\"data\":[{\"id\":\"llama3.2\"}]}"
      printf '%s\n' "${TEST_PROBE_CODE:-200}"
      exit "${TEST_PROBE_FAIL:-0}"
    fi
    exit 0
    ;;
esac
exit 0
MOCK
chmod +x "$TMP/bin/docker"

# A healthy chain: shared user network, URL in the environment, model pulled,
# tier chains already naming it, 200 from the probe.
healthy_env() {
  export TEST_CONTAINERS="twenty-app-dev ollama"
  export TEST_RUNNING_CONTAINERS="twenty-app-dev ollama"
  export TEST_TWENTY_RUNNING=true TEST_OLLAMA_RUNNING=true
  export TEST_TWENTY_NETS="protecta-ai" TEST_OLLAMA_NETS="protecta-ai"
  export TEST_OLLAMA_LIST=$'NAME ID SIZE MODIFIED\nllama3.2:latest abc123 2.0 GB 2 days ago'
  export TEST_TWENTY_ENV=$'NODE_PORT=2020\nOLLAMA_BASE_URL=http://ollama:11434/v1\nOLLAMA_API_KEY=ollama\nAI_MODELS_DEFAULT_FAST=openai/gpt-5.6-luna@medium,ollama/llama3.2'
  export TEST_PROBE_CODE=200 TEST_PROBE_FAIL=0
  unset TEST_DB_OLLAMA_BASE_URL TEST_DB_AI_PROVIDERS TEST_DB_AI_MODELS_DEFAULT_DISABLED \
        TEST_DB_AI_MODELS_DEFAULT_FAST TEST_DOCKER_DOWN || true
}

run() { bash "$script" "$@" > "$TMP/out" 2> "$TMP/err"; }

# --- a healthy chain exits 0 and points at the UI step ----------------------
healthy_env
if ! run; then
  echo 'Expected a healthy chain to pass'; cat "$TMP/err"; exit 1
fi
grep -q 'Every link in the chain checks out' "$TMP/out"
grep -q 'shared network(s): protecta-ai' "$TMP/out"
grep -q 'HTTP 200' "$TMP/out"
grep -q 'Admin panel > AI' "$TMP/out"
grep -q "'llama3.2' is pulled in Ollama" "$TMP/out"
echo 'PASS healthy: reports the chain intact and the remaining UI step'

# --- the reported case: same network, no URL in the container ---------------
healthy_env
export TEST_TWENTY_ENV=$'NODE_PORT=2020\nENCRYPTION_KEY=secret'
if run; then echo 'Expected a missing base URL to fail'; exit 1; fi
grep -q 'Twenty has no Ollama URL at all' "$TMP/out"
grep -q 'blocker: no-base-url' "$TMP/out"
grep -q 'enable-ollama.sh --pull --apply' "$TMP/out"
grep -q 'Admin panel > Config variables' "$TMP/out"
# A shared network must still be reported as fine: it is not the broken link.
grep -q 'shared network(s): protecta-ai' "$TMP/out"
echo 'PASS no-base-url: names the environment, not the network, as the blocker'

# --- no shared network ------------------------------------------------------
healthy_env
export TEST_TWENTY_NETS="bridge" TEST_OLLAMA_NETS="protecta-ai"
if run; then echo 'Expected no shared network to fail'; exit 1; fi
grep -q 'share no network' "$TMP/out"
grep -q 'blocker: shared-network' "$TMP/out"
grep -q 'docker network connect protecta-ai ollama' "$TMP/out"
grep -q 'docker network connect protecta-ai twenty-app-dev' "$TMP/out"
echo 'PASS shared-network: gives both connect commands'

# --- only the default bridge: names do not resolve there --------------------
healthy_env
export TEST_TWENTY_NETS="bridge" TEST_OLLAMA_NETS="bridge"
export TEST_DB_OLLAMA_BASE_URL='"http://ollama:11434/v1"'
run || true
grep -q "only the default 'bridge' is shared" "$TMP/out"
grep -q 'do NOT resolve there' "$TMP/out"
echo 'PASS bridge-only: warns that container-name DNS will not work'

# --- missing /v1 suffix answers 404 ----------------------------------------
healthy_env
export TEST_TWENTY_ENV=$'NODE_PORT=2020\nOLLAMA_BASE_URL=http://ollama:11434'
export TEST_PROBE_CODE=404 TEST_PROBE_BODY='404 page not found'
if run; then echo 'Expected a 404 probe to fail'; exit 1; fi
grep -q 'no /v1 suffix' "$TMP/out"
grep -q 'blocker: bad-path' "$TMP/out"
grep -q 'http://ollama:11434/v1' "$TMP/out"
echo 'PASS bad-path: a 404 is read as the missing /v1 suffix'

# --- localhost means the Twenty container itself ----------------------------
healthy_env
export TEST_TWENTY_ENV=$'NODE_PORT=2020\nOLLAMA_BASE_URL=http://127.0.0.1:11434/v1'
export TEST_PROBE_CODE=000 TEST_PROBE_BODY='curl: (7) Failed to connect to 127.0.0.1 port 11434' TEST_PROBE_FAIL=1
run || true
grep -q 'means the Twenty container itself' "$TMP/out"
grep -q 'host.docker.internal' "$TMP/out"
echo 'PASS loopback: explains why 127.0.0.1 cannot reach Ollama'

# --- Ollama running with nothing pulled ------------------------------------
healthy_env
export TEST_OLLAMA_LIST=$'NAME ID SIZE MODIFIED'
if run; then echo 'Expected an empty model list to fail'; exit 1; fi
grep -q 'has no model pulled' "$TMP/out"
grep -q 'blocker: ollama-model-pulled' "$TMP/out"
grep -q 'ollama pull llama3.2' "$TMP/out"
echo 'PASS no-model: tells the operator to pull one'

# --- a different model than the one pulled ---------------------------------
healthy_env
if run --model qwen2.5; then echo 'Expected an unpulled model to fail'; exit 1; fi
grep -q "'qwen2.5' is not among Ollama's models" "$TMP/out"
grep -q 'blocker: model-missing' "$TMP/out"
echo 'PASS --model: checks the model that was asked for'

# --- the database copy overrides the container environment ------------------
healthy_env
export TEST_DB_OLLAMA_BASE_URL='"http://host.docker.internal:11434/v1"'
run || true
grep -q 'database (Admin panel > Config variables)' "$TMP/out"
grep -q 'overrides OLLAMA_BASE_URL=http://ollama:11434/v1' "$TMP/out"
grep -q 'http://host.docker.internal:11434/v1/models' "$TMP/out"
echo 'PASS precedence: a database value is reported as the one in effect'

# --- AI_PROVIDERS is read when OLLAMA_BASE_URL is absent --------------------
healthy_env
export TEST_TWENTY_ENV=$'NODE_PORT=2020\nAI_PROVIDERS={"ollama":{"npm":"@ai-sdk/openai-compatible","baseUrl":"http://ollama:11434/v1","apiKey":"ollama","models":[{"name":"llama3.2"}]}}'
if ! run; then cat "$TMP/err"; echo 'Expected AI_PROVIDERS alone to be enough'; exit 1; fi
grep -q 'AI_PROVIDERS.ollama.baseUrl' "$TMP/out"
echo 'PASS AI_PROVIDERS: the published-image path is recognised'

# --- switched off from the admin panel -------------------------------------
healthy_env
export TEST_DB_AI_MODELS_DEFAULT_DISABLED='["ollama/llama3.2"]'
if run; then echo 'Expected a disabled model to fail'; exit 1; fi
grep -q 'switched off in AI_MODELS_DEFAULT_DISABLED' "$TMP/out"
grep -q 'blocker: model-disabled' "$TMP/out"
echo 'PASS disabled: an admin-panel toggle is caught'

# --- no tier chain names ollama --------------------------------------------
healthy_env
export TEST_TWENTY_ENV=$'NODE_PORT=2020\nOLLAMA_BASE_URL=http://ollama:11434/v1\nAI_MODELS_DEFAULT_FAST=openai/gpt-5.6-luna@medium'
run || true
grep -q 'no tier chain names an ollama/ model' "$TMP/out"
echo 'PASS chains: warns when Ask AI would never fall back to Ollama'

# --- Ollama container missing entirely -------------------------------------
healthy_env
export TEST_CONTAINERS="twenty-app-dev" TEST_RUNNING_CONTAINERS="twenty-app-dev"
if run; then echo 'Expected a missing Ollama container to fail'; exit 1; fi
grep -q "no container named 'ollama' exists" "$TMP/out"
grep -q 'blocker: ollama-container' "$TMP/out"
grep -q 'ollama/ollama:latest' "$TMP/out"
echo 'PASS missing-container: stops early with the run command'

# --- docker daemon unreachable ---------------------------------------------
healthy_env
export TEST_DOCKER_DOWN=1
if run; then echo 'Expected an unreachable daemon to fail'; exit 1; fi
grep -q 'docker daemon is not reachable' "$TMP/out"
echo 'PASS docker-down: fails before inspecting anything'

# --- --help ----------------------------------------------------------------
bash "$script" --help > "$TMP/out" 2>&1
grep -q 'diagnose-ollama.sh' "$TMP/out"
grep -q 'TWENTY_CONTAINER' "$TMP/out"
echo 'PASS --help: prints the header usage block'

# --- the diagnostic never mutates anything --------------------------------
healthy_env
: > "$COMMAND_LOG"
run > /dev/null 2>&1 || true
if grep -Eq 'docker (run|start|stop|rm|rename|network (create|connect))' "$COMMAND_LOG"; then
  echo 'Expected a read-only diagnostic'; cat "$COMMAND_LOG"; exit 1
fi
echo 'PASS read-only: only inspect, exec and ps were issued'

printf '\nAll diagnose-ollama tests passed.\n'
