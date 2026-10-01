#!/usr/bin/env bash
# diagnose-ollama.sh — find out why Twenty cannot use an Ollama that is already
# running. Read-only: nothing is pulled, started, connected, recreated or
# written to the database.
#
#   ./scripts/diagnose-ollama.sh
#   ./scripts/diagnose-ollama.sh --model qwen2.5
#   TWENTY_CONTAINER=twenty-app-dev OLLAMA_CONTAINER=ollama ./scripts/diagnose-ollama.sh
#
# Sharing a Docker network is not what turns Ollama on. Twenty offers Ollama
# models only when it can read a base URL — OLLAMA_BASE_URL, an AI_PROVIDERS
# "ollama" entry, or a value saved from Admin panel > Config variables — and an
# environment can only be given to a container when that container is created.
# This walks the whole chain, from the Ollama daemon to the model a tier would
# resolve to, and names the first broken link with the command that repairs it.
#
# Environment:
#   TWENTY_CONTAINER   Twenty container name   (default: twenty-app-dev)
#   OLLAMA_CONTAINER   Ollama container name   (default: ollama)
#   OLLAMA_MODEL       model to expect         (default: llama3.2)
#   OLLAMA_NETWORK     network to expect both on (default: protecta-ai)

# No -e on purpose: a diagnostic has to keep going past the first failure so it
# can report the whole chain instead of stopping at the link that broke.
set -uo pipefail

CONTAINER="${TWENTY_CONTAINER:-twenty-app-dev}"
OLLAMA_CONTAINER="${OLLAMA_CONTAINER:-ollama}"
MODEL="${OLLAMA_MODEL:-llama3.2}"
NETWORK="${OLLAMA_NETWORK:-protecta-ai}"

BOLD=$'\033[1m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
RESET=$'\033[0m'

# A diagnostic gets pasted into tickets and CI logs, where escape codes are
# noise; keep them only for a terminal that asked for colour.
if [[ ! -t 1 || -n "${NO_COLOR:-}" ]]; then
  BOLD="" RED="" GREEN="" YELLOW="" BLUE="" RESET=""
fi

# The first check that fails is the one to fix; everything after it is reported
# but cannot be trusted until it passes.
BLOCKER=""
FAILURES=0
PREREQ_FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --model=*) MODEL="${1#*=}"; shift ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --container=*) CONTAINER="${1#*=}"; shift ;;
    --ollama-container) OLLAMA_CONTAINER="$2"; shift 2 ;;
    --ollama-container=*) OLLAMA_CONTAINER="${1#*=}"; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n%s==>%s %s\n' "$BLUE$BOLD" "$RESET" "$*"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %sPASS%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '    %sWARN%s %s\n' "$YELLOW" "$RESET" "$*"; }
bad()  { printf '    %sFAIL%s %s\n' "$RED" "$RESET" "$*"; }
fix()  { printf '         %sfix:%s %s\n' "$YELLOW$BOLD" "$RESET" "$*"; }

# Records a failure and remembers the first one as the blocker.
fail() {
  bad "$1"
  FAILURES=$((FAILURES + 1))
  [[ -n "$BLOCKER" ]] || BLOCKER="$2"
}

# A prerequisite failure: the rest of the chain cannot be measured at all until
# both containers exist and run, so the script stops here instead of reporting
# guesses about a URL it could never probe.
hard_fail() {
  fail "$1" "$2"
  PREREQ_FAILED=1
}

container_exists() { docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$1"; }
container_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }
container_env() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null; }
container_networks() {
  docker inspect -f '{{range $name, $conf := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$1" 2>/dev/null
}

env_value() {
  local container="$1" key="$2"
  container_env "$container" | sed -n "s/^${key}=//p" | head -n 1
}

# One SQL statement inside the Twenty container; rows come back '|'-separated.
# Best-effort: an image without psql, or a database that is still starting, just
# yields nothing and the caller reports that the check was skipped.
container_sql() {
  docker exec -e PGPASSWORD=twenty -w /app/packages/twenty-server "$CONTAINER" \
    sh -c 'psql -h localhost -U twenty -d default -tA -F "|" -c "$1"' _ "$1" 2>/dev/null || true
}

# A config variable as the server reads it: the database copy wins over the
# environment, which is why a value saved from the admin panel can silently
# override what the container was created with.
db_config_value() {
  container_sql \
    "SELECT value::text FROM core.\"keyValuePair\" WHERE type='CONFIG_VARIABLE' AND \"deletedAt\" IS NULL AND \"workspaceId\" IS NULL AND \"userId\" IS NULL AND key='$1' LIMIT 1" \
    | head -n 1 | sed -e 's/^"//' -e 's/"$//'
}

