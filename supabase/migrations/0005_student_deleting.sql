-- ============================================================================
-- 0005_student_deleting.sql: xóa hẳn học sinh làm tiếp được khi lỗi giữa chừng
-- `deleting_at` khác null: API đang xóa dở (dọn bảng trên máy chủ bảng, tệp Storage, tài khoản).
-- Hồ sơ còn giữ đến bước cuối để lần thử lại biết id buổi học, đường dẫn và profile_id cần dọn.
-- Không cấp quyền đọc cột này cho trình duyệt (0003 cấp theo từng cột); giáo viên xem qua API.
-- ============================================================================

alter table public.students add column deleting_at timestamptz;

create index students_deleting_idx on public.students (deleting_at) where deleting_at is not null;
