#!/usr/bin/env bash
#
# Protecta all-in-one installer.
#
# One command on a fresh VPS: system prerequisites, Node 24, Docker, the Twenty
# server container, a workspace API key, and all three Protecta apps
# (Protecta Bode + Document Generator + SMS Sender) synced into the workspace.
#
#   ./install.sh                  install everything
#   ./install.sh --port 3000      use another port
#   ./install.sh --domain protectabode.weareupsyd.com --with-caddy --with-evolution
#                                 production setup for https://protectabode.weareupsyd.com with Caddy TLS + Evolution webhook
#   ./install.sh --skip-prereqs   don't touch Node/Docker (already provisioned)
#   ./install.sh --no-verify      skip the post-install verification
#   ./install.sh --branch <ref>   branch to clone when bootstrap is needed
#   ./install.sh --reseed         re-run the Twenty dev seed before deploying
#                                 (first boot, after "Seeding workspace data... Failed")
#   ./install.sh --with-caddy     install Caddy and configure TLS for --domain (default: protectabode.weareupsyd.com)
#   ./install.sh --with-evolution run Evolution API (WhatsApp gateway) via docker-compose.caddy.yml with default webhook
#   ./install.sh --domain <domain> public domain for Caddy and PUBLIC_BASE_URL (default: protectabode.weareupsyd.com)
#   ./install.sh --email <email>  email for Let's Encrypt (default: admin@weareupsyd.com)
#   ./install.sh --evolution-domain <domain> Evolution subdomain (default: evolution.protectabode.weareupsyd.com)
#   ./install.sh --webhook-url <url> Evolution webhook URL (default: https://DOMAIN/s/protecta/whatsapp/webhook)
#
# It can also run itself from outside a checkout:
#
#   curl -fsSL https://raw.githubusercontent.com/Weareupsyd/twenty/<branch>/protecta/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Weareupsyd/twenty/<branch>/protecta/install.sh | bash -s -- --with-caddy --with-evolution --domain protectabode.weareupsyd.com
#
# In that case it clones the repository (default: ~/twenty-protecta) and
# continues from there. Re-running install.sh is safe: every step is idempotent.
#
# Environment:
#   PROTECTA_DIR        checkout to create/use in bootstrap mode
#   PROTECTA_REPO_URL   repository to clone (default: the GitHub URL)
#   PROTECTA_BRANCH     branch to clone (default: the branch below)
#   TWENTY_API_KEY      reuse this key instead of minting one
#   SKIP_DOCKER_INSTALL=1 / SKIP_NODE_INSTALL=1  don't install that piece
#   All start.sh variables (SKIP_INSTALL, PKG_MANAGER, ...) are honoured.

set -euo pipefail