# HTTP GET from inside a container, printing the body followed by the status
# code on its own last line. curl first (the published image ships it for its
# healthcheck), node's fetch as the fallback.
probe_from_container() {
  local container="$1" url="$2"
  docker exec "$container" sh -c \
    'curl -sS --max-time 8 -w "\n%{http_code}" "$1" 2>&1' _ "$url" 2>&1 && return 0
  docker exec "$container" node -e \
    'fetch(process.argv[1]).then(async (r) => { const t = await r.text(); console.log(t.slice(0, 300)); console.log(r.status); }).catch((e) => { console.log(String(e && e.cause ? e.cause.message : e)); console.log("000"); })' \
    "$url" 2>&1 || printf 'probe could not run\n000\n'
}

last_line() { printf '%s' "$1" | tail -n 1; }

# --- 1. Docker ---------------------------------------------------------------
step "Docker"
if ! command -v docker >/dev/null 2>&1; then
  fail "docker is not installed or not on PATH" "docker"
elif ! docker info >/dev/null 2>&1; then
  fail "the docker daemon is not reachable (try sudo, or check the service)" "docker"
else
  ok "docker daemon is reachable"
fi

if (( FAILURES )); then
  printf '\n%sCannot continue without Docker.%s\n' "$RED$BOLD" "$RESET"
  exit 1
fi

# --- 2. The Ollama daemon ----------------------------------------------------
step "Ollama container '$OLLAMA_CONTAINER'"
if ! container_exists "$OLLAMA_CONTAINER"; then
  hard_fail "no container named '$OLLAMA_CONTAINER' exists" "ollama-container"
  info "running containers: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
  fix "docker run -d --name $OLLAMA_CONTAINER --restart unless-stopped -p 11434:11434 -v ollama-data:/root/.ollama ollama/ollama:latest"
  fix "or set OLLAMA_CONTAINER=<name> if yours is called something else"
elif ! container_running "$OLLAMA_CONTAINER"; then
  hard_fail "'$OLLAMA_CONTAINER' exists but is not running" "ollama-running"
  fix "docker start $OLLAMA_CONTAINER"
else
  ok "'$OLLAMA_CONTAINER' is running"
fi

OLLAMA_MODELS=""
if container_running "$OLLAMA_CONTAINER"; then
  # `ollama list` prints a header line; names such as `llama3.2:latest` are in
  # the first column. `-q` is not used because older daemons do not have it.
  OLLAMA_MODELS="$(docker exec "$OLLAMA_CONTAINER" ollama list 2>/dev/null | awk 'NR>1 && NF {print $1}')"
  if [[ -z "$OLLAMA_MODELS" ]]; then
    fail "Ollama is running but has no model pulled, so every request 404s" "ollama-model-pulled"
    fix "docker exec $OLLAMA_CONTAINER ollama pull $MODEL"
  else
    ok "models available: $(printf '%s' "$OLLAMA_MODELS" | tr '\n' ' ')"
  fi
fi

# --- 3. The Twenty container -------------------------------------------------
step "Twenty container '$CONTAINER'"
if ! container_exists "$CONTAINER"; then
  hard_fail "no container named '$CONTAINER' exists" "twenty-container"
  info "running containers: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
  fix "start Twenty first (./start.sh), or set TWENTY_CONTAINER=<name>"
elif ! container_running "$CONTAINER"; then
  hard_fail "'$CONTAINER' exists but is not running" "twenty-running"
  fix "docker start $CONTAINER   # then: docker logs --tail 200 $CONTAINER"
else
  ok "'$CONTAINER' is running"
fi

if (( PREREQ_FAILED )); then
  printf '\n%sFirst blocker:%s %s%s%s\n' "$RED$BOLD" "$RESET" "$BOLD" "$BLOCKER" "$RESET"
  printf 'A container is missing or stopped, so nothing downstream could be measured.\n'
  printf 'Fix that first, then re-run this script.\n'
  exit 1
fi

# --- 4. Shared network -------------------------------------------------------
step "Network path between the two containers"
TWENTY_NETS="$(container_networks "$CONTAINER")"
OLLAMA_NETS="$(container_networks "$OLLAMA_CONTAINER")"
SHARED_NETS="$(comm -12 <(printf '%s' "$TWENTY_NETS" | sort -u) <(printf '%s' "$OLLAMA_NETS" | sort -u))"

