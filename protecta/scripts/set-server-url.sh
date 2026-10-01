#!/usr/bin/env bash
# Change the URL the twenty-app-dev container publishes itself as (SERVER_URL).
# The image, port, volumes, networks and every other environment variable are
# kept; nothing in the database is touched.
#
#   ./scripts/set-server-url.sh                     show the current and target URL
#   ./scripts/set-server-url.sh --url https://crm.example.com
#   ./scripts/set-server-url.sh --apply             recreate the container (~1 min)
#   ./scripts/set-server-url.sh --url http://203.0.113.10:2020 --apply
#
# Why it matters: Twenty builds the absolute URLs it publishes from SERVER_URL —
# the config the front-end reads, OAuth redirects, emails and asset links. The
# `twenty docker:start` default is http://localhost:<port>, so on a VPS the
# browser ends up calling http://localhost:<port>/rest/... and every request
# fails. PUBLIC_URL in start.sh sets this for a container it creates; this
# script repairs one that is already running.
#
# Environment: PUBLIC_URL or PUBLIC_BASE_URL, else the Caddyfile site address.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${TWENTY_CONTAINER:-twenty-app-dev}"
TARGET_URL="${PUBLIC_URL:-${PUBLIC_BASE_URL:-}}"
APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) TARGET_URL="${2:?--url needs a value}"; shift 2 ;;
    --url=*) TARGET_URL="${1#*=}"; shift ;;
    --container) CONTAINER="${2:?--container needs a value}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

TARGET_URL="${TARGET_URL%/}"

