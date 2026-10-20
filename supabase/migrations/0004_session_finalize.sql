-- ============================================================================
-- 0004_session_finalize.sql: việc đóng phòng/lưu bảng sau khi kết thúc buổi được lưu bền
-- Buổi `completed` mà `finalized_at` rỗng: API còn phải ghi giờ rời phòng, đóng phòng video,
-- đóng bảng và lưu bản cuối. API (vòng lặp nền hoặc gọi lại /end) thử lại đến khi xong.
-- Không thêm bảng hay policy mới: cột nằm trong `sessions`, trình duyệt chỉ đọc (0003).
-- ============================================================================

alter table public.sessions add column finalized_at timestamptz;

-- Buổi đã kết thúc trước migration này: coi như đã xong, không đóng lại hàng loạt
update public.sessions set finalized_at = coalesce(ended_at, now()) where status = 'completed';

create index sessions_finalize_pending_idx on public.sessions (ended_at)
  where status = 'completed' and finalized_at is null;
