-- ============================================================================
-- 0006_board_upload_intents.sql: lưu bảng không để lại file mồ côi khi xóa học sinh cùng lúc
-- API ghi một hàng trước khi tải bảng cuối buổi lên bucket `boards` và xóa khi xong. Việc xóa học
-- sinh chờ đến khi hết hàng của học sinh đó mới dọn Storage (quyết định 19). Hàng bỏ dở (tiến trình
-- chết) được vòng lặp nền dọn bù.
-- Cố ý không có khóa ngoại tới students/sessions: hàng phải còn sau khi hồ sơ đã xóa để dọn bù.
-- Chỉ chứa id, không có nội dung bảng. Chỉ API (service role) dùng: trình duyệt không có quyền gì.
-- ============================================================================

create table public.board_upload_intents (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null,
  session_id  uuid not null,
  created_at  timestamptz not null default now()
);
create index board_upload_intents_student_idx on public.board_upload_intents (student_id);
create index board_upload_intents_created_idx on public.board_upload_intents (created_at);

alter table public.board_upload_intents enable row level security;
revoke all on public.board_upload_intents from anon, authenticated;
-- Không có policy: chỉ service role (bỏ qua RLS) đọc ghi được
