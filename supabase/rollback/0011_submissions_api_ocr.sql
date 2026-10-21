-- Gỡ 0011 (chỉ khi chưa có kết quả OCR nào). Có dữ liệu thì dừng, không xóa ngầm.
-- Không tự chạy trên dịch vụ thật; sau khi gỡ, API nộp bài/OCR không còn chạy đúng.
do $$ begin
  if exists (select 1 from public.submission_transcripts) then
    raise exception 'submission_transcripts còn dữ liệu: không gỡ 0011';
  end if;
end $$;

drop table public.submission_transcripts;

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'submissions';

drop policy submissions_objects_teacher_select on storage.objects;
create policy submissions_objects_student_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );
create policy submissions_objects_teacher_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'submissions'
    and public.is_teacher()
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1] and st.teacher_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'submissions'
    and public.is_teacher()
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1] and st.teacher_id = auth.uid()
    )
  );

drop policy submission_files_teacher_select on public.submission_files;
create policy submission_files_teacher_all on public.submission_files
  for all using (
    public.is_teacher()
    and exists (
      select 1 from public.submissions sb
      join public.students st on st.id = sb.student_id
      where sb.id = submission_id and st.teacher_id = auth.uid()
    )
  )
  with check (
    public.is_teacher()
    and exists (
      select 1 from public.submissions sb
      join public.students st on st.id = sb.student_id
      where sb.id = submission_id and st.teacher_id = auth.uid()
    )
  );
create policy submission_files_student_insert on public.submission_files
  for insert with check (
    kind = 'original'
    and exists (select 1 from public.submissions sb where sb.id = submission_id and sb.student_id = public.my_student_id())
  );

drop policy submissions_teacher_select on public.submissions;
create policy submissions_teacher_all on public.submissions
  for all using (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  )
  with check (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  );
create policy submissions_student_insert on public.submissions
  for insert with check (student_id = public.my_student_id() and status = 'submitted');

drop policy assignments_teacher_select on public.assignments;
create policy assignments_teacher_all on public.assignments
  for all using (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  )
  with check (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  );

-- Quyền mặc định của Supabase trước 0011
grant all on public.assignments, public.submissions, public.submission_files to anon, authenticated;