DEFAULT_BRANCH="main"
REPO_URL="${PROTECTA_REPO_URL:-https://github.com/Weareupsyd/twenty.git}"

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [[ -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
fi

# --- output -----------------------------------------------------------------

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
info_err() { printf '    %s\n' "$*" >&2; }
warn() { printf '    \033[1;33m%s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# --- arguments --------------------------------------------------------------

ORIGINAL_ARGS=("$@")
PORT=""
WATCH=0
BRANCH=""
TARGET_DIR=""
SKIP_PREREQS=0
SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
SKIP_NODE_INSTALL="${SKIP_NODE_INSTALL:-0}"
VERIFY=1
RESEED=0
DOMAIN="${DOMAIN:-protectabode.weareupsyd.com}"
EMAIL="${EMAIL:-admin@weareupsyd.com}"
WITH_CADDY="${WITH_CADDY:-0}"
WITH_EVOLUTION="${WITH_EVOLUTION:-0}"
EVOLUTION_DOMAIN="${EVOLUTION_DOMAIN:-evolution.protectabode.weareupsyd.com}"
WEBHOOK_URL="${WEBHOOK_URL:-https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --watch|-w) WATCH=1; shift ;;
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --branch=*) BRANCH="${1#*=}"; shift ;;
    --dir) TARGET_DIR="${2:?--dir needs a value}"; shift 2 ;;
    --dir=*) TARGET_DIR="${1#*=}"; shift ;;
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --email) EMAIL="${2:?--email needs a value}"; shift 2 ;;
    --email=*) EMAIL="${1#*=}"; shift ;;
    --evolution-domain) EVOLUTION_DOMAIN="${2:?--evolution-domain needs a value}"; shift 2 ;;
    --evolution-domain=*) EVOLUTION_DOMAIN="${1#*=}"; shift ;;
    --with-caddy) WITH_CADDY=1; shift ;;
    --without-caddy) WITH_CADDY=0; shift ;;
    --with-evolution) WITH_EVOLUTION=1; shift ;;
    --without-evolution) WITH_EVOLUTION=0; shift ;;
    --webhook-url) WEBHOOK_URL="${2:?--webhook-url needs a value}"; shift 2 ;;
    --webhook-url=*) WEBHOOK_URL="${1#*=}"; shift ;;
    --skip-prereqs) SKIP_PREREQS=1; shift ;;
    --skip-docker-install) SKIP_DOCKER_INSTALL=1; shift ;;
    --skip-node-install) SKIP_NODE_INSTALL=1; shift ;;
    --no-verify) VERIFY=0; shift ;;
    --reseed) RESEED=1; shift ;;
    -h|--help)
      if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/install.sh" ]]; then
        awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$SCRIPT_DIR/install.sh"
      else
        printf 'Protecta all-in-one installer\n\n  --port <n>          use another port\n  --domain <domain>   public domain (default: protectabode.weareupsyd.com)\n  --email <email>     email for TLS certs\n  --with-caddy        install and configure Caddy reverse proxy for DOMAIN\n  --with-evolution    also run Evolution API (WhatsApp gateway) via docker compose\n  --evolution-domain  Evolution subdomain (default: evolution.protectabode.weareupsyd.com)\n  --webhook-url       Evolution webhook URL (default: https://DOMAIN/s/protecta/whatsapp/webhook)\n  --watch             keep watching src/ after installing\n  --branch <ref>      branch to clone in bootstrap mode\n  --dir <path>        checkout to create/use in bootstrap mode\n  --skip-prereqs      do not provision Node/Docker\n  --no-verify         skip the post-install verification\n  --reseed            re-run the Twenty dev seed before deploying\n'
      fi
      exit 0
      ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done
[[ -n "$BRANCH" ]] || BRANCH="${PROTECTA_BRANCH:-$DEFAULT_BRANCH}"
[[ -n "$TARGET_DIR" ]] || TARGET_DIR="${PROTECTA_DIR:-$HOME/twenty-protecta}"

printf '\n\033[1;32mProtecta all-in-one installer\033[0m\n'
info "branch: $BRANCH"

# --- privilege handling -----------------------------------------------------

SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    SUDO=""
  fi
fi

as_root() {
  if [[ -n "$SUDO" ]]; then "$SUDO" "$@"; else "$@"; fi
}

# --- bootstrap: clone the repository when this script runs standalone -------

bootstrap_checkout() {
  command -v git >/dev/null || die "git is required to fetch the source. Install it (e.g. 'apt-get install -y git') and re-run."
  [[ -n "$BRANCH" ]] || die "No branch given."

  if [[ -d "$TARGET_DIR/.git" ]]; then
    step "Updating existing checkout in $TARGET_DIR"
    git -C "$TARGET_DIR" fetch --depth=1 origin "$BRANCH" || die "Could not fetch '$BRANCH' from $REPO_URL."
    git -C "$TARGET_DIR" checkout -q "$BRANCH" || die "Could not check out '$BRANCH' in $TARGET_DIR."
    git -C "$TARGET_DIR" merge --ff-only FETCH_HEAD >/dev/null 2>&1 || warn "Kept local changes in $TARGET_DIR."
  elif [[ -e "$TARGET_DIR" ]]; then
    die "$TARGET_DIR exists but is not a git checkout. Move it away or pass --dir <empty path>."
  else
    step "Cloning $BRANCH into $TARGET_DIR"
    git clone --depth=1 --single-branch --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR" \
      || die "Clone failed. If the repository is private, clone it yourself and run protecta/install.sh from inside it."
  fi

  [[ -f "$TARGET_DIR/protecta/install.sh" ]] || die "$TARGET_DIR/protecta/install.sh is missing; is '$BRANCH' the right branch?"

  info "re-running the installer from $TARGET_DIR/protecta/install.sh"
  exec bash "$TARGET_DIR/protecta/install.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
}

if [[ -z "$SCRIPT_DIR" || ! -d "$SCRIPT_DIR/app" ]]; then
  bootstrap_checkout
