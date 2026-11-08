#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Pre-deploy step for a hosted deployment: bring the database to the current schema.
#
# Mirrors the Compose db-init service: on an empty database, apply schema.sql (the complete
# fresh-install schema, which also records every migration it already contains in the
# public.schema_migrations ledger); on an existing database, apply pending migrations with
# scripts/migrate.sh. Runs from the backend directory. Needs DATABASE_URL for a role that
# owns the public schema (on Supabase, the session-pooler string) and psql on PATH.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "predeploy: DATABASE_URL is not set; skipping database setup" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if psql "$DATABASE_URL" -tAc "select to_regclass('public.user_profiles')" | grep -q user_profiles; then
  echo "predeploy: existing database, applying pending migrations"
  bash scripts/migrate.sh up
else
  echo "predeploy: empty database, applying schema.sql"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
fi
echo "predeploy: database ready"
