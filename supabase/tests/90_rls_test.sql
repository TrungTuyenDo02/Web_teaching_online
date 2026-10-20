\set ON_ERROR_STOP on

grant usage on schema public, auth, storage to authenticated;
-- Quyền trên bảng public đến từ default privileges trong 00_supabase_stub.sql và các migration
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
-- Bảng cuối buổi (bucket boards) của từng học sinh
insert into storage.objects (bucket_id, name) values
  ('boards', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/s1.json'),
  ('boards', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/s2.json');

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
do $$ begin
  begin
    update public.sessions set summary = 'hack';
    raise exception 'LỖI: HS A sửa được buổi học';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A đọc được tên, lớp của mình nhưng không đọc được cột riêng tư của giáo viên
do $$ begin
  assert (select full_name from public.students) = 'Em A', 'HS A đọc được họ tên của mình';
  begin
    perform notes from public.students;
    raise exception 'LỖI: HS A đọc được ghi chú riêng của giáo viên';
  exception when insufficient_privilege then null;
  end;
  begin
    perform guardian_contact from public.students;
    raise exception 'LỖI: HS A đọc được liên hệ phụ huynh';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A không tự sửa hồ sơ học sinh của mình
do $$ begin
  begin
    update public.students set full_name = 'hack';
    raise exception 'LỖI: HS A sửa được hồ sơ học sinh';
  exception when insufficient_privilege then null;
  end;
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
  assert (select count(*) from storage.objects where bucket_id = 'boards') = 1, 'HS A chỉ thấy bảng của mình';
  assert (select name from storage.objects where bucket_id = 'boards') like 'aaaaaaaa-%', 'HS A thấy đúng bảng của mình';
end $$;
-- Học sinh không ghi vào bucket boards (chỉ API lưu bảng)
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('boards', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/gia.json');
    raise exception 'LỖI: HS A tự ghi bảng vào bucket boards';
  exception when insufficient_privilege then null;
  end;
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
  assert (select count(*) from storage.objects where bucket_id = 'boards') = 2, 'GV thấy bảng của mọi học sinh mình';
end $$;
update public.submissions set status = 'returned', score = 8.5, teacher_comment = 'Tốt' where id = 'b0b0b0b0-0000-0000-0000-00000000000b';

-- GV đọc được danh sách (tên) để chọn học sinh khi tạo buổi, nhưng mọi thao tác ghi phải qua API
do $$ begin
  assert (select count(*) from public.students where active) = 2, 'GV đọc được học sinh đang học';
  begin
    insert into public.students (teacher_id, full_name)
    values ('11111111-1111-1111-1111-111111111111', 'Ghi thẳng');
    raise exception 'LỖI: GV thêm học sinh không qua API';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.students set notes = 'x';
    raise exception 'LỖI: GV sửa học sinh không qua API';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.students;
    raise exception 'LỖI: GV xóa học sinh không qua API';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sessions (teacher_id, student_id, scheduled_start, scheduled_end)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), now() + interval '1 hour');
    raise exception 'LỖI: GV tạo buổi học không qua API';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sessions set status = 'completed';
    raise exception 'LỖI: GV đổi trạng thái buổi học không qua API';
  exception when insufficient_privilege then null;
  end;
  begin
    perform deleting_at from public.students;
    raise exception 'LỖI: trình duyệt đọc được trạng thái xóa học sinh';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.students set deleting_at = now();
    raise exception 'LỖI: GV đánh dấu xóa học sinh không qua API';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sessions set finalized_at = now();
    raise exception 'LỖI: GV đánh dấu đã đóng phòng không qua API';
  exception when insufficient_privilege then null;
  end;
end $$;
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

-- ===== Khách chưa đăng nhập (anon) =====
grant usage on schema public, storage to anon;
grant select on storage.objects to anon;  -- như Supabase: anon có quyền bảng, RLS quyết định hàng
begin;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'boards') = 0, 'Khách không thấy bảng';
  assert (select count(*) from storage.objects) = 0, 'Khách không thấy file nào';
  begin
    perform 1 from public.board_upload_intents;
    raise exception 'LỖI: khách đọc được bản đăng ký tải bảng';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ===== Bản đăng ký tải bảng (0006): chỉ API, trình duyệt không đọc/ghi được =====
