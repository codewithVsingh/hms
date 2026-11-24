#!/usr/bin/env bash
# Local database test runner: plain PostgreSQL 15+ with the Supabase shim. Never point at a real project.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/local/run.sh [dbname]
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${1:-hms_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
"${PSQL[@]}" -d "$DB" -f tests/local/00_supabase_shim.sql
for f in migrations/*.sql; do
  echo "apply $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 | grep -v '^NOTICE' || true
  test "${PIPESTATUS[0]}" -eq 0
done
for f in tests/verify_*.sql; do
  echo "verify $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
done
# Provisioning script with synthetic values (also proves the template works end to end).
PROVISION=$(mktemp)
sed -e "s/'REPLACE_HOSPITAL_SLUG'/'test-hospital'/" -e "s/'REPLACE_HOSPITAL_NAME'/'Test Hospital'/" \
    -e "s/'REPLACE_ADMIN_EMAIL'/'admin@example.test'/" -e "s/'REPLACE_DOCTOR_EMAIL'/'doctor@example.test'/" \
    -e "s/'REPLACE_DOCTOR_NAME'/'Dr Test Doctor'/" -e "s/'REPLACE_SPECIALTY'/'General Medicine'/" \
    -e "s/'REPLACE_REGISTRATION'/'TEST-REG-1'/" -e "s/'REPLACE_RECEPTION_EMAIL'/'reception@example.test'/" \
    setup/01_provision_hospital.sql > "$PROVISION"
"${PSQL[@]}" -d "$DB" -v provision="$PROVISION" -f tests/local/10_behaviour.sql
rm -f "$PROVISION"
bash tests/local/20_concurrency.sh "$DB"
echo "database tests passed"