info "twenty networks: $(printf '%s' "$TWENTY_NETS" | tr '\n' ' ')"
info "ollama networks: $(printf '%s' "$OLLAMA_NETS" | tr '\n' ' ')"

if [[ -n "$SHARED_NETS" ]]; then
  ok "shared network(s): $(printf '%s' "$SHARED_NETS" | tr '\n' ' ')"
  if ! printf '%s' "$SHARED_NETS" | grep -qx "bridge"; then
    # Container-name DNS only works on a user-defined network, which is what
    # makes http://ollama:11434 resolve at all.
    ok "a user-defined network is shared, so the name '$OLLAMA_CONTAINER' resolves by DNS"
  else
    warn "only the default 'bridge' is shared: container names do NOT resolve there"
    fix "docker network create $NETWORK && docker network connect $NETWORK $OLLAMA_CONTAINER && docker network connect $NETWORK $CONTAINER"
  fi
else
  fail "the containers share no network, so no hostname or IP route exists between them" "shared-network"
  fix "docker network create $NETWORK"
  fix "docker network connect $NETWORK $OLLAMA_CONTAINER"
  fix "docker network connect $NETWORK $CONTAINER"
fi

# --- 5. Does Twenty know the URL? -------------------------------------------
step "Ollama base URL as Twenty reads it"
ENV_BASE_URL="$(env_value "$CONTAINER" OLLAMA_BASE_URL)"
ENV_PROVIDERS="$(env_value "$CONTAINER" AI_PROVIDERS)"
DB_BASE_URL=""
DB_PROVIDERS=""

if container_running "$CONTAINER"; then
  DB_BASE_URL="$(db_config_value OLLAMA_BASE_URL)"
  DB_PROVIDERS="$(db_config_value AI_PROVIDERS)"
fi

BASE_URL=""
BASE_URL_SOURCE=""

# The database copy wins over the environment, mirroring TwentyConfigService.get.
if [[ -n "$DB_BASE_URL" ]]; then
  BASE_URL="$DB_BASE_URL"
  BASE_URL_SOURCE="database (Admin panel > Config variables)"
elif [[ -n "$ENV_BASE_URL" ]]; then
  BASE_URL="$ENV_BASE_URL"
  BASE_URL_SOURCE="container environment OLLAMA_BASE_URL"
fi

# AI_PROVIDERS carries its own ollama entry, which is what the published image
# uses; it is a fallback here, and an override if it is the only source.
providers_ollama_url() {
  local json="$1"
  command -v python3 >/dev/null 2>&1 || return 0
  printf '%s' "$json" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ollama = data.get("ollama") if isinstance(data, dict) else None
if isinstance(ollama, dict) and ollama.get("baseUrl"):
    print(ollama["baseUrl"])
' 2>/dev/null
}

PROVIDERS_URL=""
if [[ -n "$DB_PROVIDERS" ]]; then
  PROVIDERS_URL="$(providers_ollama_url "$DB_PROVIDERS")"
elif [[ -n "$ENV_PROVIDERS" ]]; then
  PROVIDERS_URL="$(providers_ollama_url "$ENV_PROVIDERS")"
fi

if [[ -z "$BASE_URL" && -n "$PROVIDERS_URL" ]]; then
  BASE_URL="$PROVIDERS_URL"
  if [[ -n "$DB_PROVIDERS" ]]; then
    BASE_URL_SOURCE="database AI_PROVIDERS.ollama.baseUrl"
  else
    BASE_URL_SOURCE="container environment AI_PROVIDERS.ollama.baseUrl"
  fi
fi

if [[ -n "$BASE_URL" ]]; then
  ok "base URL: $BASE_URL"
  info "source: $BASE_URL_SOURCE"
  if [[ -n "$PROVIDERS_URL" && -n "$BASE_URL" && "$PROVIDERS_URL" != "$BASE_URL" ]]; then
    warn "AI_PROVIDERS also names a different URL ($PROVIDERS_URL); $BASE_URL_SOURCE wins"
  fi
  if [[ -n "$DB_BASE_URL" && -n "$ENV_BASE_URL" && "$DB_BASE_URL" != "$ENV_BASE_URL" ]]; then
    warn "the database value overrides OLLAMA_BASE_URL=$ENV_BASE_URL from the container environment"
  fi
