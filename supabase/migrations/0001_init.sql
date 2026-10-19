-- ============================================================================
-- 0001_init.sql: cấu trúc dữ liệu Giai đoạn 1 + 2 (phòng học, học sinh, bài tập)
-- Nguyên tắc: bật RLS cho MỌI bảng; mặc định không ai đọc được gì, chỉ mở quyền tối thiểu.
-- API (service role) bỏ qua RLS nên các thao tác nhạy cảm (vào phòng, ghi điểm danh)
-- đi qua API, không để trình duyệt ghi trực tiếp.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- Kiểu liệt kê ----------------------------------------------------
create type public.user_role        as enum ('teacher', 'student');
create type public.session_status   as enum ('scheduled', 'live', 'completed', 'cancelled', 'no_show');
create type public.device_mode      as enum ('main', 'board');
create type public.assignment_status as enum ('assigned', 'submitted', 'returned');
create type public.submission_status as enum ('submitted', 'reviewing', 'returned');

-- ---------- Hồ sơ người dùng (gắn với auth.users của Supabase) --------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'student',
  full_name   text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------- Học sinh (thông tin do giáo viên quản lý) -----------------------
create table public.students (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.profiles (id),
  profile_id       uuid unique references public.profiles (id) on delete set null, -- tài khoản đăng nhập của học sinh
  full_name        text not null,
  grade            text,
  goals            text,
  notes            text,                       -- ghi chú riêng của giáo viên
  guardian_name    text,
  guardian_contact text,
  consent_at       timestamptz,                -- thời điểm phụ huynh đồng ý lưu dữ liệu
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index students_teacher_idx on public.students (teacher_id);

-- ---------- Buổi học ---------------------------------------------------------
create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.profiles (id),
  student_id       uuid not null references public.students (id) on delete cascade,
  room_name        text not null unique default ('room-' || replace(gen_random_uuid()::text, '-', '')),
  subject          text,
  topic            text,
  scheduled_start  timestamptz not null,
  scheduled_end    timestamptz not null,
  status           public.session_status not null default 'scheduled',
  started_at       timestamptz,
  ended_at         timestamptz,
  summary          text,                       -- nội dung đã dạy
  homework_note    text,                       -- bài về nhà
  board_snapshot_path text,                    -- đường dẫn ảnh/PDF bảng viết cuối buổi
  created_at       timestamptz not null default now(),
  constraint sessions_time_ck check (scheduled_end > scheduled_start)
);
create index sessions_student_idx on public.sessions (student_id, scheduled_start desc);
create index sessions_teacher_idx on public.sessions (teacher_id, scheduled_start desc);

-- ---------- Điểm danh (chỉ API ghi) ------------------------------------------
create table public.session_attendance (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id),
  device_mode public.device_mode not null default 'main',
  joined_at   timestamptz not null default now(),
  left_at     timestamptz
);
create index attendance_session_idx on public.session_attendance (session_id);

-- ---------- Bài tập giao và bài nộp ------------------------------------------
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  session_id  uuid references public.sessions (id) on delete set null,
  title       text not null,
  description text,
  due_at      timestamptz,
  status      public.assignment_status not null default 'assigned',
  created_at  timestamptz not null default now()
);
create index assignments_student_idx on public.assignments (student_id, created_at desc);

create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students (id) on delete cascade,
  assignment_id   uuid references public.assignments (id) on delete set null,
  status          public.submission_status not null default 'submitted',
  submitted_at    timestamptz not null default now(),
  teacher_comment text,
  score           numeric(4, 2) check (score is null or (score >= 0 and score <= 10)),
  returned_at     timestamptz
);
create index submissions_student_idx on public.submissions (student_id, submitted_at desc);

create table public.submission_files (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions (id) on delete cascade,
  storage_path   text not null,                 -- <student_id>/<submission_id>/<tên file>
  kind           text not null default 'original' check (kind in ('original', 'annotated')),
  mime_type      text,
  size_bytes     bigint check (size_bytes is null or size_bytes >= 0),
  created_at     timestamptz not null default now()
);
create index submission_files_sub_idx on public.submission_files (submission_id);

-- ============================================================================
-- Hàm hỗ trợ cho RLS (security definer để tránh đệ quy chính sách)
-- ============================================================================
create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher');
$$;

