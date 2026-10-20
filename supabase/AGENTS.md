# supabase: schema, RLS, Storage

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của cơ sở dữ liệu.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `migrations/0001_init.sql` | `profiles`, `students`, `sessions`, `session_attendance`, `assignments`, `submissions`, `submission_files`; RLS; bucket `submissions`, `boards` |
| `migrations/0002_ai_grading.sql` | `ai_grading_suggestions`, `ai_usage_log` (Giai đoạn 3) |
| `migrations/0003_api_only_writes.sql` | Trình duyệt chỉ đọc `students`, `sessions`; che cột riêng tư của `students` (ghi qua API) |
| `migrations/0004_session_finalize.sql` | `sessions.finalized_at`: buổi completed còn việc đóng phòng/lưu bảng chờ API thử lại |
| `migrations/0005_student_deleting.sql` | `students.deleting_at`: học sinh đang xóa dở, API làm tiếp |
| `migrations/0007_upload_intent_cleaned.sql` | `board_upload_intents.cleaned_at`: đã dọn lần này; hàng chỉ do uploader xóa |
| `migrations/0006_board_upload_intents.sql` | `board_upload_intents`: hàng ghi trước khi tải bảng lên Storage, để xóa học sinh không để lại file mồ côi (chỉ service role) |
| `migrations/0008_private_teaching_notes.sql` | Ghi chú riêng, chủ đề thuộc GV, liên kết vào buổi completed; RLS chỉ GV đọc; RPC chỉ API ghi nguyên tử với revision và khóa hàng |
| `rollback/0008_private_teaching_notes.sql` | Chỉ gỡ 0008 khi cả 3 bảng trống; có dữ liệu thì dừng. Không tự chạy trên dịch vụ thật |
| `tests/teaching_notes_test.sh`, `tests/teaching_notes_rollback_test.sh` | Hai kết nối thật kiểm CAS/lưu trong lúc xóa; rollback chặn dữ liệu, gỡ trống và áp lại. `run.sh` gọi cả hai |
| `migrations/0009_weekly_slots.sql` | Lịch cố định hằng tuần (`weekly_slots`, chỉ GV sở hữu đọc, chỉ API ghi); `sessions.slot_id/slot_date` unique: mỗi ngày của lịch một buổi, nhiều tiến trình sinh cùng lúc vẫn không trùng |
| `rollback/0009_weekly_slots.sql`, `tests/weekly_slots_rollback_test.sh` | Chỉ gỡ 0009 khi chưa có lịch nào; có lịch thì dừng. `run.sh` gọi test |
| `seed.sql` | Hướng dẫn tạo dữ liệu mẫu (không chứa dữ liệu thật) |
| `tests/00_supabase_stub.sql` | Giả lập schema `auth`, `storage` để chạy trên PostgreSQL thường |
| `tests/90_rls_test.sql` | Ca kiểm thử RLS, in `RLS OK` khi đạt |
| `tests/run.sh` | Tạo DB tạm, áp mọi migration, chạy test RLS và `handshake_test.sh`; CI chạy ở job `rls` (`postgres:16`) |
| `tests/handshake_test.sh` | Hai kết nối `psql` độc lập, đủ 6 thứ tự xen kẽ của bắt tay lưu bảng/xóa học sinh (quyết định 19). Thoát 1 khi vi phạm bất biến, 2 khi psql lỗi/kết nối đóng/quá giờ/kết quả không phải đúng `0` hoặc `1` |
| `tests/handshake_negative_test.sh` | Ca âm: chứng minh `handshake_test.sh` không báo đạt khi SQL lỗi, kết nối đóng, treo, kết quả lạ, ghi hụt, bắt tay viết sai |
| `verify_migrations.sql` | Kiểm tra chỉ đọc sau khi áp 0003–0007 lên Supabase thật (dán vào SQL Editor), xem `docs/acceptance.md` |

## Công thức thay đổi schema

1. Tạo file mới `migrations/000N_ten_ngan.sql` (số tiếp theo). **Không sửa migration đã có** (hook chặn).
2. Bảng mới: `enable row level security` và policy tối thiểu ngay trong file đó.
3. Thêm ca vào `tests/90_rls_test.sql`: người được phép thấy, người khác không thấy.
4. Chạy `PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh`. Không có `psql` mà có Docker (Git Bash):
   `MSYS_NO_PATHCONV=1 docker run -d --rm --name rls-pg -e POSTGRES_PASSWORD=test -v "$(pwd -W)/supabase:/work" postgres:16`, chờ vài giây, rồi
   `MSYS_NO_PATHCONV=1 docker exec -e PGUSER=postgres rls-pg bash /work/tests/run.sh`, xong `docker stop rls-pg`.
   Không có Docker, có WSL Ubuntu (không cần sudo): `apt-get download postgresql-16 postgresql-client-16 libpq5`, `dpkg -x` từng gói vào một thư mục, đặt `LD_LIBRARY_PATH` tới `usr/lib/x86_64-linux-gnu` và `PATH` tới `usr/lib/postgresql/16/bin` trong thư mục đó, `initdb` rồi `pg_ctl start` với socket riêng. Gói này có contrib nên `pgcrypto` là bản thật; không dùng extension rỗng để báo đạt.
   Không chạy được thì ghi rõ "chưa chạy" trong `docs/progress.md`.
5. Bảng mới mà trình duyệt chỉ cần đọc: `revoke all` rồi `grant select` (Supabase mặc định cấp mọi quyền). Thao tác ghi đi qua API (quyết định 12).
6. Cập nhật model trong `apps/api/app/models.py` và `Repository` nếu API dùng bảng mới.
