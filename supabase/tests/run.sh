#!/usr/bin/env bash
# Kiểm thử migration và chính sách RLS trên một PostgreSQL cục bộ (không cần Supabase).
# Cần: PostgreSQL 15+ đang chạy; đặt PGHOST/PGPORT/PGUSER cho vai trò có quyền tạo database và role.
# Ví dụ: PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail

DB="${TEST_DB:-tutor_rls_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../migrations"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"

run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }

run "$HERE/00_supabase_stub.sql"
for migration in "$MIGRATIONS"/*.sql; do
  echo "áp dụng $(basename "$migration")"
  run "$migration"
done
run "$HERE/90_rls_test.sql" | grep -E 'RLS OK' || { echo "RLS test KHÔNG đạt"; exit 1; }

psql -q -d postgres -c "drop database $DB"
echo "Xong: migration và RLS đạt."