else
  fail "Twenty has no Ollama URL at all — this is the usual reason 'same network' is not enough" "no-base-url"
  info "checked: env OLLAMA_BASE_URL, env AI_PROVIDERS, and core.\"keyValuePair\" in the database"
  fix "./enable-ollama.sh --pull --apply    # recreates $CONTAINER with the URL, keeping volumes and data"
  fix "or, without recreating anything: Settings > Admin panel > Config variables > search OLLAMA_BASE_URL > set http://$OLLAMA_CONTAINER:11434/v1"
fi

# --- 6. Is the URL one that works from inside a container? -------------------
if [[ -n "$BASE_URL" ]]; then
  step "URL shape"
  case "$BASE_URL" in
    */v1|*/v1/) ok "the OpenAI-compatible /v1 suffix is present" ;;
    *)
      warn "no /v1 suffix: @ai-sdk/openai-compatible would POST to $BASE_URL/chat/completions"
      fix "use ${BASE_URL%/}/v1"
      ;;
  esac

  BASE_HOST="$(printf '%s' "$BASE_URL" | sed -e 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##' -e 's#[:/].*$##')"
  case "$BASE_HOST" in
    localhost|127.0.0.1|\[::1\])
      warn "host '$BASE_HOST' means the Twenty container itself, not the machine running Ollama"
      fix "use http://$OLLAMA_CONTAINER:11434/v1 when both are on a shared Docker network"
      fix "or http://host.docker.internal:11434/v1 when Ollama runs on the host (needs --add-host=host.docker.internal:host-gateway)"
      ;;
    "$OLLAMA_CONTAINER")
      ok "host '$BASE_HOST' is the Ollama container name"
      ;;
    *)
      info "host '$BASE_HOST' is not the container name; it must be reachable from inside $CONTAINER"
      ;;
  esac
fi

# --- 7. Can Twenty actually reach it? ---------------------------------------
if [[ -n "$BASE_URL" ]]; then
  step "HTTP probe from inside '$CONTAINER'"
  PROBE_URL="${BASE_URL%/}/models"
  info "GET $PROBE_URL"
  PROBE_OUT="$(probe_from_container "$CONTAINER" "$PROBE_URL")"
  PROBE_CODE="$(last_line "$PROBE_OUT")"
  PROBE_BODY="$(printf '%s' "$PROBE_OUT" | head -c 300)"

  if [[ "$PROBE_CODE" == "200" ]]; then
    ok "HTTP 200 — Twenty can list Ollama's models"
    info "$(printf '%s' "$PROBE_BODY" | tr -d '\n' | head -c 200)"
  elif [[ "$PROBE_CODE" == "000" || "$PROBE_CODE" == "probe could not run" ]]; then
    fail "the request never completed: $PROBE_BODY" "unreachable"
    fix "check the shared network (step above) and that Ollama listens on 0.0.0.0 inside its container"
    fix "docker exec $OLLAMA_CONTAINER ollama ps"
  elif [[ "$PROBE_CODE" == "404" ]]; then
    fail "HTTP 404 from $PROBE_URL — Ollama answered but has no such route" "bad-path"
    fix "the base URL almost certainly needs the /v1 suffix: ${BASE_URL%/}/v1"
  else
    fail "HTTP $PROBE_CODE from Ollama: $PROBE_BODY" "http-$PROBE_CODE"
  fi
fi

# --- 8. Is the model a tier would resolve to actually there? ----------------
step "Model '$MODEL' and the tier chains"
MODEL_BASE="${MODEL%%:*}"
if [[ -n "$OLLAMA_MODELS" ]]; then
  if printf '%s' "$OLLAMA_MODELS" | sed 's/:.*$//' | grep -qx "$MODEL_BASE"; then
    ok "'$MODEL' is pulled in Ollama"
  else
    fail "'$MODEL' is not among Ollama's models ($(printf '%s' "$OLLAMA_MODELS" | tr '\n' ' '))" "model-missing"
    fix "docker exec $OLLAMA_CONTAINER ollama pull $MODEL"
  fi
fi

CHAIN_VARS=(AI_MODELS_DEFAULT_EXTRA_FAST AI_MODELS_DEFAULT_FAST AI_MODELS_DEFAULT_BALANCED AI_MODELS_DEFAULT_SMART AI_MODELS_DEFAULT_EXTRA_SMART)
CHAIN_HITS=""
for var in "${CHAIN_VARS[@]}"; do
  chain="$(env_value "$CONTAINER" "$var")"
  [[ -n "$chain" ]] || chain="$(db_config_value "$var")"
  if printf '%s' "$chain" | grep -q "ollama/"; then
    CHAIN_HITS="${CHAIN_HITS}${var}: ${chain}\n"
  fi