fi

REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SH="$SCRIPT_DIR/start.sh"
[[ -f "$START_SH" ]] || die "start.sh is missing next to install.sh ($START_SH)."

# --- 1. system ---------------------------------------------------------------

node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 5 ? 0 : 1)' 2>/dev/null
}

ensure_node() {
  if node_is_supported; then
    info "node $(node -v)"
    return 0
  fi

  if [[ "${PROTECTA_NODE_BOOTSTRAPPED:-0}" == "1" ]]; then
    info "node $(node -v) (inside the Node 24 bootstrap)"
    return 0
  fi

  # A Node 24 npx is enough: start.sh re-runs itself under it.
  if command -v npx >/dev/null 2>&1; then
    info "system node $(node -v 2>/dev/null || echo missing); start.sh will re-run under Node 24 via npx"
    return 0
  fi

  if [[ "$SKIP_NODE_INSTALL" == "1" ]]; then
    die "Node 24 is not installed and SKIP_NODE_INSTALL=1. Install Node 24.5+ and re-run."
  fi

  step "Installing Node 24 (no system packages touched)"
  command -v curl >/dev/null || die "curl is required to download Node."
  command -v tar >/dev/null || die "tar is required to unpack Node."

  local arch prefix tmp sums file url
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    armv7l) arch="armv7l" ;;
    *) die "Unsupported architecture: $(uname -m). Install Node 24.5+ manually." ;;
  esac

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    prefix="/usr/local/twenty-node24"
  else
    prefix="$HOME/.twenty-node24"
  fi
  tmp="$(mktemp -d)"
  sums="$tmp/SHASUMS256.txt"

  curl -fsSL --max-time 60 "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt" -o "$sums" \
    || die "Could not reach nodejs.org. Install Node 24.5+ manually and re-run."
  file="$(grep -o "node-v24[^ ]*-linux-${arch}\.tar\.gz" "$sums" | head -n 1 || true)"
  [[ -n "$file" ]] || die "No Node 24 build found for linux-${arch}."
  ( cd "$tmp" && grep " ${file}\$" "$sums" | sha256sum -c - >/dev/null 2>&1 ) \
    || warn "Node checksum could not be verified; continuing."

  info "downloading $file"
  curl -fsSL --max-time 600 "https://nodejs.org/dist/latest-v24.x/$file" -o "$tmp/$file" \
    || die "Node download failed."

  mkdir -p "$prefix"
  tar -xzf "$tmp/$file" -C "$prefix" --strip-components=1 || die "Could not unpack Node."
  rm -rf "$tmp"

  export PATH="$prefix/bin:$PATH"
  node_is_supported || die "Node 24 installation did not produce a usable node in $prefix."
  info "node $(node -v) installed in $prefix"
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      info "docker $(docker --version | awk '{print $3}') (daemon up)"
      return 0
    fi

    info "docker is installed but the daemon is not reachable; starting it"
    as_root systemctl enable --now docker >/dev/null 2>&1 \
      || as_root service docker start >/dev/null 2>&1 \
      || as_root rc-service docker start >/dev/null 2>&1 \
      || true

    if docker info >/dev/null 2>&1; then
      info "docker daemon is up"
      return 0
    fi

    # Docker may need root or the docker group, which a fresh login would grant.
    if [[ -n "$SUDO" ]] && [[ "${PROTECTA_SUDO_REEXEC:-0}" != "1" ]] && $SUDO docker info >/dev/null 2>&1; then
      step "Docker needs root here; re-running the installer with sudo"
      export PROTECTA_SUDO_REEXEC=1
      exec $SUDO -E bash "$SCRIPT_DIR/install.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
    fi

    die "The docker daemon is not reachable.
  If docker is installed, start it: sudo systemctl enable --now docker
  If your user is not in the docker group: sudo usermod -aG docker \$USER (then log out and in)
  Or re-run this installer as root: sudo ./install.sh"
  fi

  if [[ "$SKIP_DOCKER_INSTALL" == "1" ]]; then
    die "Docker is not installed and SKIP_DOCKER_INSTALL=1. Install Docker and re-run."
  fi

  step "Installing Docker"
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -qq || warn "apt-get update reported problems; continuing."
    as_root apt-get install -y -qq docker.io || die "Could not install docker.io."
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y docker || die "Could not install docker."
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y docker || die "Could not install docker."
  elif command -v zypper >/dev/null 2>&1; then
    as_root zypper --non-interactive install docker || die "Could not install docker."
  elif command -v pacman >/dev/null 2>&1; then
    as_root pacman -Sy --noconfirm docker || die "Could not install docker."
  elif command -v apk >/dev/null 2>&1; then
    as_root apk add --no-cache docker || die "Could not install docker."
  elif command -v curl >/dev/null 2>&1; then
    info "no known package manager; using the Docker convenience script"
    curl -fsSL https://get.docker.com | as_root sh || die "Docker installation failed."
  else
    die "No supported package manager found. Install Docker manually (https://docs.docker.com/engine/install/) and re-run."
  fi

  command -v docker >/dev/null 2>&1 || die "Docker installation finished but 'docker' is not on PATH."

  as_root systemctl enable --now docker >/dev/null 2>&1 \
    || as_root service docker start >/dev/null 2>&1 \
    || as_root rc-service docker start >/dev/null 2>&1 \
    || true

  for _ in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done

  if docker info >/dev/null 2>&1; then
    info "docker $(docker --version | awk '{print $3}') (daemon up)"
  elif [[ -n "$SUDO" ]] && [[ "${PROTECTA_SUDO_REEXEC:-0}" != "1" ]] && $SUDO docker info >/dev/null 2>&1; then
    step "Docker needs root here; re-running the installer with sudo"
    export PROTECTA_SUDO_REEXEC=1
    exec $SUDO -E bash "$SCRIPT_DIR/install.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
  else
    die "Docker was installed but the daemon is not reachable. Check 'systemctl status docker' or re-run as root."
  fi
}

