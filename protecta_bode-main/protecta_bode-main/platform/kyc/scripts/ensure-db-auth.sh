#!/bin/sh
# Run inside kyc-db, after Compose has reconciled its environment:
#   docker compose exec -T kyc-db sh -s < kyc-stack/scripts/ensure-db-auth.sh
# stdout is a machine-readable result (unchanged/repaired/created); diagnostics use stderr.
#
# POSTGRES_PASSWORD only applies at initdb time. This helper reconciles an
# EXISTING cluster with the Compose configuration without destroying anything:
# no volume is deleted, no pg_hba.conf is rewritten, no role is dropped, no
# data is removed. Repairs are strictly additive:
#
#   1. password drift on the configured role -> ALTER ROLE ... PASSWORD,
#      applied over the trusted local socket (the official image's initdb
#      default for local connections)
#   2. configured database missing -> CREATE DATABASE (owned by the role)
#   3. configured role missing (the volume was initialized by an older or
#      different bootstrap user, or the role was dropped) -> CREATE ROLE +
#      CREATE DATABASE, falling back to the cluster's bootstrap superuser
#      ("postgres") over the socket
#
# Cases 2 and 3 matter because PostgreSQL deliberately answers a wrong
# password and a missing role with the SAME client-side error
# ("password authentication failed for user X", 28P01) - the kyc-api cannot
# tell them apart, so all three must be repaired here or start.sh aborts.
#
# WHERE the probe connects from decides whether it proves anything at all.
# The official Postgres image keeps initdb's default pg_hba.conf and only
# APPENDS one rule:
#
#   local   all   all                   trust            <- initdb default
#   host    all   all   127.0.0.1/32    trust            <- initdb default
#   host    all   all   ::1/128         trust            <- initdb default
#   host    all   all   all             scram-sha-256    <- added by the image
#
# So a TCP probe to 127.0.0.1 matches a *trust* rule and succeeds with ANY
# password: password drift is reported as "unchanged", never repaired, and
# kyc-api - which arrives from another container and therefore matches the
# scram-sha-256 rule - keeps crash-looping with 28P01. The probe must run over
# an address that actually enforces passwords, so we use this container's own
# routable address and prove the enforcement with a deliberately wrong
# password before trusting the probe's verdict.
set -eu

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
export PGCONNECT_TIMEOUT=5

err() {
  printf '%s\n' "$*" >&2
}

PROBE_ERR="$(mktemp)"
SOCKET_ERR="$(mktemp)"
CONTROL_ERR="$(mktemp)"
trap 'rm -f "$PROBE_ERR" "$SOCKET_ERR" "$CONTROL_ERR" 2>/dev/null || true' EXIT

attempt=0
until pg_isready -h 127.0.0.1 -t 2 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    err "Verification database did not become reachable in ~60s. Check: docker compose logs kyc-db"
    exit 1
  fi
  sleep 2
done

last_psql_error() { # $1 = stderr capture file -> last server message, single line
  sed -n 's/^psql:[[:space:]]*//p' "$1" 2>/dev/null | tail -n 2 | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

connect() { # $1 = host, $2 = password, $3 = stderr capture file
  # pg_isready only tests whether PostgreSQL accepts connections, NOT whether
  # this password works. Force TCP and a real query, and never prompt.
  PGPASSWORD="$2" psql -X -w -h "$1" \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c 'SELECT 1' >/dev/null 2>"$3"
}

candidate_hosts() {
  # This container's own non-loopback addresses first: kyc-api connects over
  # the Compose network, and only a non-loopback peer matches the image's
  # "host all all all scram-sha-256" rule. 127.0.0.1 is kept as a last resort
  # (host networking / custom pg_hba) but is verified like any other address.
  {
    hostname -i 2>/dev/null || true
    hostname -I 2>/dev/null || true
    ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1
  } | tr ' \t' '\n\n' | grep -v '^$' | grep -vE '^(127\.|::1$)' | sort -u || true
  printf '127.0.0.1\n'
}

# A password no configured deployment can be using - only for the control
# connection that decides whether an address enforces passwords at all.
WRONG_PASSWORD="agrilink-ensure-db-auth-control-$$-invalid"

enforcing_host() {
  # Print the first address whose pg_hba rule actually rejects a wrong
  # password. An address that accepts the control connection is "trust" and
  # cannot verify anything; an address that fails for another reason (not
  # listening, no route) cannot verify anything either.
  for host in $(candidate_hosts); do
    if connect "$host" "$WRONG_PASSWORD" "$CONTROL_ERR"; then
      err "  note: connections from ${host} are trusted without a password - cannot verify credentials there."
      continue
    fi
    if grep -qiE 'authentication failed|no pg_hba\.conf entry|does not exist|not permitted' "$CONTROL_ERR"; then
      printf '%s' "$host"
      return 0
    fi
    err "  note: ${host} unusable for the credential probe: $(last_psql_error "$CONTROL_ERR")"
  done
  return 1
}

if PROBE_HOST="$(enforcing_host)"; then
  PASSWORD_ENFORCED=1
else
  # Every reachable address trusts unconditionally (a hand-edited pg_hba.conf).
  # Nothing can be verified, so reconcile the password unconditionally instead
  # of reporting a green light we did not earn. ALTER ROLE is idempotent.
  PASSWORD_ENFORCED=0
  PROBE_HOST=127.0.0.1
  err "No address on this cluster enforces password authentication (pg_hba.conf trusts every peer),"
  err "so the configured password cannot be verified - re-applying it from the Compose configuration."
fi

probe() { # true only when the configured password is proven to work
  [ "$PASSWORD_ENFORCED" = 1 ] || return 1
  connect "$PROBE_HOST" "$POSTGRES_PASSWORD" "$PROBE_ERR"
}

verify() { # re-check after a repair; unverifiable clusters accept the ALTER
  if [ "$PASSWORD_ENFORCED" = 1 ]; then
    probe
  else
    return 0
  fi
}

try_repair() { # $1 = role, $2 = database, $3 = SQL, $4 = stderr capture file
  # psql over the local socket. The official Postgres image trusts local socket
  # connections (initdb --auth-local=trust). psql variables quote both the
  # identifier and the password; \getenv keeps the password out of process
  # arguments and out of the SQL text.
  printf '%s\n' "$3" | psql -X -w -h /var/run/postgresql -U "$1" -d "$2" \
    -v ON_ERROR_STOP=1 >/dev/null 2>"$4"
}

# Reconcile the existing role's password with the configured one.
SQL_RESET_PASSWORD="$(cat <<'SQL'
\getenv db_user POSTGRES_USER
\getenv db_password POSTGRES_PASSWORD
ALTER ROLE :"db_user" WITH LOGIN SUPERUSER PASSWORD :'db_password';
SQL
)"

