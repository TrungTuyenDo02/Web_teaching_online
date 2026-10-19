# supabase: schema, RLS, Storage

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của cơ sở dữ liệu.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `migrations/0001_init.sql` | `profiles`, `students`, `sessions`, `session_attendance`, `assignments`, `submissions`, `submission_files`; RLS; bucket `submissions`, `boards` |
| `migrations/0002_ai_grading.sql` | `ai_grading_suggestions`, `ai_usage_log` (Giai đoạn 3) |
| `seed.sql` | Hướng dẫn tạo dữ liệu mẫu (không chứa dữ liệu thật) |
| `tests/00_supabase_stub.sql` | Giả lập schema `auth`, `storage` để chạy trên PostgreSQL thường |
| `tests/90_rls_test.sql` | Ca kiểm thử RLS, in `RLS OK` khi đạt |
| `tests/run.sh` | Tạo DB tạm, áp mọi migration, chạy test RLS |

## Công thức thay đổi schema

1. Tạo file mới `migrations/000N_ten_ngan.sql` (số tiếp theo). **Không sửa migration đã có** (hook chặn).
2. Bảng mới: `enable row level security` và policy tối thiểu ngay trong file đó.
3. Thêm ca vào `tests/90_rls_test.sql`: người được phép thấy, người khác không thấy.
4. Chạy `PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh`. Không có PostgreSQL thì ghi rõ "chưa chạy" trong `docs/progress.md`.
5. Cập nhật model trong `apps/api/app/models.py` và `Repository` nếu API dùng bảng mới.
