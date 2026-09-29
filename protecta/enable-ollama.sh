#!/usr/bin/env bash
# Enable Ollama as a Twenty CRM language model on the running twenty-app-dev
# container. Volumes and the database are kept.
#
#   ./enable-ollama.sh              start Ollama and print the next step
#   ./enable-ollama.sh --pull       also download llama3.2 (or $OLLAMA_MODEL)
#   ./enable-ollama.sh --apply      recreate twenty-app-dev with Ollama env
#
# The published Twenty image reads AI_PROVIDERS from the environment, so this
# works without rebuilding Twenty. A server built from this repo also enables
# Ollama when OLLAMA_BASE_URL is set.
set -euo pipefail

CONTAINER="${TWENTY_CONTAINER:-twenty-app-dev}"
OLLAMA_CONTAINER="${OLLAMA_CONTAINER:-ollama}"
MODEL="${OLLAMA_MODEL:-llama3.2}"
PULL=0
APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) PULL=1; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon is not reachable" >&2; exit 1; }

if ! docker ps -a --format '{{.Names}}' | grep -qx "$OLLAMA_CONTAINER"; then
  echo "Starting Ollama container '$OLLAMA_CONTAINER'…"
  docker run -d --name "$OLLAMA_CONTAINER" --restart unless-stopped \
    -p 11434:11434 \
    -v ollama-data:/root/.ollama \
    ollama/ollama:latest
else
  docker start "$OLLAMA_CONTAINER" >/dev/null || true
fi

# Wait for the Ollama daemon to be ready – the published image starts
# `ollama serve` via ENTRYPOINT, but the API needs a second.
wait_for_ollama() {
  echo "Waiting for Ollama server to be ready…"
  for _ in $(seq 1 60); do
    if docker exec "$OLLAMA_CONTAINER" ollama list >/dev/null 2>&1; then
      return 0
    fi
    # Fallback: probe the HTTP API from the host (port is published)
    if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Ollama server did not become ready in time. Last logs:" >&2
  docker logs --tail 50 "$OLLAMA_CONTAINER" >&2 || true
  return 1
}

if (( PULL )); then
  wait_for_ollama
  echo "Pulling $MODEL. This can take several minutes."
  # `ollama pull` inside the container needs the daemon; retry once if it races.
  if ! docker exec "$OLLAMA_CONTAINER" ollama pull "$MODEL"; then
    echo "First pull attempt failed, waiting 5s and retrying…" >&2
    sleep 5
    docker exec "$OLLAMA_CONTAINER" ollama pull "$MODEL"
  fi
fi

# Container DNS is reliable; the default bridge does not resolve container names.
NETWORK="${OLLAMA_NETWORK:-protecta-ai}"
docker network create "$NETWORK" >/dev/null 2>&1 || true
docker network connect "$NETWORK" "$OLLAMA_CONTAINER" >/dev/null 2>&1 || true
BASE_URL="http://${OLLAMA_CONTAINER}:11434/v1"

PROVIDERS="$(python3 - "$MODEL" "$BASE_URL" <<'PY'
import json, sys
model, base = sys.argv[1], sys.argv[2]
print(json.dumps({
  "ollama": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "ollama",
    "label": "Ollama",
    "baseUrl": base,
    "apiKey": "ollama",
    "models": [{
      "name": model,
      "label": model,
      "inputCostPerMillionTokens": 0,
      "outputCostPerMillionTokens": 0,
      "contextWindowTokens": 128000,
      "maxOutputTokens": 8192,
    }],
  }
}))
PY
)"

echo
echo "Ollama URL from Twenty: $BASE_URL"
echo "Model: $MODEL"
echo
echo "After Twenty restarts, open Settings → Admin panel → AI and confirm Ollama"
echo "is listed. Ask AI should use it when no cloud API key is set."

if (( ! APPLY )); then
  echo
  echo "Nothing was changed on $CONTAINER. Re-run with --apply to recreate it"
  echo "with the same volumes and the Ollama environment. Add --pull first if"
  echo "the model is not already downloaded."
  exit 0
fi

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER does not exist. Start Twenty, then re-run --apply." >&2
  exit 1
fi

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
PORT="$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{if $conf}}{{(index $conf 0).HostPort}}{{"\n"}}{{end}}{{end}}' "$CONTAINER" | awk 'NF{print; exit}')"
PORT="${PORT:-2020}"
mapfile -t BIND_LIST < <(docker inspect -f '{{range .HostConfig.Binds}}{{println .}}{{end}}' "$CONTAINER")

