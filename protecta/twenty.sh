#!/usr/bin/env bash
#
# Run the Twenty CLI for one of the apps in this checkout.
#
#   ./twenty.sh app apply .          # Protecta Bode     (protecta/app)
#   ./twenty.sh docgen               # Document Generator, same as: apply docgen/app
#   ./twenty.sh sms apply .          # SMS Sender        (protecta/sms/app)
#   ./twenty.sh app docker:status    # any other twenty subcommand
#
# The CLI has to come from the app itself (app/node_modules/.bin/twenty). A bare
# `npx twenty` is a different program: npm does not fail, it looks the name up on
# the registry, finds the unrelated `twenty` package (which ships no executable)
# and dies with
#
#     npm error could not determine executable to run
#
# even though the real cause is that the app's dependencies are not installed
# yet. This script installs what is missing, re-runs under Node 24 when the
# system Node is older (the Twenty SDK needs Node 24.5+ within Node 24) and then
# executes the app-local CLI, so the failure modes stay readable.
#
# Environment:
#   PKG_MANAGER           npm (default) or yarn, used when dependencies are missing
#   SKIP_INSTALL=1        never install dependencies, only run what is there
#   SKIP_NODE_BOOTSTRAP=1 don't re-run under Node 24 via npx on old system Node

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    \033[1;33m%s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
usage_error() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 2; }

usage() {
  printf 'Usage: ./twenty.sh <app> [twenty arguments...]\n\n'
  printf '  app     Protecta Bode       (protecta/app)\n'
  printf '  docgen  Document Generator  (protecta/docgen/app)\n'
  printf '  sms     SMS Sender          (protecta/sms/app)\n'
  printf '  <path>  any other app folder containing a package.json\n\n'
  printf 'Without further arguments the app is built and synced: apply <app folder>.\n\n'
  printf 'Examples:\n'
  printf '  ./twenty.sh sms                  sync the SMS Sender app\n'
  printf '  ./twenty.sh docgen apply .       the same, spelled out\n'
  printf '  ./twenty.sh app plan app         preview Protecta metadata changes\n'
  printf '  ./twenty.sh app docker:status    container status\n'
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

case "$1" in
  -h|--help|help)
    usage
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
    exit 0
    ;;
esac

APP_NAME="$1"
shift
[[ "${1:-}" == "--" ]] && shift

# --- Which app ---------------------------------------------------------------
#
# `linked` apps (docgen, sms) are installed and applied the way start.sh does
# it; `app` is the Protecta Bode app itself.

APP_KIND="linked"
case "$APP_NAME" in
  app)    APP_DIR="$SCRIPT_DIR/app"          APP_KIND="main" ;;
  docgen) APP_DIR="$SCRIPT_DIR/docgen/app" ;;
  sms)    APP_DIR="$SCRIPT_DIR/sms/app" ;;
  *)
    if [[ -d "$APP_NAME" && -f "$APP_NAME/package.json" ]]; then
      APP_DIR="$(cd "$APP_NAME" && pwd)"
      APP_NAME="$(basename "$APP_DIR")"
    else
      usage_error "Unknown app '$APP_NAME'. Use app, docgen, sms, or a path to an app folder (see --help)."
    fi
    ;;
esac
[[ -f "$APP_DIR/package.json" ]] || die "No app found at $APP_DIR (delete the folder to skip it, e.g. protecta/docgen)."

# --- Node 24 ----------------------------------------------------------------

command -v node >/dev/null || die "node is not installed. Install Node 24.5+ (within Node 24)."

node_is_supported() {
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 5 ? 0 : 1)'
}

if ! node_is_supported; then
  if [[ "${PROTECTA_NODE_BOOTSTRAPPED:-0}" == "1" ]]; then
    die "Node $(node -v) is unsupported and the Node 24 bootstrap did not take effect. Install Node 24.5+ or run: npx --yes --package=node@24 -- bash ./twenty.sh $APP_DIR"
  fi

  if [[ "${SKIP_NODE_BOOTSTRAP:-0}" == "1" ]] || ! command -v npx >/dev/null; then
    die "Node $(node -v) is unsupported; Twenty SDK 2.43 requires Node 24.5+ within Node 24.
  Run it with Node 24 (no install needed):
    npx --yes --package=node@24 -- bash ./twenty.sh $APP_DIR
  or install Node 24, e.g. with nvm: nvm install 24 && nvm use 24"
  fi

  info "system Node $(node -v) is too old for the Twenty SDK"
  info "re-running this script under Node 24 (npx, downloaded once)"
  export PROTECTA_NODE_BOOTSTRAPPED=1
  # The resolved folder, not the original argument: an app given as a relative
  # path would not resolve from the temporary npx working directory.
  exec npx --yes --package=node@24 -- bash "$SELF" "$APP_DIR" "$@"
fi

# --- Dependencies ------------------------------------------------------------

CLI="$APP_DIR/node_modules/.bin/twenty"
STAMP="$APP_DIR/node_modules/.twenty-manifests.sha256"
NEEDS_INSTALL=0

