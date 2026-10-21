-- ============================================================================
-- 0011_submissions_api_ocr.sql: bài tập, bài nộp, ảnh bài làm chỉ ghi qua API; kết quả OCR riêng GV
-- Lý do: API kiểm loại/dung lượng ảnh và gỡ EXIF/GPS trước khi lưu (học sinh vị thành niên), kiểm
-- nghiệp vụ một nơi (quyết định 12). Trình duyệt chỉ còn đọc trong giới hạn RLS. API dùng service role.
-- ============================================================================

-- assignments / submissions / submission_files: bỏ quyền ghi của trình duyệt
revoke all on public.assignments, public.submissions, public.submission_files from anon, authenticated;
grant select on public.assignments, public.submissions, public.submission_files to authenticated;

drop policy assignments_teacher_all on public.assignments;
create policy assignments_teacher_select on public.assignments
  for select using (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  );

drop policy submissions_teacher_all on public.submissions;
drop policy submissions_student_insert on public.submissions;
create policy submissions_teacher_select on public.submissions
  for select using (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  );

drop policy submission_files_teacher_all on public.submission_files;
drop policy submission_files_student_insert on public.submission_files;
create policy submission_files_teacher_select on public.submission_files
  for select using (
    public.is_teacher()
    and exists (
      select 1 from public.submissions sb
      join public.students st on st.id = sb.student_id
      where sb.id = submission_id and st.teacher_id = auth.uid()
    )
  );

-- Storage bucket submissions: trình duyệt chỉ đọc (tạo URL ký), tải lên qua API
drop policy submissions_objects_student_insert on storage.objects;
drop policy submissions_objects_teacher_all on storage.objects;
create policy submissions_objects_teacher_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and public.is_teacher()
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1] and st.teacher_id = auth.uid()
    )
  );
-- Chỉ ảnh; PDF chưa hỗ trợ ở API
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'submissions';

-- Kết quả đọc chữ (OCR) từ ảnh bài làm: gợi ý cho giáo viên, học sinh không thấy. Xóa theo bài nộp.
create table public.submission_transcripts (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions (id) on delete cascade,
  model          text not null,
  content        text not null check (length(content) <= 50000),
  created_at     timestamptz not null default now()
);
create index submission_transcripts_sub_idx on public.submission_transcripts (submission_id, created_at desc);

alter table public.submission_transcripts enable row level security;
revoke all on public.submission_transcripts from anon, authenticated;
grant select on public.submission_transcripts to authenticated;

create policy submission_transcripts_teacher_select on public.submission_transcripts
  for select using (
    public.is_teacher()
    and exists (
      select 1 from public.submissions sb
      join public.students st on st.id = sb.student_id
      where sb.id = submission_id and st.teacher_id = auth.uid()
    )
  );
