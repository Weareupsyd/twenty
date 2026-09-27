#!/bin/sh
set -e

# Run pending database migrations before starting the API. MIGRATIONS_LENIENT
# may skip individual SQL files with unavailable community-edition prerequisites;
# it must not hide connection/authentication failures or runner failures. Starting
# without a usable database produces misleading 401s and a false healthy API.
# Supabase-only deployments without DATABASE_URL still use supabase db push.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set - skipping auto-migrate (SUPABASE_URL deployments migrate with 'supabase db push')"
elif [ ! -d "${MIGRATIONS_DIR:-/app/migrations}" ]; then
  echo "No migrations directory found at ${MIGRATIONS_DIR:-/app/migrations} - skipping auto-migrate"
else
  echo "Running database migrations..."
  if ! node dist/scripts/migrate.js; then
    echo "Database migrations failed - refusing to start the API. Check database credentials/connectivity and migration errors above." >&2
    echo "For AgriLink, run ./start.sh on the host to reconcile kyc-db credentials without deleting its volume." >&2
    exit 1
  fi
fi

# The combined console uses both public.* and compliance/aml.*. These
# migrations run after the Kabila schema, and are safe to replay on restart.
COMPLIANCE_MIGRATIONS_DIR="${COMPLIANCE_MIGRATIONS_DIR:-/app/compliance-migrations}"
if [ -n "${DATABASE_URL:-}" ] && [ -d "$COMPLIANCE_MIGRATIONS_DIR" ]; then
  echo "Applying compliance-stack migrations..."
  if ! MIGRATIONS_DIR="$COMPLIANCE_MIGRATIONS_DIR" node dist/scripts/migrate.js; then
    echo "Compliance-stack migrations failed - refusing to start the API. Fix the reported error and restart to retry both migration sets." >&2
    exit 1
  fi
elif [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set - skipping compliance-stack migrations"
else
  echo "No compliance migrations directory found at $COMPLIANCE_MIGRATIONS_DIR - skipping"
fi

echo "Starting Kabila API..."
exec node dist/server.js