insert into public.board_upload_intents (student_id, session_id)
  select student_id, id from public.sessions limit 1;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    perform 1 from public.board_upload_intents;
    raise exception 'LỖI: trình duyệt đọc được bản đăng ký tải bảng';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.board_upload_intents (student_id, session_id)
      values (gen_random_uuid(), gen_random_uuid());
    raise exception 'LỖI: trình duyệt ghi được bản đăng ký tải bảng';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.board_upload_intents set cleaned_at = now();
    raise exception 'LỖI: trình duyệt đánh dấu đã dọn bản đăng ký tải bảng';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.board_upload_intents;
    raise exception 'LỖI: trình duyệt xóa được bản đăng ký tải bảng';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ===== 0008: ghi chú riêng, danh mục và liên kết chủ đề =====
begin;
insert into auth.users(id) values ('44444444-4444-4444-4444-444444444444');
update public.profiles set role = 'teacher' where id = '44444444-4444-4444-4444-444444444444';
insert into public.students(id, teacher_id, full_name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444', 'Em C giả');
update public.sessions set status = 'completed';
insert into public.sessions(id, teacher_id, student_id, scheduled_start, scheduled_end, status) values
  ('cccccccc-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now(), now() + interval '1 hour', 'completed');
insert into public.teaching_topics(id, teacher_id, name, grade) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Phương trình', '9'),
  ('dddddddd-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Số hữu tỉ', '7');

-- RPC chạy bằng quyền API, kiểm phiên bản/đổi chủ đề nguyên tử.
set local role service_role;
do $$ declare sid uuid; result jsonb; begin
  select id into sid from public.sessions where student_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  result := public.save_teaching_record('11111111-1111-1111-1111-111111111111', sid, 0,
    'riêng A', 'cần luyện', '', '', array['dddddddd-0000-0000-0000-000000000001'::uuid]);
  assert result->>'status' = 'ok' and result->'record'->>'revision' = '1', 'RPC tạo ghi chú lần đầu';
  result := public.save_teaching_record('11111111-1111-1111-1111-111111111111', sid, 0,
    'không ghi đè', '', '', '', '{}');
  assert result->>'status' = 'conflict', 'RPC từ chối phiên bản cũ';
  result := public.save_teaching_record('11111111-1111-1111-1111-111111111111', sid, 1,
    'không ghi nửa chừng', '', '', '', array['dddddddd-0000-0000-0000-000000000002'::uuid]);
  assert result->>'status' = 'invalid_topics', 'RPC từ chối chủ đề giáo viên khác';
  assert (select summary_md = 'riêng A' and revision = 1 from public.session_notes where session_id = sid), 'Lỗi giữ nguyên ghi chú';
  assert (select count(*) = 1 from public.session_topics where session_id = sid), 'Lỗi giữ nguyên chủ đề';
  result := public.save_teaching_record('44444444-4444-4444-4444-444444444444', 'cccccccc-0000-0000-0000-000000000001', 0,
    'riêng C', '', '', '', array['dddddddd-0000-0000-0000-000000000002'::uuid]);
  assert result->>'status' = 'ok', 'GV thứ hai cũng lưu được dữ liệu của mình';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  assert (select count(*) from public.teaching_topics) = 1, 'GV chỉ thấy danh mục của mình';
  assert (select count(*) from public.session_notes) = 1, 'GV chỉ thấy ghi chú của mình';
  assert (select count(*) from public.session_topics) = 1, 'GV chỉ thấy liên kết chủ đề của mình';
  begin
    perform public.save_teaching_record('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 0, '', '', '', '', '{}');
    raise exception 'LỖI: trình duyệt gọi được RPC ghi';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.teaching_topics(teacher_id, name) values ('11111111-1111-1111-1111-111111111111', 'hack');
    raise exception 'LỖI: trình duyệt ghi danh mục không qua API';
  exception when insufficient_privilege then null; end;
  begin
    update public.session_notes set summary_md = 'hack';
    raise exception 'LỖI: trình duyệt ghi chú không qua API';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.session_topics;
    raise exception 'LỖI: trình duyệt xóa liên kết không qua API';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin
  assert (select count(*) from public.teaching_topics) = 0, 'HS không thấy danh mục riêng';
  assert (select count(*) from public.session_notes) = 0, 'HS không thấy cả ghi chú buổi của chính mình';
  assert (select count(*) from public.session_topics) = 0, 'HS không thấy liên kết riêng';
end $$;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$ begin
  assert (select summary_md from public.session_notes) = 'riêng C', 'GV khác chỉ thấy đúng ghi chú của mình';
end $$;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
do $$ begin
  assert (select count(*) from public.teaching_topics) = 0, 'Người lạ không thấy danh mục';
  assert (select count(*) from public.session_notes) = 0, 'Người lạ không thấy ghi chú';
  assert (select count(*) from public.session_topics) = 0, 'Người lạ không thấy liên kết';
end $$;
reset role;

update public.students set deleting_at = now() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  assert (select count(*) from public.session_notes) = 0, 'HS đang xóa thì ẩn ghi chú';
  assert (select count(*) from public.session_topics) = 0, 'HS đang xóa thì ẩn liên kết';
end $$;
reset role;
do $$ declare result jsonb; sid uuid; begin
  select id into sid from public.sessions where student_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  result := public.save_teaching_record('11111111-1111-1111-1111-111111111111', sid, 1, 'không lưu', '', '', '', '{}');
  assert result->>'status' = 'not_found', 'RPC không ghi khi HS đang xóa';
end $$;
delete from public.students where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$ begin
  assert (select count(*) from public.session_notes) = 1, 'Xóa HS xóa dây chuyền ghi chú A, giữ C';
  assert (select count(*) from public.session_topics) = 1, 'Xóa HS xóa liên kết A, giữ C';
  assert (select count(*) from public.teaching_topics) = 2, 'Danh mục không chứa liên kết HS vẫn giữ';
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.session_notes;
    raise exception 'LỖI: khách đọc ghi chú';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.teaching_topics;
    raise exception 'LỖI: khách đọc danh mục';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.session_topics;
    raise exception 'LỖI: khách đọc liên kết';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 0009 lịch cố định: chỉ GV sở hữu đọc, trình duyệt không ghi, (slot_id, slot_date) duy nhất
insert into public.weekly_slots(id, teacher_id, student_id, weekday, start_time, duration_minutes, starts_on) values
  ('f0f0f0f0-0009-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3, '19:30', 90, current_date),
  ('f0f0f0f0-0009-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 5, '18:00', 60, current_date);
insert into public.sessions(teacher_id, student_id, scheduled_start, scheduled_end, slot_id, slot_date) values
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() + interval '1 day', now() + interval '1 day 1 hour', 'f0f0f0f0-0009-0000-0000-000000000001', current_date + 1);
do $$ begin
  begin
    insert into public.sessions(teacher_id, student_id, scheduled_start, scheduled_end, slot_id, slot_date)
      values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() + interval '2 day', now() + interval '2 day 1 hour', 'f0f0f0f0-0009-0000-0000-000000000001', current_date + 1);
    raise exception 'LỖI: sinh trùng buổi cho cùng một ngày của lịch';
  exception when unique_violation then null; end;
  begin
    insert into public.weekly_slots(teacher_id, student_id, weekday, start_time, duration_minutes, starts_on)
      values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 8, '19:30', 90, current_date);
    raise exception 'LỖI: lịch nhận thứ ngoài 1–7';
  exception when check_violation then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  assert (select count(*) from public.weekly_slots) = 1, 'GV chỉ thấy lịch cố định của mình';
  begin
    insert into public.weekly_slots(teacher_id, student_id, weekday, start_time, duration_minutes, starts_on)
      values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, '08:00', 60, current_date);
    raise exception 'LỖI: trình duyệt tạo lịch cố định không qua API';
  exception when insufficient_privilege then null; end;
  begin
    update public.weekly_slots set active = false;
    raise exception 'LỖI: trình duyệt ngừng lịch cố định không qua API';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ begin
  assert (select count(*) from public.weekly_slots) = 0, 'HS không thấy lịch cố định';
end $$;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$ begin
  assert (select count(*) from public.weekly_slots) = 1, 'GV khác chỉ thấy lịch của mình';
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.weekly_slots;
    raise exception 'LỖI: khách đọc lịch cố định';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.students where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
do $$ begin
  assert (select count(*) from public.weekly_slots) = 1, 'Xóa HS xóa lịch cố định của em, giữ lịch GV khác';
  assert (select count(*) from public.sessions where slot_id is not null) = 0, 'Buổi sinh từ lịch bị xóa cùng HS';
end $$;
rollback;

select 'RLS OK' as ket_qua;
