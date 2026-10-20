#!/usr/bin/env bash
# Hai kết nối thật: CAS không ghi đè và xóa thắng thì không tạo lại ghi chú.
set -euo pipefail
DB="${1:?cần tên database test}"
STUDENT=aaaaaaaa-0008-0000-0000-000000000001
SESSION=cccccccc-0008-0000-0000-000000000001
TEACHER=11111111-1111-1111-1111-111111111111
MARK=__notes_done__
APP="notes_test_${BASHPID}"
sql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
sql "insert into public.students(id,teacher_id,full_name) values ('$STUDENT','$TEACHER','Fake notes test');
insert into public.sessions(id,teacher_id,student_id,status,scheduled_start,scheduled_end)
values ('$SESSION','$TEACHER','$STUDENT','completed',now(),now()+interval '1 hour');" >/dev/null
coproc A { exec psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" 2>&1; }
A_IN=${A[1]}; A_OUT=${A[0]}; A_PROC=$A_PID
coproc B { export PGAPPNAME=$APP; exec psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" 2>&1; }
B_IN=${B[1]}; B_OUT=${B[0]}; B_PROC=$B_PID
cleanup() {
  kill "$A_PROC" "$B_PROC" 2>/dev/null || true
  wait "$A_PROC" "$B_PROC" 2>/dev/null || true
  sql "delete from public.students where id='$STUDENT'" >/dev/null
}
trap cleanup EXIT
send() {
  local fd
  if [ "$1" = A ]; then fd=$A_IN; else fd=$B_IN; fi
  printf '%s\n\\echo %s\n' "$2" "$MARK" >&"$fd"
}
receive() {
  local fd line
  RESULT=""
  if [ "$1" = A ]; then fd=$A_OUT; else fd=$B_OUT; fi
  while IFS= read -r -t 15 line <&"$fd"; do
    [ "$line" = "$MARK" ] && return 0
    RESULT+="${RESULT:+|}$line"
  done
  echo "Lỗi kết nối/timeout: $RESULT" >&2; exit 2
}
run() { send "$1" "$2"; receive "$1"; }
expect() { [ "$RESULT" = "$1" ] || { echo "Kỳ vọng $1, nhận $RESULT" >&2; exit 1; }; }
wait_locked() {
  local attempt
  for attempt in $(seq 1 100); do
    if [ "$(sql "select count(*) from pg_stat_activity where application_name='$APP' and wait_event_type='Lock'")" = 1 ]; then return; fi
    sleep 0.05
  done
  echo 'Không quan sát được kết nối thứ hai chờ khóa' >&2; exit 2
}
SAVE="select public.save_teaching_record('$TEACHER','$SESSION',0,'writer A','','','',array[]::uuid[])->>'status';"
run A "set statement_timeout='10s'; begin; $SAVE"; expect ok
send B "set statement_timeout='10s'; $SAVE"
wait_locked
run A 'commit;'
receive B; expect conflict
[ "$(sql "select revision::text || ':' || summary_md from public.session_notes where session_id='$SESSION'")" = '1:writer A' ]
echo 'đạt notes: hai kết nối lưu cùng phiên bản chỉ một bên ghi được'

sql "delete from public.session_notes where session_id='$SESSION'" >/dev/null
run A "begin; with changed as (update public.students set deleting_at=now() where id='$STUDENT' returning id) select count(*) from changed;"; expect 1
send B "$SAVE"
wait_locked
run A 'commit;'
receive B; expect not_found
[ "$(sql "select count(*) from public.session_notes where session_id='$SESSION'")" = 0 ]
echo 'đạt notes: đang xóa thắng khóa thì yêu cầu lưu không tạo lại ghi chú'