# The committed Caddyfile is a template in every checkout, so it is only read
# when Caddy is installed here; CADDYFILE overrides the file.
if [[ -z "$TARGET_URL" ]]; then
  caddyfile="${CADDYFILE:-}"
  if [[ -z "$caddyfile" && -f "$SCRIPT_DIR/Caddyfile" ]] && command -v caddy >/dev/null 2>&1; then
    caddyfile="$SCRIPT_DIR/Caddyfile"
  fi
  if [[ -n "$caddyfile" && -f "$caddyfile" ]]; then
    # The first site address is the domain Caddy serves. Portable awk: mawk has
    # no {n,} intervals.
    caddy_domain="$(awk '
      /^[a-z0-9][a-z0-9.-]*\.[a-z]+[ \t]*\{/ {
        sub(/[ \t]*\{.*/, "", $0); print; exit
      }' "$caddyfile")"
    [[ -n "$caddy_domain" ]] && TARGET_URL="https://$caddy_domain"
  fi
fi

if [[ -z "$TARGET_URL" ]]; then
  echo "No target URL. Pass --url https://your-domain (or set PUBLIC_URL)." >&2
  exit 2
fi

if [[ ! "$TARGET_URL" =~ ^https?://[^/[:space:]]+$ ]]; then
  echo "Refusing '$TARGET_URL': expected http(s)://host[:port] with no path." >&2
  exit 2
fi

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon is not reachable" >&2; exit 1; }

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER does not exist. Start Twenty first:" >&2
  echo "  PUBLIC_URL=$TARGET_URL ./start.sh" >&2
  exit 1
fi

env_of() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null || true
}

CURRENT_URL="$(env_of "$CONTAINER" | awk -F= '$1 == "SERVER_URL" { print substr($0, index($0, "=") + 1); exit }')"

echo "Container:      $CONTAINER"
echo "Publishes now:  ${CURRENT_URL:-<unset>}"
echo "Should publish: $TARGET_URL"
echo

if [[ "$CURRENT_URL" == "$TARGET_URL" ]]; then
  echo "Nothing to do: $CONTAINER already publishes $TARGET_URL."
  exit 0
fi

if (( ! APPLY )); then
  cat <<EOF
Recreating $CONTAINER changes SERVER_URL; a container keeps the environment it
was created with. The image, port, volumes, networks and all other variables are
reused, and the previous container is kept as ${CONTAINER}-before-server-url
until the new one is healthy (about a minute of downtime).

Run again with --apply when a short outage is acceptable:
  ./scripts/set-server-url.sh --url $TARGET_URL --apply
EOF
  exit 0
fi

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
PORT="$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{if $conf}}{{(index $conf 0).HostPort}}{{"\n"}}{{end}}{{end}}' "$CONTAINER" | awk 'NF{print; exit}')"
PORT="${PORT:-2020}"
RESTART="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER")"
RESTART="${RESTART:-unless-stopped}"
mapfile -t BIND_LIST < <(docker inspect -f '{{range .HostConfig.Binds}}{{println .}}{{end}}' "$CONTAINER")
mapfile -t NETWORK_LIST < <(docker inspect -f '{{range $name, $conf := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$CONTAINER")
mapfile -t EXTRA_HOSTS < <(docker inspect -f '{{range .HostConfig.ExtraHosts}}{{println .}}{{end}}' "$CONTAINER")

if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER}-before-server-url"; then
  echo "A previous backup ${CONTAINER}-before-server-url still exists." >&2
  echo "Confirm Twenty is healthy, remove it, then re-run:" >&2
  echo "  docker rm ${CONTAINER}-before-server-url" >&2
  exit 1
fi

echo "Recreating $CONTAINER from $IMAGE on port $PORT as $TARGET_URL. Volumes are kept."
docker stop "$CONTAINER" >/dev/null
docker rename "$CONTAINER" "${CONTAINER}-before-server-url"

RUN=(docker run -d --name "$CONTAINER" --restart "$RESTART"
  -p "${PORT}:${PORT}"
  -e "NODE_PORT=${PORT}"
  -e "SERVER_URL=${TARGET_URL}")

if [[ "${#NETWORK_LIST[@]}" -gt 0 && -n "${NETWORK_LIST[0]}" ]]; then
  RUN+=(--network "${NETWORK_LIST[0]}")
fi

for host in "${EXTRA_HOSTS[@]}"; do
  [[ -n "$host" ]] && RUN+=(--add-host "$host")
done

# Keep the previous environment except the keys set above and the ones Docker
# manages itself.
while IFS= read -r entry; do
  [[ -n "$entry" && "$entry" == *=* ]] || continue
  key="${entry%%=*}"
  case "$key" in
    SERVER_URL|NODE_PORT|PATH|HOSTNAME|HOME) continue ;;
  esac
  RUN+=(-e "$entry")
done < <(env_of "${CONTAINER}-before-server-url")

for bind in "${BIND_LIST[@]}"; do
  [[ -n "$bind" ]] && RUN+=(-v "$bind")
done
RUN+=("$IMAGE")

if ! "${RUN[@]}"; then
  echo "New container failed to start. Restoring the previous one." >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rename "${CONTAINER}-before-server-url" "$CONTAINER"
  docker start "$CONTAINER" >/dev/null || true
  exit 1
fi

# Re-attach any network beyond the first one.
for ((i = 1; i < ${#NETWORK_LIST[@]}; i++)); do
  [[ -n "${NETWORK_LIST[i]}" ]] || continue
  docker network connect "${NETWORK_LIST[i]}" "$CONTAINER" >/dev/null 2>&1 || \
    echo "Warning: could not re-attach network ${NETWORK_LIST[i]}" >&2
done

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
  echo "Twenty did not become healthy. The previous container is ${CONTAINER}-before-server-url." >&2
  echo "Restore it with:" >&2
  echo "  docker rm -f $CONTAINER && docker rename ${CONTAINER}-before-server-url $CONTAINER && docker start $CONTAINER" >&2
  echo "Inspect: docker logs --tail 200 $CONTAINER" >&2
  exit 1
fi

docker rm "${CONTAINER}-before-server-url" >/dev/null

echo
echo "$CONTAINER now publishes $TARGET_URL."
echo "Reload the workspace in the browser; the REST API is called on $TARGET_URL."
echo "Customer-facing links come from the PUBLIC_BASE_URL app variable — keep it in step:"
echo "  PUBLIC_BASE_URL=$TARGET_URL ./scripts/set-public-url.sh $TARGET_URL"