# Manifests, not timestamps: npm rewrites package-lock.json while installing, so
# mtimes would ask for another install on every run.
manifest_hash() {
  local files=() manifest
  for manifest in package.json package-lock.json yarn.lock; do
    [[ -f "$APP_DIR/$manifest" ]] && files+=("$APP_DIR/$manifest")
  done
  cat "${files[@]}" 2>/dev/null | { command -v sha256sum >/dev/null && sha256sum || cksum; } | awk '{print $1}'
}
MANIFEST_HASH="$(manifest_hash)"

if [[ ! -x "$CLI" ]]; then
  info "the twenty CLI is not installed in $APP_DIR yet"
  NEEDS_INSTALL=1
elif [[ ! -f "$STAMP" ]]; then
  # node_modules came from somewhere else (start.sh, a manual npm install):
  # there is nothing to compare against, so check it once and record it.
  info "the app's dependencies are not recorded yet; checking them"
  NEEDS_INSTALL=1
elif [[ "$(cat "$STAMP")" != "$MANIFEST_HASH" ]]; then
  info "the app's manifests changed since the last install"
  NEEDS_INSTALL=1
fi

# npm ci installs exactly what package-lock.json pins and refuses to run as soon
# as the lockfile and package.json disagree ("... can only install packages when
# your package.json and package-lock.json ... are in sync", "Missing: x@1 from
# lock file"). That is only a stale lockfile: npm install rewrites it to match,
# so use that (loudly) instead of stopping at a failure the user cannot read.
npm_ci_or_repair() {
  local log rc
  log="$(mktemp)"

  if (cd "$APP_DIR" && npm ci --no-audit --no-fund) 2>&1 | tee "$log"; then
    rm -f "$log"
    return 0
  fi
  rc="${PIPESTATUS[0]}"

  if ! grep -qiE 'can only install packages|are in sync|from lock file|does not satisfy' "$log"; then
    rm -f "$log"
    return "$rc"
  fi

  warn "package-lock.json is out of sync with package.json (npm ci exited with $rc)"
  warn "repairing it with: npm install --no-audit --no-fund"
  if (cd "$APP_DIR" && npm install --no-audit --no-fund) 2>&1 | tee -a "$log"; then
    warn "the repaired lockfile is $APP_DIR/package-lock.json; commit it there too,"
    warn "otherwise the next npm ci on a clean checkout fails again."
    rm -f "$log"
    return 0
  fi
  rc="${PIPESTATUS[0]}"

  rm -f "$log"
  return "$rc"
}

if (( NEEDS_INSTALL )); then
  if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
    warn "dependencies are missing, but SKIP_INSTALL=1"
  else
    MANAGER="${PKG_MANAGER:-}"
    if [[ -z "$MANAGER" ]]; then
      # npm is the manager this repo pins; yarn only when the app is yarn-only.
      if [[ -f "$APP_DIR/yarn.lock" && ! -f "$APP_DIR/package-lock.json" ]]; then
        MANAGER="yarn"
      else
        MANAGER="npm"
      fi
    fi

    step "Installing dependencies in $APP_DIR"
    case "$MANAGER" in
      npm)
        command -v npm >/dev/null || die "PKG_MANAGER=npm but npm is missing."
        if [[ "$APP_KIND" == "main" && -f "$APP_DIR/package-lock.json" ]]; then
          npm_ci_or_repair
        elif [[ "$APP_KIND" == "linked" ]]; then
          # The same flags start.sh uses for the linked apps.
          (cd "$APP_DIR" && npm install --no-audit --no-fund --legacy-peer-deps)
        else
          (cd "$APP_DIR" && npm install --no-audit --no-fund)
        fi
        ;;
      yarn)
        command -v yarn >/dev/null || die "PKG_MANAGER=yarn but yarn is missing (try: corepack enable)."
        (cd "$APP_DIR" && yarn install)
        ;;
      *) die "Unsupported PKG_MANAGER: $MANAGER (use npm or yarn)" ;;
    esac
    info "installed with $MANAGER"
    [[ -x "$CLI" ]] && printf '%s\n' "$MANIFEST_HASH" > "$STAMP"
  fi
fi

[[ -x "$CLI" ]] || die "The twenty CLI is not installed at $CLI.
  Install the app's dependencies first:
    cd $APP_DIR && npm install --no-audit --no-fund --legacy-peer-deps
  A bare 'npx twenty' does not help: it downloads the unrelated 'twenty' package
  from the registry, which ships no executable."

# --- Run ---------------------------------------------------------------------

if (( $# == 0 )); then
  set -- apply "$APP_DIR"
  step "Building and syncing the $APP_NAME app"
else
  step "twenty $* ($APP_DIR)"
fi
info "$CLI"
cd "$APP_DIR"

# Not `exec`: a failing sync is the moment the operator needs the next step.
rc=0
"$CLI" "$@" || rc=$?
if (( rc != 0 )); then
  info "the twenty CLI exited with status $rc"
  info "if this is an authentication or 'no remote' error, ./start.sh sets up the"
  info "remote and the workspace API key, and syncs all three apps in one run"
fi
exit "$rc"
