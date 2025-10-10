#!/usr/bin/env bash

set -euo pipefail

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not found on PATH" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not found on PATH" >&2
  exit 1
fi

NEON_URL="${NEON_DATABASE_URL:-${DATABASE_URL_NEON:-}}"
LOCAL_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-postgresql://awesomeposter:awesomeposter@localhost:5432/awesomeposter?sslmode=disable}}"

if [[ -z "${NEON_URL}" ]]; then
  echo "NEON_DATABASE_URL (or DATABASE_URL_NEON) must be set to your Neon connection string" >&2
  exit 1
fi

TABLES_INPUT="${SYNC_CLIENT_TABLES:-client_feature_toggle_audits client_features client_profiles discovery_sources clients}"
read -r -a TABLES <<< "${TABLES_INPUT}"

if [[ ${#TABLES[@]} -eq 0 ]]; then
  echo "No tables selected. Set SYNC_CLIENT_TABLES to a space-delimited list." >&2
  exit 1
fi

TMP_SQL="$(mktemp -t awesomeposter-clients.XXXXXX.sql)"
trap 'rm -f "${TMP_SQL}"' EXIT

PG_DUMP_ARGS=(
  --data-only
  --column-inserts
  --no-owner
  --no-privileges
)

for table in "${TABLES[@]}"; do
  PG_DUMP_ARGS+=( "--table=${table}" )
done

echo "Exporting tables from Neon → ${TMP_SQL}"
pg_dump "${NEON_URL}" "${PG_DUMP_ARGS[@]}" > "${TMP_SQL}"

echo "Truncating local tables: ${TABLES_INPUT}"
TRUNCATE_LIST=$(printf "%s, " "${TABLES[@]}")
TRUNCATE_LIST="${TRUNCATE_LIST%, }"

psql "${LOCAL_URL}" <<SQL
BEGIN;
SET session_replication_role = replica;
TRUNCATE TABLE ${TRUNCATE_LIST} RESTART IDENTITY CASCADE;
SET session_replication_role = DEFAULT;
COMMIT;
SQL

echo "Importing data into local database"
psql "${LOCAL_URL}" -v ON_ERROR_STOP=1 <<SQL
SET session_replication_role = replica;
\i ${TMP_SQL}
SET session_replication_role = DEFAULT;
SQL

echo "Client tables synced successfully."
