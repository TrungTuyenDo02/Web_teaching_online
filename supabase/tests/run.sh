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
# Catalog verifier phải trả đủ 16 mục và tất cả đều đạt, không chỉ chạy SQL không lỗi.
checks="$(psql -X -v ON_ERROR_STOP=1 -q -A -t -d "$DB" -f "$HERE/../verify_migrations.sql")"
checked=0
while IFS='|' read -r label result; do
  [ "$result" = t ] || { echo "Kiểm schema KHÔNG đạt: $label ($result)"; exit 1; }
  checked=$((checked + 1))
done <<< "$checks"
[ "$checked" = 16 ] || { echo "Thiếu mục kiểm schema: $checked/16"; exit 1; }
echo 'verify_migrations: 16/16 đạt'
# pgcrypto phải là bản thật (có contrib), không phải extension rỗng dựng tạm
psql -v ON_ERROR_STOP=1 -q -A -t -d "$DB" -c "select 'pgcrypto ' || extversion || ' ' || left(gen_salt('bf'), 4) from pg_extension where extname = 'pgcrypto'"
run "$HERE/90_rls_test.sql" | grep -E 'RLS OK' || { echo "RLS test KHÔNG đạt"; exit 1; }
bash "$HERE/teaching_notes_test.sh" "$DB" || { echo "Giao dịch ghi chú hai kết nối KHÔNG đạt"; exit 1; }
bash "$HERE/teaching_notes_rollback_test.sh" "$DB" || { echo "Hoàn tác ghi chú KHÔNG đạt"; exit 1; }
bash "$HERE/weekly_slots_rollback_test.sh" "$DB" || { echo "Hoàn tác lịch cố định KHÔNG đạt"; exit 1; }
bash "$HERE/handshake_test.sh" "$DB" || { echo "Bắt tay hai kết nối KHÔNG đạt"; exit 1; }
bash "$HERE/handshake_negative_test.sh" "$DB" || { echo "Kiểm tra âm của bắt tay KHÔNG đạt"; exit 1; }

psql -q -d postgres -c "drop database $DB"
echo "Xong: migration và RLS đạt."
