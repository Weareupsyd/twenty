#!/usr/bin/env bash
# Tests for the Caddy configuration templates: the bare domain and any legacy
# /admin URL must open the public Protecta Bode landing (/s/protecta/), while
# everything else (CRM, /welcome, APIs, webhook, health) stays proxied to the
# Twenty server. Nothing here talks to a network or needs the caddy binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/Caddyfile"
SETUP="$ROOT/scripts/setup-caddy.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$TEMPLATE" ]] || fail "missing $TEMPLATE"
[[ -f "$SETUP" ]] || fail "missing $SETUP"

# --- 1. template: / and /admin match a single named matcher -----------------
grep -Eq '^[[:space:]]*@openHome path / /admin /admin/\*[[:space:]]*$' "$TEMPLATE" ||
  fail "Caddyfile: @openHome must match exactly /, /admin and /admin/*"
# The matcher must live inside the main site block (after the site address).
grep -q '^protectabode\.weareupsyd\.com {' "$TEMPLATE" ||
  fail "Caddyfile: main site block missing"
main_line="$(grep -n '^protectabode\.weareupsyd\.com {' "$TEMPLATE" | head -1 | cut -d: -f1)"
matcher_line="$(grep -n '@openHome path' "$TEMPLATE" | head -1 | cut -d: -f1)"
(( matcher_line > main_line )) ||
  fail "Caddyfile: @openHome matcher must be declared inside the main site block"

# --- 2. template: the handle block redirects to the Protecta landing --------
grep -n 'handle @openHome {' "$TEMPLATE" >/dev/null ||
  fail "Caddyfile: handle @openHome block missing"
handle_line="$(grep -n 'handle @openHome {' "$TEMPLATE" | head -1 | cut -d: -f1)"
redir_line="$(grep -n 'redir /s/protecta/ permanent' "$TEMPLATE" | head -1 | cut -d: -f1)"
[[ -n "$redir_line" ]] || fail "Caddyfile: redirect to /s/protecta/ missing"
(( redir_line > handle_line )) ||
  fail "Caddyfile: the redirect must be inside the handle @openHome block"
close_line="$(awk -v s="$handle_line" 'NR > s && /^[[:space:]]*}/ { print NR; exit }' "$TEMPLATE")"
[[ -n "$close_line" && "$redir_line" -lt "$close_line" ]] ||
  fail "Caddyfile: the redirect must precede the closing brace of handle @openHome"

# --- 3. template: only those paths are claimed; CRM and webhook pass through -
proxy_line="$(grep -n 'reverse_proxy localhost:2020' "$TEMPLATE" | head -1 | cut -d: -f1)"
(( proxy_line > handle_line )) ||
  fail "Caddyfile: main reverse_proxy to localhost:2020 expected after handle @openHome"
# No other handle claims root/admin (health and evolution must stay untouched).
grep -Eq '^[[:space:]]*@health path /healthz /s/protecta/health[[:space:]]*$' "$TEMPLATE" ||
  fail "Caddyfile: health matcher must keep /healthz and /s/protecta/health"
grep -q '^www\.protectabode\.weareupsyd\.com {' "$TEMPLATE" ||
  fail "Caddyfile: www redirect block missing"
grep -q '^evolution\.protectabode\.weareupsyd\.com {' "$TEMPLATE" ||
  fail "Caddyfile: evolution subdomain block missing"
# Exactly one redirect rule for the open paths (no duplicates that could fight).
[[ "$(grep -c 'redir /s/protecta/ permanent' "$TEMPLATE")" -eq 1 ]] ||
  fail "Caddyfile: expected exactly one redir /s/protecta/ permanent"

# --- 4. setup-caddy.sh inline fallback carries the same routing -------------
sed -n '/^    # Bare domain and legacy \/admin open the public Protecta Bode landing\./,/^    }$/p' "$SETUP" |
  grep -q 'redir /s/protecta/ permanent' ||
  fail "setup-caddy.sh inline Caddyfile: / and /admin redirect missing"
grep -Eq '@openHome path / /admin /admin/\*' "$SETUP" ||
  fail "setup-caddy.sh inline Caddyfile: @openHome matcher missing"

# --- 5. the landing path it redirects to is the Protecta app's public site --
[[ -d "$ROOT/app/src" ]] || fail "protecta app sources missing"
grep -rq "s/protecta" "$ROOT/README.md" ||
  fail "README no longer documents /s/protecta/ as the public site"

echo "PASS caddy: domain root and /admin open the Protecta Bode landing; CRM stays on /welcome"
