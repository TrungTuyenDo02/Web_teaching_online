-- Chỉ gỡ khi chưa có tài liệu hay lượt dùng; không tự DROP dữ liệu thật.
begin;
do $$ begin
  if exists(select 1 from public.assistant_materials)
    or exists(select 1 from public.assistant_daily_usage)
    or exists(select 1 from public.assistant_global_usage) then
    raise exception 'Không gỡ RAG khi đã có dữ liệu hoặc lượt dùng';
  end if;
end $$;
drop function public.search_assistant_chunks(uuid,text);
drop function public.create_assistant_material(uuid,uuid,text,text,boolean);
drop function public.assistant_materials_for_actor(uuid);
drop function public.reserve_assistant_turn(uuid,date,integer,integer);
drop table public.assistant_chunks, public.assistant_materials, public.assistant_daily_usage, public.assistant_global_usage;
commit;