if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER}-before-ollama"; then
  echo "A previous backup ${CONTAINER}-before-ollama still exists. Remove it after confirming Twenty is healthy, then re-run." >&2
  exit 1
fi

echo "Recreating $CONTAINER from $IMAGE on port $PORT. Volumes are kept."
docker stop "$CONTAINER" >/dev/null
docker rename "$CONTAINER" "${CONTAINER}-before-ollama"

# Unknown model ids are skipped. Cloud models stay first; Ollama is the fallback
# when no cloud key is configured. This replaces the image's compiled chain.
CHAIN_EXTRA_FAST="openai/gpt-5.6-luna@low,google/gemini-3.8-flash@low,anthropic/claude-sonnet-5@low,xai/grok-4.5@low,mistral/mistral-small-latest@none,ollama/${MODEL}"
CHAIN_FAST="openai/gpt-5.6-luna@medium,google/gemini-3.8-flash@medium,anthropic/claude-sonnet-5@medium,xai/grok-4.5@medium,mistral/mistral-medium-latest,ollama/${MODEL}"
CHAIN_BALANCED="openai/gpt-5.6-luna@high,google/gemini-3.8-flash@high,anthropic/claude-sonnet-5@high,xai/grok-4.6@medium,mistral/mistral-large-latest,ollama/${MODEL}"
CHAIN_SMART="openai/gpt-5.6-sol@high,google/gemini-3.8-flash@high,anthropic/claude-opus-5@high,xai/grok-4.6@high,mistral/mistral-large-latest,ollama/${MODEL}"
CHAIN_EXTRA_SMART="openai/gpt-6-astra@xhigh,google/gemini-3.8-flash@high,anthropic/claude-opus-5-5,xai/grok-4.6@xhigh,mistral/mistral-large-latest,ollama/${MODEL}"

RUN=(docker run -d --name "$CONTAINER" --restart unless-stopped
  --network "$NETWORK"
  --add-host=host.docker.internal:host-gateway
  -p "${PORT}:${PORT}"
  -e "NODE_PORT=${PORT}"
  -e "OLLAMA_BASE_URL=${BASE_URL}"
  -e "OLLAMA_API_KEY=ollama"
  -e "AI_PROVIDERS=${PROVIDERS}"
  -e "AI_MODELS_DEFAULT_EXTRA_FAST=${CHAIN_EXTRA_FAST}"
  -e "AI_MODELS_DEFAULT_FAST=${CHAIN_FAST}"
  -e "AI_MODELS_DEFAULT_BALANCED=${CHAIN_BALANCED}"
  -e "AI_MODELS_DEFAULT_SMART=${CHAIN_SMART}"
  -e "AI_MODELS_DEFAULT_EXTRA_SMART=${CHAIN_EXTRA_SMART}")

# Keep the previous environment except the keys we are replacing.
while IFS= read -r env; do
  [[ -n "$env" && "$env" == *=* ]] || continue
  key="${env%%=*}"
  case "$key" in
    OLLAMA_BASE_URL|OLLAMA_API_KEY|AI_PROVIDERS|AI_MODELS_DEFAULT_*|NODE_PORT|PATH|HOSTNAME|HOME) continue ;;
  esac
  RUN+=(-e "$env")
done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${CONTAINER}-before-ollama")

for bind in "${BIND_LIST[@]}"; do
  [[ -n "$bind" ]] || continue
  RUN+=(-v "$bind")
done
RUN+=("$IMAGE")

if ! "${RUN[@]}"; then
  echo "New container failed to start. Restoring the previous container." >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rename "${CONTAINER}-before-ollama" "$CONTAINER"
  docker start "$CONTAINER" >/dev/null || true
  exit 1
fi

echo "Waiting for $CONTAINER to become healthy…"
ok=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null | grep -q '"status":"ok"\|"status": "ok"'; then
    ok=1
    break
  fi
  sleep 2
done
if (( ! ok )); then
  echo "Twenty did not become healthy. Previous container is ${CONTAINER}-before-ollama." >&2
  echo "Inspect: docker logs --tail 200 $CONTAINER" >&2
  exit 1
fi

docker rm "${CONTAINER}-before-ollama" >/dev/null
echo "Ollama is enabled. Open Settings → Admin panel → AI and pick ${MODEL}."
