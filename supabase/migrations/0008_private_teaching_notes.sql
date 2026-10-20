-- Ghi chú sau buổi và chủ đề đã dạy: chỉ giáo viên sở hữu đọc, chỉ API ghi.
-- Không chuyển summary/homework_note công khai sang đây, không đổi completed/xóa hẳn.
begin;

create table public.teaching_topics (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  grade text not null default '' check (length(grade) <= 40),
  created_at timestamptz not null default now(),
  unique (teacher_id, name, grade)
);

create table public.session_notes (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  revision integer not null check (revision > 0),
  summary_md text not null default '' check (length(summary_md) <= 5000),
  understanding_level text not null default '' check (length(understanding_level) <= 100),
  improve_points text not null default '' check (length(improve_points) <= 5000),
  homework_text text not null default '' check (length(homework_text) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_topics (
  session_id uuid not null references public.sessions(id) on delete cascade,
  topic_id uuid not null references public.teaching_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, topic_id)
);
create index session_topics_topic_idx on public.session_topics(topic_id);

alter table public.teaching_topics enable row level security;
alter table public.session_notes enable row level security;
alter table public.session_topics enable row level security;
revoke all on public.teaching_topics, public.session_notes, public.session_topics from anon, authenticated;
grant select on public.teaching_topics, public.session_notes, public.session_topics to authenticated;
grant all on public.teaching_topics, public.session_notes, public.session_topics to service_role;

create policy teaching_topics_owner_read on public.teaching_topics for select to authenticated
  using (teacher_id = auth.uid() and public.is_teacher());

-- Dùng hàm security definer chỉ trả boolean để kiểm deleting_at (cột không cấp cho trình duyệt).
create function public.owns_completed_teaching_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s join public.students st on st.id = s.student_id
    join public.profiles p on p.id = s.teacher_id
    where s.id = p_session_id and s.teacher_id = auth.uid() and p.role = 'teacher'
      and st.teacher_id = s.teacher_id and st.deleting_at is null and s.status = 'completed'
  );
$$;
revoke all on function public.owns_completed_teaching_session(uuid) from public, anon;
grant execute on function public.owns_completed_teaching_session(uuid) to authenticated, service_role;

create policy session_notes_owner_read on public.session_notes for select to authenticated
  using (public.owns_completed_teaching_session(session_id));
create policy session_topics_owner_read on public.session_topics for select to authenticated
  using (public.owns_completed_teaching_session(session_id));

-- Một giao dịch: chặn xóa đang diễn ra, khóa buổi, kiểm phiên bản/chủ đề rồi mới thay dữ liệu.
-- SECURITY INVOKER + chỉ service_role được gọi: trình duyệt không truyền teacher_id để nâng quyền.
create function public.save_teaching_record(
  p_teacher_id uuid, p_session_id uuid, p_expected_revision integer,
  p_summary_md text, p_understanding_level text, p_improve_points text, p_homework_text text,
  p_topic_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_student_id uuid;
  v_session public.sessions%rowtype;
  v_note public.session_notes%rowtype;
  v_revision integer;
  v_topics uuid[];
begin
  if not exists (select 1 from public.profiles where id = p_teacher_id and role = 'teacher') then
    return jsonb_build_object('status', 'not_found');
  end if;
  select student_id into v_student_id from public.sessions
    where id = p_session_id and teacher_id = p_teacher_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from public.students where id = v_student_id and teacher_id = p_teacher_id
    and deleting_at is null for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_session from public.sessions
    where id = p_session_id and student_id = v_student_id and teacher_id = p_teacher_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_session.status <> 'completed' then return jsonb_build_object('status', 'not_completed'); end if;
  select coalesce(array_agg(distinct t order by t), '{}'::uuid[]) into v_topics
    from unnest(coalesce(p_topic_ids, '{}'::uuid[])) t;
  if cardinality(v_topics) > 50 or exists (
    select 1 from unnest(v_topics) t where t is null or not exists (
      select 1 from public.teaching_topics where id = t and teacher_id = p_teacher_id
    )
  ) then return jsonb_build_object('status', 'invalid_topics'); end if;
  select revision into v_revision from public.session_notes where session_id = p_session_id;
  if p_expected_revision is null or p_expected_revision <> coalesce(v_revision, 0) then
    return jsonb_build_object('status', 'conflict');
  end if;
  insert into public.session_notes(session_id, revision, summary_md, understanding_level, improve_points, homework_text)
    values (p_session_id, 1, p_summary_md, p_understanding_level, p_improve_points, p_homework_text)
    on conflict (session_id) do update set revision = public.session_notes.revision + 1,
      summary_md = excluded.summary_md, understanding_level = excluded.understanding_level,
      improve_points = excluded.improve_points, homework_text = excluded.homework_text, updated_at = now()
    returning * into v_note;
  delete from public.session_topics where session_id = p_session_id;
  insert into public.session_topics(session_id, topic_id) select p_session_id, t from unnest(v_topics) t;
  return jsonb_build_object('status', 'ok', 'record', to_jsonb(v_note) || jsonb_build_object(
    'scheduled_start', v_session.scheduled_start, 'subject', v_session.subject,
    'scheduled_topic', v_session.topic, 'topic_ids', v_topics));
end;
$$;
revoke all on function public.save_teaching_record(uuid, uuid, integer, text, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.save_teaching_record(uuid, uuid, integer, text, text, text, text, uuid[]) to service_role;

commit;