done

if [[ -n "$CHAIN_HITS" ]]; then
  ok "tier chains already name an ollama model:"
  printf '%b' "$CHAIN_HITS" | sed 's/^/         /'
else
  warn "no tier chain names an ollama/ model, so Ask AI will not pick it up as a fallback"
  info "a server built from this repo defaults every tier to ending with ollama/llama3.2;"
  info "the published image's compiled chains may not, which is why enable-ollama.sh sets them."
  fix "./enable-ollama.sh --apply"
  fix "or Settings > Admin panel > AI > pick $MODEL as the default for a tier"
fi

DISABLED="$(db_config_value AI_MODELS_DEFAULT_DISABLED)"
DISABLED="${DISABLED:-$(env_value "$CONTAINER" AI_MODELS_DEFAULT_DISABLED)}"
if [[ -n "$DISABLED" ]] && printf '%s' "$DISABLED" | grep -q "ollama/"; then
  fail "an ollama model is switched off in AI_MODELS_DEFAULT_DISABLED: $DISABLED" "model-disabled"
  fix "Settings > Admin panel > AI > enable it again"
elif [[ -n "$DISABLED" ]]; then
  info "AI_MODELS_DEFAULT_DISABLED is set but holds no ollama model: $DISABLED"
else
  ok "no ollama model is disabled by AI_MODELS_DEFAULT_DISABLED"
fi

# --- Summary ----------------------------------------------------------------
printf '\n%s======== summary ========%s\n' "$BOLD" "$RESET"
if (( ! FAILURES )); then
  printf '%sEvery link in the chain checks out.%s\n' "$GREEN$BOLD" "$RESET"
  printf 'The last step is in the UI, which this script cannot see:\n'
  printf '  1. Settings > Admin panel > AI\n'
  printf '  2. confirm Ollama is listed as a provider\n'
  printf '  3. enable %s and set it as the default model for a tier\n' "$MODEL"
  printf 'If the provider is listed but no model appears, the browser is on a different\n'
  printf 'workspace than the deployment, or the signed-in user lacks admin rights.\n'
  exit 0
fi

printf '%s%d check(s) failed.%s\n' "$RED$BOLD" "$FAILURES" "$RESET"
printf '%sFirst blocker:%s %s\n' "$BOLD" "$RESET" "$BLOCKER"
case "$BLOCKER" in
  no-base-url)
    printf '\nSame network only makes Ollama reachable. Twenty still has to be told the URL,\n'
    printf 'and a container environment cannot be edited in place:\n'
    printf '  %s./enable-ollama.sh --pull --apply%s\n' "$BOLD" "$RESET"
    printf 'No-restart alternative: Settings > Admin panel > Config variables > OLLAMA_BASE_URL\n'
    printf '> http://%s:11434/v1. The model registry re-reads the LLM config group on the\n' "$OLLAMA_CONTAINER"
    printf 'next request, so no restart is needed for that path.\n'
    ;;
  shared-network)
    printf '\n  %sdocker network connect %s %s%s\n' "$BOLD" "$NETWORK" "$OLLAMA_CONTAINER" "$RESET"
    printf '  %sdocker network connect %s %s%s\n' "$BOLD" "$NETWORK" "$CONTAINER" "$RESET"
    ;;
  ollama-model-pulled|model-missing)
    printf '\n  %sdocker exec %s ollama pull %s%s\n' "$BOLD" "$OLLAMA_CONTAINER" "$MODEL" "$RESET"
    ;;
  bad-path)
    printf '\nThe OpenAI-compatible endpoint lives under /v1. Point OLLAMA_BASE_URL at\n'
    printf '  %shttp://%s:11434/v1%s\n' "$BOLD" "$OLLAMA_CONTAINER" "$RESET"
    ;;
  model-disabled)
    printf '\n  %sSettings > Admin panel > AI > enable %s%s\n' "$BOLD" "$MODEL" "$RESET"
    ;;
  unreachable|http-*)
    printf '\nOllama is not answering from inside %s. Re-run after the network step above,\n' "$CONTAINER"
    printf 'then: %sdocker logs --tail 100 %s%s\n' "$BOLD" "$OLLAMA_CONTAINER" "$RESET"
    ;;
esac
exit 1
