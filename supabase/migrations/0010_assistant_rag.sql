-- RAG văn bản: tài liệu theo chủ đề, chunk tìm kiếm FTS, hạn mức bền.
-- Chưa dùng embedding/pgvector; không tạo kho dữ liệu bên OpenAI.
begin;

create table public.assistant_materials (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  topic_id uuid not null references public.teaching_topics(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  content text not null check (length(btrim(content)) between 20 and 24000),
  student_visible boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.assistant_chunks (
  material_id uuid not null references public.assistant_materials(id) on delete cascade,
  sequence integer not null,
  content text not null check (length(content) between 1 and 1200),
  terms tsvector generated always as (to_tsvector('simple'::regconfig, content)) stored,
  primary key (material_id, sequence)
);
create index assistant_chunks_terms_idx on public.assistant_chunks using gin(terms);
create table public.assistant_daily_usage (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  turns integer not null default 0 check (turns >= 0),
  primary key(actor_id, day)
);
-- Tổng ngày không chứa actor; xóa tài khoản không làm hoàn lại ngân sách đã dùng.
create table public.assistant_global_usage (
  day date primary key,
  turns integer not null default 0 check (turns >= 0)
);
alter table public.assistant_materials enable row level security;
alter table public.assistant_chunks enable row level security;
alter table public.assistant_daily_usage enable row level security;
alter table public.assistant_global_usage enable row level security;
revoke all on public.assistant_global_usage from anon, authenticated;
grant select on public.assistant_global_usage to authenticated;
grant all on public.assistant_global_usage to service_role;
create policy assistant_global_private on public.assistant_global_usage for select to authenticated using(false);
revoke all on public.assistant_materials, public.assistant_chunks, public.assistant_daily_usage from anon, authenticated;
grant select on public.assistant_materials, public.assistant_chunks, public.assistant_daily_usage to authenticated;
grant all on public.assistant_materials, public.assistant_chunks, public.assistant_daily_usage to service_role;
create policy assistant_materials_teacher_read on public.assistant_materials for select to authenticated
  using (teacher_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));
create policy assistant_chunks_teacher_read on public.assistant_chunks for select to authenticated
  using (exists(select 1 from public.assistant_materials m where m.id = material_id and m.teacher_id = auth.uid()));
create policy assistant_usage_self_read on public.assistant_daily_usage for select to authenticated using(actor_id = auth.uid());

-- Principal do API đã xác thực truyền vào, chỉ service_role được gọi.
-- HS không SELECT trực tiếp kho; RPC chỉ trả tài liệu được công bố, thuộc đúng GV/chủ đề đã dạy.
create function public.assistant_materials_for_actor(p_actor uuid)
returns setof public.assistant_materials language sql stable set search_path = '' as $$
  select m.* from public.assistant_materials m
  join public.teaching_topics t on t.id = m.topic_id and t.teacher_id = m.teacher_id
  join public.profiles p on p.id = p_actor
  where (p.role = 'teacher' and m.teacher_id = p.id)
    or (p.role = 'student' and m.student_visible and exists (
      select 1 from public.students st
      join public.sessions s on s.student_id = st.id and s.teacher_id = st.teacher_id
      join public.session_topics x on x.session_id = s.id and x.topic_id = m.topic_id
      where st.profile_id = p.id and st.teacher_id = m.teacher_id and st.deleting_at is null
        and s.status = 'completed'
    ));
$$;

create function public.create_assistant_material(p_actor uuid, p_topic uuid, p_title text, p_content text, p_visible boolean)
returns setof public.assistant_materials language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  -- Khóa chủ đề trong giao dịch: xóa đồng thời không tạo tài liệu mồ côi.
  perform 1 from public.teaching_topics t join public.profiles p on p.id = t.teacher_id
    where t.id = p_topic and p.id = p_actor and p.role = 'teacher' for key share of t;
  if not found then return; end if;
  insert into public.assistant_materials(teacher_id, topic_id, title, content, student_visible)
    values(p_actor, p_topic, p_title, p_content, p_visible) returning id into v_id;
  insert into public.assistant_chunks(material_id, sequence, content)
    select v_id, n, substr(p_content, n * 1000 + 1, 1200)
    from generate_series(0, (length(p_content) - 1) / 1000) n;
  return query select * from public.assistant_materials where id = v_id;
end $$;

create function public.search_assistant_chunks(p_actor uuid, p_query text)
returns table(material_id uuid, title text, sequence integer, content text)
language sql stable set search_path = '' as $$
  select m.id, m.title, c.sequence, c.content
  from public.assistant_materials_for_actor(p_actor) m
  join public.assistant_chunks c on c.material_id = m.id
  where c.terms @@ websearch_to_tsquery('simple'::regconfig, left(p_query, 500))
  order by ts_rank(c.terms, websearch_to_tsquery('simple'::regconfig, left(p_query, 500))) desc, m.id, c.sequence
  limit 4;
$$;

create function public.reserve_assistant_turn(p_actor uuid, p_day date, p_user_limit integer, p_global_limit integer)
returns boolean language plpgsql set search_path = '' as $$
declare v_turns integer;
begin
  if not exists(select 1 from public.profiles where id = p_actor) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('assistant-budget:' || p_day::text));
  insert into public.assistant_global_usage(day) values(p_day) on conflict(day) do nothing;
  select turns into v_turns from public.assistant_global_usage where day = p_day;
  if v_turns >= least(greatest(p_global_limit,1),10000) then return false; end if;
  insert into public.assistant_daily_usage(actor_id, day, turns) values(p_actor, p_day, 1)
    on conflict(actor_id, day) do update set turns = public.assistant_daily_usage.turns + 1
    where public.assistant_daily_usage.turns < least(greatest(p_user_limit,1),1000);
  if not found then return false; end if;
  update public.assistant_global_usage set turns = turns + 1 where day = p_day;
  return true;
end $$;

revoke all on function public.assistant_materials_for_actor(uuid),
  public.create_assistant_material(uuid,uuid,text,text,boolean), public.search_assistant_chunks(uuid,text),
  public.reserve_assistant_turn(uuid,date,integer,integer) from public, anon, authenticated;
grant execute on function public.assistant_materials_for_actor(uuid),
  public.create_assistant_material(uuid,uuid,text,text,boolean), public.search_assistant_chunks(uuid,text),
  public.reserve_assistant_turn(uuid,date,integer,integer) to service_role;
commit;
