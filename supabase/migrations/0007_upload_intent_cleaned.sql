-- ============================================================================
-- 0007_upload_intent_cleaned.sql: phân biệt "đã dọn lần này" với "không còn khả năng ghi muộn"
-- Quá hạn không chứng minh uploader thôi ghi, nên bên xóa/vòng lặp nền không xóa hàng
-- board_upload_intents nữa: chỉ ghi cleaned_at mỗi lần đã xóa file. Hàng còn tồn tại nghĩa là
-- uploader chưa xác nhận xong; chỉ chính uploader xóa hàng khi đã biết chắc kết quả (quyết định 19).
-- Quyền giữ như 0006: trình duyệt không có quyền gì trên bảng này (kể cả cột mới).
-- ============================================================================

alter table public.board_upload_intents add column cleaned_at timestamptz;

-- Vòng lặp nền canh xoay vòng: hàng chưa dọn lần nào trước, rồi hàng dọn lâu nhất
create index board_upload_intents_cleaned_idx
  on public.board_upload_intents (cleaned_at asc nulls first, created_at);
