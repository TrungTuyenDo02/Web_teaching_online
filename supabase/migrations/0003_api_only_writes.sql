-- ============================================================================
-- 0003_api_only_writes.sql: học sinh và buổi học chỉ được ghi qua API
-- Lý do: một nơi duy nhất kiểm tra nghiệp vụ (có test), dùng chung cho web và sau này cho
-- trợ lý AI thay mặt giáo viên. Trình duyệt chỉ còn quyền đọc trong giới hạn RLS.
-- Đồng thời che các cột riêng tư của giáo viên (ghi chú, liên hệ phụ huynh, đồng ý): RLS chỉ lọc
-- hàng, nên học sinh đọc hàng của mình vẫn thấy mọi cột. Giáo viên đọc các cột này qua API.
-- API dùng service role nên không bị ảnh hưởng.
-- ============================================================================

-- students: bỏ mọi quyền ghi; chỉ đọc các cột không riêng tư
revoke all on public.students from anon, authenticated;
grant select (id, teacher_id, profile_id, full_name, grade, goals, active, created_at)
  on public.students to authenticated;

drop policy students_teacher_all on public.students;
create policy students_teacher_select on public.students
  for select using (teacher_id = auth.uid() and public.is_teacher());

-- sessions: chỉ đọc; tạo, sửa, hủy, vào lớp, kết thúc đều qua API
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to authenticated;

drop policy sessions_teacher_all on public.sessions;
create policy sessions_teacher_select on public.sessions
  for select using (teacher_id = auth.uid() and public.is_teacher());
