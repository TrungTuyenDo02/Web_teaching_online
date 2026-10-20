#!/usr/bin/env bash
# Rollback phải từ chối khi có dữ liệu, chỉ gỡ được khi trống; sau đó migration áp lại được.
set -euo pipefail
DB="${1:?cần tên database test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TOPIC=dddddddd-0008-0000-0000-000000000001
sql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
file() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
sql "insert into public.teaching_topics(id,teacher_id,name) values ('$TOPIC','11111111-1111-1111-1111-111111111111','Fake rollback test')" >/dev/null
if output="$(file "$HERE/../rollback/0008_private_teaching_notes.sql" 2>&1)"; then
  echo 'LỖI: rollback bỏ dữ liệu đang có'; exit 1
fi
[[ "$output" = *'Còn dữ liệu M1a.2'* ]] || { echo "$output"; exit 2; }
[ "$(sql "select count(*) from public.teaching_topics where id='$TOPIC'")" = 1 ]
sql "delete from public.teaching_topics where id='$TOPIC'" >/dev/null
file "$HERE/../rollback/0008_private_teaching_notes.sql"
[ "$(sql "select count(*) from pg_class where oid in (to_regclass('public.session_notes'),to_regclass('public.session_topics'),to_regclass('public.teaching_topics'))")" = 0 ]
file "$HERE/../migrations/0008_private_teaching_notes.sql"
[ "$(sql "select count(*) from pg_class where oid in (to_regclass('public.session_notes'),to_regclass('public.session_topics'),to_regclass('public.teaching_topics')) and relrowsecurity")" = 3 ]
echo 'đạt notes rollback: từ chối khi có dữ liệu, gỡ khi trống và áp lại được'
