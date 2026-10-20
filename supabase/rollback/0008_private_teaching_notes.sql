-- Chỉ dùng thủ công khi gỡ cả code M1a.2 và chưa có dữ liệu ghi chú/chủ đề.
-- Có bất kỳ dữ liệu nào thì dừng; không dùng DROP để bỏ dữ liệu đang dùng.
begin;
do $$ begin
  if exists (select 1 from public.session_notes)
     or exists (select 1 from public.session_topics)
     or exists (select 1 from public.teaching_topics) then
    raise exception 'Còn dữ liệu M1a.2, không hoàn tác bằng DROP';
  end if;
end $$;
drop function public.save_teaching_record(uuid, uuid, integer, text, text, text, text, uuid[]);
drop table public.session_topics;
drop table public.session_notes;
drop table public.teaching_topics;
drop function public.owns_completed_teaching_session(uuid);
commit;
