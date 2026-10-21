#!/usr/bin/env bash
# Rollback 0011 phải từ chối khi còn kết quả OCR, chỉ gỡ được khi trống; sau đó migration áp lại được.
set -euo pipefail
DB="${1:?cần tên database test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUB=f0f0f0f0-0011-0000-0000-0000000000aa
sql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
file() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
sql "delete from public.submission_transcripts;
insert into public.students(id,teacher_id,full_name) values ('aaaaaaaa-0011-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Fake OCR rollback');
insert into public.submissions(id,student_id) values ('$SUB','aaaaaaaa-0011-0000-0000-000000000001');
insert into public.submission_transcripts(submission_id,model,content) values ('$SUB','test','x')" >/dev/null
if output="$(file "$HERE/../rollback/0011_submissions_api_ocr.sql" 2>&1)"; then
  echo 'LỖI: rollback bỏ kết quả OCR đang có'; exit 1
fi
[[ "$output" = *'submission_transcripts còn dữ liệu'* ]] || { echo "$output"; exit 2; }
sql "delete from public.students where id='aaaaaaaa-0011-0000-0000-000000000001'" >/dev/null
[ "$(sql "select count(*) from public.submission_transcripts")" = 0 ]  # xóa học sinh kéo theo OCR
file "$HERE/../rollback/0011_submissions_api_ocr.sql"
[ "$(sql "select to_regclass('public.submission_transcripts') is null")" = t ]
file "$HERE/../migrations/0011_submissions_api_ocr.sql"
[ "$(sql "select has_table_privilege('authenticated','public.submissions','insert')")" = f ]
echo 'đạt bài nộp rollback: từ chối khi còn OCR, gỡ khi trống và áp lại được'
