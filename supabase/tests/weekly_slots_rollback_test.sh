#!/usr/bin/env bash
# Rollback 0009 phải từ chối khi còn lịch, chỉ gỡ được khi trống; sau đó migration áp lại được.
set -euo pipefail
DB="${1:?cần tên database test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SLOT=f0f0f0f0-0009-0000-0000-0000000000aa
sql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
file() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
sql "insert into public.students(id,teacher_id,full_name) values ('aaaaaaaa-0009-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Fake slot rollback');
insert into public.weekly_slots(id,teacher_id,student_id,weekday,start_time,duration_minutes,starts_on)
values ('$SLOT','11111111-1111-1111-1111-111111111111','aaaaaaaa-0009-0000-0000-000000000001',1,'08:00',60,current_date)" >/dev/null
if output="$(file "$HERE/../rollback/0009_weekly_slots.sql" 2>&1)"; then
  echo 'LỖI: rollback bỏ lịch đang có'; exit 1
fi
[[ "$output" = *'Còn lịch cố định M1a.3'* ]] || { echo "$output"; exit 2; }
[ "$(sql "select count(*) from public.weekly_slots where id='$SLOT'")" = 1 ]
sql "delete from public.students where id='aaaaaaaa-0009-0000-0000-000000000001'" >/dev/null
file "$HERE/../rollback/0009_weekly_slots.sql"
[ "$(sql "select count(*) from information_schema.columns where table_schema='public' and table_name='sessions' and column_name in ('slot_id','slot_date')")" = 0 ]
file "$HERE/../migrations/0009_weekly_slots.sql"
[ "$(sql "select relrowsecurity from pg_class where oid = to_regclass('public.weekly_slots')")" = t ]
echo 'đạt lịch cố định rollback: từ chối khi còn lịch, gỡ khi trống và áp lại được'
