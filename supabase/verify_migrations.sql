-- Kiểm tra CHỈ ĐỌC sau khi áp migration 0003–0009 lên Supabase (dán vào SQL Editor, bấm Run).
-- Mỗi dòng một mục; cột `dat` phải là true hết. null nghĩa là thiếu cột/bảng (migration chưa áp).
-- Không đọc dữ liệu học sinh, chỉ đọc catalog và đếm số buổi.
with col as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
)
select muc, dat from (values
  (1, '0003: trình duyệt không ghi được students',
      not has_table_privilege('authenticated', 'public.students', 'insert')
      and not has_table_privilege('authenticated', 'public.students', 'update')),
  (2, '0003: trình duyệt không ghi được sessions',
      not has_table_privilege('authenticated', 'public.sessions', 'insert')
      and not has_table_privilege('authenticated', 'public.sessions', 'update')),
  (3, '0003: trình duyệt không đọc được students.notes',
      not has_column_privilege('authenticated', 'public.students', 'notes', 'select')),
  (4, '0004: có cột sessions.finalized_at',
      exists (select 1 from col where table_name = 'sessions' and column_name = 'finalized_at')),
  (5, '0004: buổi completed cũ đã đánh dấu xong (không đóng lại hàng loạt)',
      case when exists (select 1 from col where table_name = 'sessions' and column_name = 'finalized_at')
           then (select count(*) = 0 from public.sessions
                 where status = 'completed' and ended_at < now() - interval '1 day'
                   and (to_jsonb(sessions) ->> 'finalized_at') is null) end),
  (6, '0005: có cột students.deleting_at',
      exists (select 1 from col where table_name = 'students' and column_name = 'deleting_at')),
  (7, '0005: trình duyệt không đọc được students.deleting_at',
      case when exists (select 1 from col where table_name = 'students' and column_name = 'deleting_at')
           then not has_column_privilege('authenticated', 'public.students', 'deleting_at', 'select') end),
  (8, '0006: có bảng board_upload_intents, bật RLS',
      (select relrowsecurity from pg_class where oid = to_regclass('public.board_upload_intents'))),
  (9, '0006: anon/authenticated không có quyền gì trên board_upload_intents',
      case when to_regclass('public.board_upload_intents') is not null
           then not exists (select 1 from information_schema.role_table_grants
                            where table_schema = 'public' and table_name = 'board_upload_intents'
                              and grantee in ('anon', 'authenticated')) end),
  (10, '0007: có cột board_upload_intents.cleaned_at',
      exists (select 1 from col where table_name = 'board_upload_intents' and column_name = 'cleaned_at')),
  (11, '0008: session_notes bật RLS, trình duyệt chỉ đọc',
      case when to_regclass('public.session_notes') is not null then
        (select relrowsecurity from pg_class where oid = to_regclass('public.session_notes'))
        and has_table_privilege('authenticated', to_regclass('public.session_notes'), 'select')
        and not has_table_privilege('authenticated', to_regclass('public.session_notes'), 'insert,update,delete')
        and not has_table_privilege('anon', to_regclass('public.session_notes'), 'select') end),
  (12, '0008: teaching_topics bật RLS, trình duyệt chỉ đọc',
      case when to_regclass('public.teaching_topics') is not null then
        (select relrowsecurity from pg_class where oid = to_regclass('public.teaching_topics'))
        and has_table_privilege('authenticated', to_regclass('public.teaching_topics'), 'select')
        and not has_table_privilege('authenticated', to_regclass('public.teaching_topics'), 'insert,update,delete')
        and not has_table_privilege('anon', to_regclass('public.teaching_topics'), 'select') end),
  (13, '0008: session_topics bật RLS, trình duyệt chỉ đọc',
      case when to_regclass('public.session_topics') is not null then
        (select relrowsecurity from pg_class where oid = to_regclass('public.session_topics'))
        and has_table_privilege('authenticated', to_regclass('public.session_topics'), 'select')
        and not has_table_privilege('authenticated', to_regclass('public.session_topics'), 'insert,update,delete')
        and not has_table_privilege('anon', to_regclass('public.session_topics'), 'select') end),
  (14, '0008: chỉ service_role được gọi RPC lưu ghi chú',
      has_function_privilege('service_role', to_regprocedure('public.save_teaching_record(uuid,uuid,integer,text,text,text,text,uuid[])'), 'execute')
      and not has_function_privilege('authenticated', to_regprocedure('public.save_teaching_record(uuid,uuid,integer,text,text,text,text,uuid[])'), 'execute')
      and not has_function_privilege('anon', to_regprocedure('public.save_teaching_record(uuid,uuid,integer,text,text,text,text,uuid[])'), 'execute')),
  (15, '0009: weekly_slots bật RLS, trình duyệt chỉ đọc',
      case when to_regclass('public.weekly_slots') is not null then
        (select relrowsecurity from pg_class where oid = to_regclass('public.weekly_slots'))
        and has_table_privilege('authenticated', to_regclass('public.weekly_slots'), 'select')
        and not has_table_privilege('authenticated', to_regclass('public.weekly_slots'), 'insert,update,delete')
        and not has_table_privilege('anon', to_regclass('public.weekly_slots'), 'select') end),
  (16, '0009: sessions có slot_id/slot_date, mỗi ngày của lịch một buổi',
      exists (select 1 from pg_constraint where conname = 'sessions_slot_occurrence_key'
              and conrelid = 'public.sessions'::regclass and contype = 'u'))
) as t(stt, muc, dat)
order by stt;
