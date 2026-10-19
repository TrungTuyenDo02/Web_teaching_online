\set ON_ERROR_STOP on

grant usage on schema public, auth, storage to authenticated;
grant all on all tables in schema public to authenticated;
grant all on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Dữ liệu mẫu (chạy bằng quyền superuser, bỏ qua RLS)
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
update public.profiles set role = 'teacher' where id = '11111111-1111-1111-1111-111111111111';

insert into public.students (id, teacher_id, profile_id, full_name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Em A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Em B');

insert into public.sessions (teacher_id, student_id, scheduled_start, scheduled_end) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), now() + interval '1 hour'),
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now(), now() + interval '1 hour');

insert into public.submissions (id, student_id) values
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into storage.objects (bucket_id, name) values ('submissions', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/x/bai.jpg');

-- ===== Học sinh A =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

do $$ begin
  assert (select count(*) from public.sessions) = 1, 'HS A chỉ thấy 1 buổi học của mình';
  assert (select count(*) from public.students) = 1, 'HS A chỉ thấy hồ sơ của mình';
  assert (select count(*) from public.profiles) = 1, 'HS A chỉ thấy profile của mình';
  assert (select count(*) from public.submissions) = 0, 'HS A không thấy bài nộp của HS B';
end $$;

-- A nộp bài cho chính mình: được
insert into public.submissions (student_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- A nộp bài thay B: bị chặn
do $$ begin
  begin
    insert into public.submissions (student_id) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    raise exception 'LỖI: HS A nộp bài thay HS B được';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A tự nâng quyền thành giáo viên: bị chặn (không có hàng nào bị đổi hoặc báo lỗi)
do $$ begin
  begin
    update public.profiles set role = 'teacher' where id = '22222222-2222-2222-2222-222222222222';
    assert (select role from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'student',
      'LỖI: HS A tự thành giáo viên';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A không ghi được điểm danh
do $$ begin
  begin
    insert into public.session_attendance (session_id, profile_id)
    select id, '22222222-2222-2222-2222-222222222222' from public.sessions limit 1;
    raise exception 'LỖI: HS A ghi được điểm danh';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A không sửa được buổi học
do $$ declare n int; begin
  update public.sessions set summary = 'hack';
  get diagnostics n = row_count;
  assert n = 0, 'LỖI: HS A sửa được buổi học';
end $$;

-- Storage: A tải lên thư mục của mình được, của B thì không
insert into storage.objects (bucket_id, name) values ('submissions', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/x/bai.jpg');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('submissions', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/y/bai.jpg');
    raise exception 'LỖI: HS A tải file vào thư mục của HS B';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'submissions') = 1, 'HS A chỉ thấy file của mình';
end $$;
rollback;

-- ===== Giáo viên =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  assert (select count(*) from public.sessions) = 2, 'GV thấy 2 buổi học';
  assert (select count(*) from public.students) = 2, 'GV thấy 2 học sinh';
  assert (select count(*) from public.profiles) = 3, 'GV thấy 3 profile';
  assert (select count(*) from public.submissions) = 1, 'GV thấy bài nộp';
  assert (select count(*) from storage.objects where bucket_id = 'submissions') = 1, 'GV thấy file của học sinh mình';
end $$;
update public.submissions set status = 'returned', score = 8.5, teacher_comment = 'Tốt' where id = 'b0b0b0b0-0000-0000-0000-00000000000b';
rollback;

-- ===== Người lạ (không có profile giáo viên, không gắn học sinh) =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
do $$ begin
  assert (select count(*) from public.sessions) = 0, 'Người lạ không thấy buổi học';
  assert (select count(*) from public.students) = 0, 'Người lạ không thấy học sinh';
  assert (select count(*) from storage.objects) = 0, 'Người lạ không thấy file';
end $$;
rollback;

select 'RLS OK' as ket_qua;