create or replace function public.my_student_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select s.id from public.students s where s.profile_id = auth.uid() limit 1;
$$;

-- Tự tạo hồ sơ khi có người đăng ký (mặc định là học sinh; giáo viên được nâng quyền thủ công)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.students            enable row level security;
alter table public.sessions            enable row level security;
alter table public.session_attendance  enable row level security;
alter table public.assignments         enable row level security;
alter table public.submissions         enable row level security;
alter table public.submission_files    enable row level security;

-- profiles: xem hồ sơ của mình; giáo viên xem tất cả. Không cho tự đổi role.
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_teacher());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));

-- students: giáo viên toàn quyền với học sinh của mình; học sinh chỉ đọc hồ sơ của chính mình
create policy students_teacher_all on public.students
  for all using (teacher_id = auth.uid() and public.is_teacher())
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy students_self_select on public.students
  for select using (profile_id = auth.uid());

-- sessions: giáo viên toàn quyền; học sinh chỉ đọc buổi học của mình
create policy sessions_teacher_all on public.sessions
  for all using (teacher_id = auth.uid() and public.is_teacher())
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy sessions_student_select on public.sessions
  for select using (student_id = public.my_student_id());

-- điểm danh: chỉ giáo viên đọc; ghi qua API (service role)
create policy attendance_teacher_select on public.session_attendance
  for select using (
    public.is_teacher()
    and exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid())
  );

-- assignments: giáo viên toàn quyền (qua học sinh của mình); học sinh đọc bài của mình
create policy assignments_teacher_all on public.assignments
  for all using (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  )
  with check (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  );
create policy assignments_student_select on public.assignments
  for select using (student_id = public.my_student_id());

-- submissions: học sinh chỉ thêm bài của mình ở trạng thái 'submitted'; giáo viên chấm và trả
create policy submissions_teacher_all on public.submissions
  for all using (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  )
  with check (
    public.is_teacher()
    and exists (select 1 from public.students st where st.id = student_id and st.teacher_id = auth.uid())
  );
create policy submissions_student_select on public.submissions
  for select using (student_id = public.my_student_id());
create policy submissions_student_insert on public.submissions
  for insert with check (student_id = public.my_student_id() and status = 'submitted');

-- submission_files: theo quyền của bài nộp tương ứng
create policy submission_files_teacher_all on public.submission_files
  for all using (
    public.is_teacher()
    and exists (
      select 1 from public.submissions sb
      join public.students st on st.id = sb.student_id
      where sb.id = submission_id and st.teacher_id = auth.uid()
    )
  )
  with check (
    public.is_teacher()
    and exists (
      select 1 from public.submissions sb
      join public.students st on st.id = sb.student_id
      where sb.id = submission_id and st.teacher_id = auth.uid()
    )
  );
create policy submission_files_student_select on public.submission_files
  for select using (
    exists (select 1 from public.submissions sb where sb.id = submission_id and sb.student_id = public.my_student_id())
  );
create policy submission_files_student_insert on public.submission_files
  for insert with check (
    kind = 'original'
    and exists (select 1 from public.submissions sb where sb.id = submission_id and sb.student_id = public.my_student_id())
  );

-- ============================================================================
-- Storage: bucket riêng tư cho ảnh bài làm. Quy ước đường dẫn: <student_id>/<submission_id>/<tên file>
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy submissions_objects_student_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

create policy submissions_objects_student_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

create policy submissions_objects_teacher_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'submissions'
    and public.is_teacher()
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1] and st.teacher_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'submissions'
    and public.is_teacher()
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1] and st.teacher_id = auth.uid()
    )
  );

-- Bảng viết cuối buổi lưu ở bucket 'boards' (chỉ giáo viên và đúng học sinh của buổi học)
insert into storage.buckets (id, name, public, file_size_limit)
values ('boards', 'boards', false, 20971520)
on conflict (id) do nothing;

create policy boards_objects_teacher_all on storage.objects
  for all to authenticated
  using (bucket_id = 'boards' and public.is_teacher())
  with check (bucket_id = 'boards' and public.is_teacher());

create policy boards_objects_student_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'boards'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );
