-- ============================================================================
-- 0012_hide_unreturned_annotations.sql: học sinh chỉ thấy ảnh chữa (kind = 'annotated') khi bài nộp
-- đã trả. Trước đây policy 0001 cho học sinh đọc mọi ảnh của bài nộp mình, kể cả ảnh giáo viên đang
-- chữa dở. Ảnh gốc giữ nguyên quyền đọc. Ghi vẫn chỉ qua API (0011).
-- ============================================================================

-- Security definer: policy Storage bên dưới phải thấy cả hàng ảnh chữa mà RLS đã ẩn khỏi học sinh
create or replace function public.is_unreturned_annotation(path text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.submission_files f
    join public.submissions sb on sb.id = f.submission_id
    where f.storage_path = path and f.kind = 'annotated' and sb.status <> 'returned'
  );
$$;
revoke execute on function public.is_unreturned_annotation(text) from public, anon;
grant execute on function public.is_unreturned_annotation(text) to authenticated;

drop policy submission_files_student_select on public.submission_files;
create policy submission_files_student_select on public.submission_files
  for select using (
    exists (
      select 1 from public.submissions sb
      where sb.id = submission_id
        and sb.student_id = public.my_student_id()
        and (kind = 'original' or sb.status = 'returned')
    )
  );

drop policy submissions_objects_student_select on storage.objects;
create policy submissions_objects_student_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.my_student_id()::text
    and not public.is_unreturned_annotation(name)
  );