system_check() {
  step "System prerequisites"
  command -v curl >/dev/null || die "curl is required. Install it (e.g. 'apt-get install -y curl') and re-run."
  [[ -f /etc/os-release ]] || warn "unknown distribution; continuing anyway."

  if [[ -z "$SUDO" && "${EUID:-$(id -u)}" -ne 0 ]]; then
    warn "not running as root and sudo is unavailable: system packages cannot be installed."
  fi

  info "host: $(uname -s) $(uname -m), $( (. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unknown}") )"
}

if [[ "$SKIP_PREREQS" == "1" ]]; then
  step "Skipping prerequisite provisioning (--skip-prereqs)"
  command -v node >/dev/null || die "node is missing; drop --skip-prereqs."
  command -v docker >/dev/null || die "docker is missing; drop --skip-prereqs."
else
  system_check
  step "Node 24"
  ensure_node
  step "Docker"
  ensure_docker
fi

# --- 2. deploy ---------------------------------------------------------------

START_ARGS=()
if [[ -n "$PORT" ]]; then START_ARGS+=(--port "$PORT"); fi
if (( WATCH )); then START_ARGS+=(--watch); fi
if (( RESEED )); then START_ARGS+=(--reseed); fi
# Behind Caddy the browser reaches Twenty at https://$DOMAIN, and the container
# has to publish itself as that URL: SERVER_URL is what Twenty builds its
# absolute links from, including the REST base the front-end uses.
if [[ "$WITH_CADDY" == "1" && -z "${PUBLIC_URL:-}" ]]; then
  # --apply-public-url recreates the container at the end of start.sh, once the
  # syncs are done: the published CLI creates it with SERVER_URL=localhost, and
  # a container keeps the environment it was created with.
  START_ARGS+=(--public-url "https://$DOMAIN" --apply-public-url)
fi

step "Installing Protecta (server, API key, apps)"
info "this runs start.sh: dependencies -> Twenty container -> API key -> app syncs"
"$START_SH" ${START_ARGS[@]+"${START_ARGS[@]}"} || die "The deployment failed. Fix the error above and re-run ./install.sh (state is kept)."

# --- 3. verify ---------------------------------------------------------------

EXPECTED_APPS=(
  "f7d814ab-cbfd-48bc-9ee0-06a06daae1a4|Protecta Bode"
  "c92c1ffa-0652-4380-b82d-1eabb94945f5|Document Generator"
  "ad58822e-4e44-41c2-8e48-ca60f5066f6c|SMS Messaging"
)

