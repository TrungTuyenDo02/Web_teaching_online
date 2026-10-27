-- Gỡ 0012: trả policy đọc ảnh bài nộp của học sinh về như 0001 (học sinh lại thấy ảnh chữa chưa trả).
-- Không xóa dữ liệu. Không tự chạy trên dịch vụ thật.
drop policy submission_files_student_select on public.submission_files;
create policy submission_files_student_select on public.submission_files
  for select using (
    exists (select 1 from public.submissions sb where sb.id = submission_id and sb.student_id = public.my_student_id())
  );

drop policy submissions_objects_student_select on storage.objects;
create policy submissions_objects_student_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

drop function public.is_unreturned_annotation(text);
