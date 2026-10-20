-- Lịch cố định hằng tuần (M1a.3): API sinh buổi học từ lịch. Chỉ giáo viên sở hữu đọc, chỉ API ghi.
-- (slot_id, slot_date) duy nhất trên sessions: nhiều tiến trình cùng sinh vẫn một buổi mỗi ngày của
-- lịch; buổi đã hủy hay dời giờ giữ (slot_id, slot_date) nên không bị sinh lại. Không đổi buổi cũ.
begin;

create table public.weekly_slots (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = thứ Hai … 7 = Chủ nhật
  start_time time not null,                                  -- giờ Việt Nam
  duration_minutes smallint not null check (duration_minutes between 30 and 240),
  subject text check (length(subject) <= 100),
  topic text check (length(topic) <= 200),
  starts_on date not null,                                   -- ngày Việt Nam bắt đầu áp dụng
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index weekly_slots_teacher_idx on public.weekly_slots(teacher_id);
create index weekly_slots_student_idx on public.weekly_slots(student_id);

-- Xóa lịch chỉ xảy ra khi xóa hẳn học sinh (khi đó buổi học cũng bị xóa dây chuyền)
alter table public.sessions
  add column slot_id uuid references public.weekly_slots(id) on delete set null,
  add column slot_date date,
  add constraint sessions_slot_occurrence_key unique (slot_id, slot_date);

alter table public.weekly_slots enable row level security;
revoke all on public.weekly_slots from anon, authenticated;
grant select on public.weekly_slots to authenticated;
grant all on public.weekly_slots to service_role;

create policy weekly_slots_owner_read on public.weekly_slots for select to authenticated
  using (teacher_id = auth.uid() and public.is_teacher());

commit;
