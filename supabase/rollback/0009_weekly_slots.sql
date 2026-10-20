-- Chỉ dùng thủ công khi gỡ cả code M1a.3 và chưa có lịch cố định nào.
-- Có lịch thì dừng (buổi đã sinh vẫn là buổi học thật); không dùng DROP để bỏ dữ liệu đang dùng.
begin;
do $$ begin
  if exists (select 1 from public.weekly_slots) then
    raise exception 'Còn lịch cố định M1a.3, không hoàn tác bằng DROP';
  end if;
end $$;
alter table public.sessions
  drop constraint sessions_slot_occurrence_key,
  drop column slot_date,
  drop column slot_id;
drop table public.weekly_slots;
commit;