# Same, plus create the configured database if it is missing (e.g. the volume
# predates a KABILA_DB_NAME rename). No-op when it already exists.
SQL_RESET_PASSWORD_AND_DB="$(cat <<'SQL'
\getenv db_user POSTGRES_USER
\getenv db_password POSTGRES_PASSWORD
\getenv db_name POSTGRES_DB
ALTER ROLE :"db_user" WITH LOGIN SUPERUSER PASSWORD :'db_password';
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
SQL
)"

# Recreate the configured role and database from scratch - used only when the
# configured role cannot log in over the socket at all (cluster initialized by
# a different bootstrap user, or the role was dropped). Connected as the
# bootstrap superuser ("postgres"), which exists in every cluster. Nothing
# pre-existing is dropped: only additions are made.
SQL_CREATE_ROLE_AND_DB="$(cat <<'SQL'
\getenv db_user POSTGRES_USER
\getenv db_password POSTGRES_PASSWORD
\getenv db_name POSTGRES_DB
SELECT format('CREATE ROLE %I LOGIN SUPERUSER PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') \gexec
ALTER ROLE :"db_user" WITH LOGIN SUPERUSER PASSWORD :'db_password';
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
SQL
)"

if probe; then
  printf 'unchanged\n'
  exit 0
fi

if [ "$PASSWORD_ENFORCED" = 1 ]; then
  err "Verification database rejected its configured credentials - reconciling without touching the volume."
  reason="$(last_psql_error "$PROBE_ERR")"
  if [ -n "$reason" ]; then
    err "  server said: ${reason}"
  fi
fi

# Attempt 1: the configured role over the socket (trust by default).
if try_repair "$POSTGRES_USER" "$POSTGRES_DB" "$SQL_RESET_PASSWORD" "$SOCKET_ERR" && verify; then
  err "Verification database password re-synced to its Compose configuration."
  printf 'repaired\n'
  exit 0
fi

# Attempt 2: the configured role via the always-present "postgres" database
# (covers a missing POSTGRES_DB on a volume that predates KABILA_DB_NAME).
if try_repair "$POSTGRES_USER" postgres "$SQL_RESET_PASSWORD_AND_DB" "$SOCKET_ERR" && verify; then
  err "Verification database password re-synced; database present."
  printf 'repaired\n'
  exit 0
fi
err "  socket repair as '${POSTGRES_USER}' failed: $(last_psql_error "$SOCKET_ERR")"

# Attempt 3: the configured role does not exist (or lost superuser) - recreate
# it through the cluster's bootstrap superuser.
err "  configured role could not log in over the socket; trying the cluster's bootstrap superuser…"
if try_repair postgres postgres "$SQL_CREATE_ROLE_AND_DB" "$SOCKET_ERR" && verify; then
  err "Created the verification DB role/database from the Compose configuration."
  err "NOTE: nothing pre-existing was deleted. If this cluster previously held verification"
  err "data under a different role or database, point KABILA_DB_USER/KABILA_DB_NAME in .env"
  err "at those values instead of starting over."
  printf 'created\n'
  exit 0
fi

err "Could not reconcile the verification DB credentials through the local socket."
err "  last error: $(last_psql_error "$SOCKET_ERR")"
err "No data was deleted. Common causes:"
err "  • local (socket) authentication on this volume is not 'trust' - inspect with:"
err "      docker compose exec kyc-db cat \"\$PGDATA/pg_hba.conf\""
err "  • the data directory predates Compose's POSTGRES_USER entirely"
err "  Also check: docker compose logs --tail=50 kyc-db"
exit 1