detect_port() {
  local port
  port="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' twenty-app-dev 2>/dev/null \
    | sed -n 's/^NODE_PORT=\([0-9][0-9]*\)$/\1/p')"
  port="${port%%$'\n'*}"
  echo "${port:-2020}"
}

verify_installation() {
  local port server_url rows missing=0 uid label registry workspace_state
  port="$(detect_port)"

  if [[ -n "$PORT" ]]; then
    server_url="http://localhost:$PORT"
  else
    server_url="http://localhost:$port"
  fi

  step "Verifying the installation"

  if curl -fsS --max-time 5 "$server_url/healthz" 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    info "server healthy at $server_url"
  else
    warn "could not confirm $server_url/healthz; continuing with the app check"
  fi

  registry="$(docker exec -e PGPASSWORD=twenty twenty-app-dev sh -c \
    'psql -h localhost -U twenty -d default -tA -F "|" -c "$1"' _ \
    'SELECT "universalIdentifier", name FROM core.application WHERE "deletedAt" IS NULL' \
    2>/dev/null || true)"

  for entry in "${EXPECTED_APPS[@]}"; do
    uid="${entry%%|*}"
    label="${entry##*|}"
    if grep -qi "$uid" <<<"$registry"; then
      info "installed: $label"
    else
      warn "missing:   $label"
      missing=$((missing + 1))
    fi
  done

  if (( missing )); then
    printf '\n\033[1;31m==> %d app(s) are not registered in the workspace\033[0m\n\n' "$missing" >&2
    if [[ -n "$registry" ]]; then
      info_err "applications the workspace reports:"
      while IFS='|' read -r id name; do
        if [[ -n "$name" ]]; then info_err "  - $name  ($id)"; fi
      done <<<"$registry"
    fi
    info_err "re-run ./start.sh to retry the sync; the workspace and database are untouched."

    workspace_state="$(docker exec -e PGPASSWORD=twenty twenty-app-dev sh -c \
      'psql -h localhost -U twenty -d default -tAc "$1"' _ \
      "SELECT \"activationStatus\" FROM core.workspace WHERE id = '20202020-1c25-4d02-bf25-6aeccf7ea419' AND \"deletedAt\" IS NULL" \
      2>/dev/null || true)"

    if [[ "$workspace_state" =~ ^[A-Z_]+$ && "$workspace_state" != "ACTIVE" ]]; then
      info_err "the seeded workspace is still in $workspace_state: the first-boot seed never finished,"
      info_err "so there is nothing to sync into. Repair it and retry:"
      info_err "  ./start.sh --reseed"
    elif [[ -z "$workspace_state" ]]; then
      info_err "the container did not report the seeded workspace: its first-boot seed may not have finished."
      info_err "Repair it and retry the sync:"
      info_err "  ./start.sh --reseed"
    fi

    exit 1
  fi

  printf '\n\033[1;32m==> All %d apps are installed and registered\033[0m\n' "${#EXPECTED_APPS[@]}"
}

if (( VERIFY )); then
  verify_installation
else
  step "Skipping verification (--no-verify)"
fi

# --- 4. Caddy + Evolution (optional, for protectabode.weareupsyd.com) ----------------

setup_caddy_if_requested() {
  if [[ "$WITH_CADDY" != "1" ]]; then
    return 0
  fi

  step "Configuring Caddy reverse proxy for $DOMAIN → localhost:${PORT:-2020}"
  if [[ -f "$SCRIPT_DIR/scripts/setup-caddy.sh" ]]; then
    DOMAIN="$DOMAIN" PORT="${PORT:-$(detect_port)}" EMAIL="$EMAIL" EVOLUTION_DOMAIN="$EVOLUTION_DOMAIN" bash "$SCRIPT_DIR/scripts/setup-caddy.sh" || warn "Caddy setup reported problems; check /etc/caddy/Caddyfile and 'systemctl status caddy'"
  else
    warn "scripts/setup-caddy.sh not found, skipping Caddy setup"
  fi

  # Set PUBLIC_BASE_URL to the public domain so links in WhatsApp, emails, etc use https://DOMAIN
  if [[ -f "$SCRIPT_DIR/scripts/set-public-url.sh" ]]; then
    info "setting PUBLIC_BASE_URL to https://$DOMAIN"
    PUBLIC_BASE_URL="https://$DOMAIN" SERVER_URL="http://localhost:${PORT:-$(detect_port)}" bash "$SCRIPT_DIR/scripts/set-public-url.sh" "https://$DOMAIN" || warn "Could not auto-set PUBLIC_BASE_URL, set it manually in Settings → Protecta Bode → Variables"
  fi
}

