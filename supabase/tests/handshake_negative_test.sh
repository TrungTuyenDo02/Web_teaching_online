#!/usr/bin/env bash
# Kiểm tra âm cho handshake_test.sh: chứng minh script KHÔNG báo đạt khi SQL lỗi, kết nối đóng, quá giờ,
# kết quả rỗng/lạ, câu ghi hụt, hoặc bắt tay bị viết sai làm vi phạm bất biến. run.sh gọi sau ca dương.
set -uo pipefail
DB="${1:?cần tên database}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STUDENT=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
fail=0

# expect <mã thoát mong đợi> <chuỗi phải có trong output> <mô tả> <biến=giá trị>...
expect() {
  local want=$1 pattern=$2 name=$3 out code
  shift 3
  out=$(env "$@" bash "$HERE/handshake_test.sh" "$DB" 2>&1)
  code=$?
  if [ "$code" = "$want" ] && grep -qF -- "$pattern" <<<"$out"; then
    echo "đạt (âm) $name: thoát $code"
  else
    echo "KHÔNG đạt (âm) $name: thoát $code, mong $want có '$pattern'"
    printf '%s\n' "$out" | sed 's/^/    /'
    fail=1
  fi
}

expect 2 "LỖI CHẠY" "SQL lỗi" \
  HANDSHAKE_U2="select count(*) from public.bang_khong_ton_tai;"
expect 2 "đóng" "kết nối đóng giữa chừng" \
  HANDSHAKE_D2='\q'
expect 2 "quá 1s" "truy vấn treo" \
  HANDSHAKE_TIMEOUT=1 HANDSHAKE_U2="select count(*) from pg_sleep(3);"
expect 2 "kết quả không hợp lệ" "kết quả là chữ" \
  HANDSHAKE_U2="select 'đạt';"
expect 2 "kết quả không hợp lệ" "kết quả rỗng" \
  HANDSHAKE_U2="select 1 where false;"
expect 2 "kết quả không hợp lệ" "câu lệnh thiếu dấu chấm phẩy" \
  HANDSHAKE_D2="select count(*) from public.board_upload_intents"
expect 2 "không đổi đúng một hàng" "câu ghi hụt" \
  HANDSHAKE_D1="with d as (update public.students set deleting_at = now() where false returning 1) select count(*) from d;"
# Bắt tay viết sai: bên xóa chỉ đếm bản đăng ký đã dọn, nên bỏ sót uploader đang tải
expect 1 "LỖI thứ tự [U1 U2 D1 D2]" "vi phạm bất biến" \
  HANDSHAKE_D2="select count(*) from public.board_upload_intents where student_id = '$STUDENT' and cleaned_at is not null;"

exit $fail
