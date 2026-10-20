#!/usr/bin/env bash
# Kiểm chứng bắt tay "ghi rồi đọc" giữa lưu bảng và xóa học sinh (quyết định 19) bằng HAI kết nối
# PostgreSQL độc lập, chạy đủ 6 thứ tự xen kẽ của:
#   U (uploader): U1 ghi board_upload_intents  -> U2 đọc students.deleting_at
#   D (xóa):      D1 ghi students.deleting_at   -> D2 đọc board_upload_intents
# Mỗi câu lệnh tự commit như khi API gọi PostgREST. Bất biến: U2 thấy đang xóa HOẶC D2 thấy bản đăng ký
# (không bao giờ cả hai cùng "không thấy": uploader tải lên trong khi bên xóa đã dọn Storage).
# Cần database đã áp migration và có học sinh $STUDENT; run.sh gọi file này sau khi áp xong.
# Mã thoát: 0 đạt; 1 vi phạm bất biến; 2 lỗi chạy (psql lỗi, kết nối đóng, quá giờ, kết quả lạ).
# HANDSHAKE_U1/U2/D1/D2 thay câu lệnh, chỉ để handshake_negative_test.sh chứng minh script bắt được lỗi.
set -euo pipefail
DB="${1:?cần tên database}"
STUDENT=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
TIMEOUT="${HANDSHAKE_TIMEOUT:-30}"
MARK=__handshake_xong__

die() { echo "LỖI CHẠY: $*" >&2; exit 2; }
# Ghi vào pipe của psql đã chết phải trả lỗi cho printf, không giết cả script bằng SIGPIPE
trap '' PIPE

# bash cảnh báo "coproc still exists" khi mở coproc thứ hai: vô hại, hai kết nối vẫn độc lập
coproc U { exec psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" 2>&1; }
U_IN=${U[1]}; U_OUT=${U[0]}; U_PROC=$U_PID
coproc D { exec psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" 2>&1; }
D_IN=${D[1]}; D_OUT=${D[0]}; D_PROC=$D_PID
trap 'kill "$U_PROC" "$D_PROC" 2>/dev/null || true' EXIT

# Gửi một câu lệnh cho một kết nối, chờ dấu hoàn tất; kết quả để trong RESULT (nhiều dòng nối bằng "|").
# Không có dấu hoàn tất (psql thoát vì lỗi SQL, kết nối đóng, quá giờ) là lỗi chạy, không bao giờ là "đạt".
RESULT=""
run() {
  local conn=$1 sql=$2 fd_in fd_out line out=""
  if [ "$conn" = U ]; then fd_in=$U_IN; fd_out=$U_OUT; else fd_in=$D_IN; fd_out=$D_OUT; fi
  printf '%s\n\\echo %s\n' "$sql" "$MARK" >&"$fd_in" 2>/dev/null || die "kết nối $conn đã đóng trước khi gửi: $sql"
  while true; do
    if ! IFS= read -r -t "$TIMEOUT" line <&"$fd_out"; then
      die "kết nối $conn đóng hoặc quá ${TIMEOUT}s, không nhận dấu hoàn tất sau: $sql${out:+ (psql in: $out)}"
    fi
    [ "$line" = "$MARK" ] && break
    out+="${out:+|}$line"
  done
  RESULT=$out
}

# Kết quả đọc được phải đúng là 0 hoặc 1 (một học sinh, tối đa một bản đăng ký mỗi lượt)
run_count() {
  run "$1" "$2"
  case $RESULT in 0 | 1) ;; *) die "kết quả không hợp lệ từ $1 ('$RESULT') cho: $2" ;; esac
}

# Câu ghi phải đổi đúng một hàng: ghi hụt thì cả lượt không còn kiểm chứng điều gì
run_write() {
  run "$1" "$2"
  [ "$RESULT" = 1 ] || die "câu ghi của $1 không đổi đúng một hàng ('$RESULT'): $2"
}

reset() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" \
    -c "delete from public.board_upload_intents" \
    -c "update public.students set deleting_at = null, active = false where id = '$STUDENT'" \
    || die "không đặt lại được dữ liệu thử"
}

U1="${HANDSHAKE_U1:-with i as (insert into public.board_upload_intents (student_id, session_id) values ('$STUDENT', gen_random_uuid()) returning 1) select count(*) from i;}"
U2="${HANDSHAKE_U2:-select count(*) from public.students where id = '$STUDENT' and deleting_at is not null;}"
D1="${HANDSHAKE_D1:-with d as (update public.students set deleting_at = now() where id = '$STUDENT' and active = false and deleting_at is null returning 1) select count(*) from d;}"
D2="${HANDSHAKE_D2:-select count(*) from public.board_upload_intents where student_id = '$STUDENT';}"

[ "$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "select count(*) from public.students where id = '$STUDENT'")" = 1 ] \
  || die "thiếu học sinh thử $STUDENT trong $DB"

fail=0
for order in "U1 U2 D1 D2" "U1 D1 U2 D2" "U1 D1 D2 U2" "D1 U1 U2 D2" "D1 U1 D2 U2" "D1 D2 U1 U2"; do
  reset
  u_saw=""; d_saw=""
  for step in $order; do
    case $step in
      U1) run_write U "$U1" ;;
      U2) run_count U "$U2"; u_saw=$RESULT ;;
      D1) run_write D "$D1" ;;
      D2) run_count D "$D2"; d_saw=$RESULT ;;
    esac
  done
  if [ "$u_saw" = 0 ] && [ "$d_saw" = 0 ]; then
    echo "LỖI thứ tự [$order]: uploader không thấy đang xóa và bên xóa không thấy bản đăng ký"
    fail=1
  else
    echo "đạt [$order]: uploader thấy đang xóa=$u_saw, bên xóa thấy bản đăng ký=$d_saw"
  fi
done
reset
exit $fail