setup_evolution_if_requested() {
  if [[ "$WITH_EVOLUTION" != "1" ]]; then
    return 0
  fi

  step "Setting up Evolution API (WhatsApp gateway) with default webhook https://$DOMAIN/s/protecta/whatsapp/webhook"

  # Create .env file for docker-compose.caddy.yml if missing
  ENV_FILE="$SCRIPT_DIR/.env.evolution"
  if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<ENVEOF
DOMAIN=$DOMAIN
EVOLUTION_DOMAIN=$EVOLUTION_DOMAIN
WEBHOOK_URL=https://$DOMAIN/s/protecta/whatsapp/webhook
EVOLUTION_API_KEY=protecta-evolution-key-$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16)
ENVEOF
    info "created $ENV_FILE with random EVOLUTION_API_KEY (chmod 600)"
    chmod 600 "$ENV_FILE"
  fi

  # Load env
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
  set +a

  # Ensure Caddyfile exists
  if [[ ! -f "$SCRIPT_DIR/Caddyfile" ]]; then
    warn "Caddyfile not found in $SCRIPT_DIR, Caddy may not proxy $DOMAIN correctly"
  fi

  # Start Evolution + Caddy via docker compose if docker-compose.caddy.yml exists
  if [[ -f "$SCRIPT_DIR/docker-compose.caddy.yml" ]]; then
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
      info "starting Evolution API + Caddy via docker compose"
      (cd "$SCRIPT_DIR" && DOMAIN="$DOMAIN" EVOLUTION_DOMAIN="$EVOLUTION_DOMAIN" WEBHOOK_URL="https://$DOMAIN/s/protecta/whatsapp/webhook" EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-}" docker compose -f docker-compose.caddy.yml --env-file "$ENV_FILE" up -d) || warn "docker compose up failed for caddy/evolution"
    elif command -v docker-compose >/dev/null 2>&1; then
      info "starting Evolution API + Caddy via docker-compose"
      (cd "$SCRIPT_DIR" && DOMAIN="$DOMAIN" EVOLUTION_DOMAIN="$EVOLUTION_DOMAIN" WEBHOOK_URL="https://$DOMAIN/s/protecta/whatsapp/webhook" EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-}" docker-compose -f docker-compose.caddy.yml --env-file "$ENV_FILE" up -d) || warn "docker-compose up failed"
    else
      warn "docker compose not found, Evolution API not started. Install docker compose plugin and run: docker compose -f docker-compose.caddy.yml up -d"
    fi
  else
    info "docker-compose.caddy.yml not found, skipping container start. To run Evolution manually:"
    info "  docker run -d --name evolution-api -p 8080:8080 -e AUTHENTICATION_API_KEY=\$EVOLUTION_API_KEY -e WEBHOOK_GLOBAL_URL=https://$DOMAIN/s/protecta/whatsapp/webhook atendai/evolution-api"
  fi

  # Give Evolution a moment to start
  sleep 3

  # Auto-configure webhook if Evolution is reachable and API key is known
  if [[ -n "${EVOLUTION_API_KEY:-}" ]]; then
    if curl -fsS --max-time 5 "http://localhost:8080/" >/dev/null 2>&1 || curl -fsS --max-time 5 "http://localhost:8080/instance/fetchInstances" -H "apikey: $EVOLUTION_API_KEY" >/dev/null 2>&1; then
      info "Evolution API reachable, setting default webhook to https://$DOMAIN/s/protecta/whatsapp/webhook"
      EVOLUTION_API_URL="http://localhost:8080" EVOLUTION_INSTANCE="${EVOLUTION_INSTANCE:-protecta}" EVOLUTION_API_KEY="$EVOLUTION_API_KEY" WEBHOOK_URL="https://$DOMAIN/s/protecta/whatsapp/webhook" bash "$SCRIPT_DIR/scripts/setup-evolution-webhook.sh" || warn "Could not auto-set Evolution webhook, run manually: ./scripts/setup-evolution-webhook.sh --webhook https://$DOMAIN/s/protecta/whatsapp/webhook"
    else
      info "Evolution API not yet reachable on localhost:8080, webhook will need manual setup after it starts"
    fi
  fi

  info "Evolution API setup: instance 'protecta' should be created via Evolution dashboard at http://localhost:8080 or https://$EVOLUTION_DOMAIN"
  info "Then QR-scan with bot phone, then webhook https://$DOMAIN/s/protecta/whatsapp/webhook will receive messages"
}

if [[ "$WITH_CADDY" == "1" || "$WITH_EVOLUTION" == "1" ]]; then
  # Ensure domain resolves? Warn if not
  if ! getent hosts "$DOMAIN" >/dev/null 2>&1; then
    warn "Domain $DOMAIN does not resolve from this host yet — ensure DNS A record points to this server's public IP before TLS will work"
  fi
fi

setup_caddy_if_requested
setup_evolution_if_requested

# --- done --------------------------------------------------------------------

PORT_SHOWN="${PORT:-$(detect_port)}"
SERVER_URL="http://localhost:$PORT_SHOWN"
PUBLIC_URL="https://$DOMAIN"
if [[ "$WITH_CADDY" != "1" ]]; then
  PUBLIC_URL="$SERVER_URL"
fi

cat <<EOF

$(printf '\033[1;32m==> Install complete\033[0m')

    Workspace:   $SERVER_URL
    Public URL:  $PUBLIC_URL
    Login:       tim@apple.dev / tim@apple.dev
    Landing:     $PUBLIC_URL/s/protecta/
    Bot config:  $PUBLIC_URL/pages/aee67389-c855-41aa-b11b-7ac6784f1252  (main menu → WhatsApp bot)
    Settings:    $PUBLIC_URL/settings/whatsapp-bot  (gear → WhatsApp bot)
    Documents:   $PUBLIC_URL/s/docgen/documents/view?policyNo=<policy no>
    SMS API:     POST $PUBLIC_URL/s/sms/send
    Health:      $PUBLIC_URL/s/protecta/health
    Webhook:     $PUBLIC_URL/s/protecta/whatsapp/webhook  ← default Evolution webhook

    Apps:        Protecta Bode (${SCRIPT_DIR}/app)
                 Document Generator (${SCRIPT_DIR}/docgen/app)
                 SMS Messaging (${SCRIPT_DIR}/sms/app)

    API key:     ${TWENTY_API_KEY_FILE:-$SCRIPT_DIR/.twenty-api-key} (chmod 600, git-ignored)
    Source:      $REPO_DIR
    Caddyfile:   ${SCRIPT_DIR}/Caddyfile  (if --with-caddy)
    Evolution:   docker-compose.caddy.yml + .env.evolution (if --with-evolution)
                 Evolution dashboard: http://localhost:8080 or https://$EVOLUTION_DOMAIN
                 Default webhook: https://$DOMAIN/s/protecta/whatsapp/webhook

    Re-run/deploy changes:   ./start.sh
    Rotate the API key:      ./start.sh --new-api-key
    Repair a failed seed:    ./start.sh --reseed
    Watch source changes:    ./start.sh --watch
    Enable local AI:         ./enable-ollama.sh --pull && ./enable-ollama.sh --apply
    Stop the server:         ${SCRIPT_DIR}/app/node_modules/.bin/twenty docker:stop
    Logs:                    docker logs -f twenty-app-dev
    Caddy logs:              /var/log/caddy/protectabode.log and /var/log/caddy/evolution.log
    Evolution logs:          docker logs -f evolution-api
    Caddy reload:            sudo systemctl reload caddy or ./scripts/setup-caddy.sh --domain $DOMAIN

    Evolution webhook setup:  ./scripts/setup-evolution-webhook.sh --webhook https://$DOMAIN/s/protecta/whatsapp/webhook
    Set public URL:          ./scripts/set-public-url.sh https://$DOMAIN

    Note: the server is published on all interfaces, so $PORT_SHOWN is reachable
    from other machines once the host firewall allows it.
    With --with-caddy, Caddy terminates TLS for $DOMAIN and proxies to localhost:$PORT_SHOWN.
    With Caddy, $DOMAIN/ and $DOMAIN/admin redirect to /s/protecta/ (the public
    Protecta Bode site); staff CRM sign-in is at $DOMAIN/welcome.
    Ensure DNS A record for $DOMAIN and $EVOLUTION_DOMAIN points to this server.

EOF
