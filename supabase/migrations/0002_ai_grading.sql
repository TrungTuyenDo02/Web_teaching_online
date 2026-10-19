-- ============================================================================
-- 0002_ai_grading.sql: Giai đoạn 3 (AI gợi ý chấm). CHƯA chạy ở Giai đoạn 1.
-- AI chỉ ghi gợi ý; giáo viên duyệt rồi mới trả điểm cho học sinh.
-- ============================================================================

create type public.ai_suggestion_status as enum ('pending', 'accepted', 'edited', 'rejected', 'unreadable');

create table public.ai_grading_suggestions (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references public.submissions (id) on delete cascade,
  model            text not null,
  transcription    text,                         -- lời giải AI đọc được từ ảnh
  errors           jsonb not null default '[]',  -- [{step, reason, location}]
  suggested_score  numeric(4, 2) check (suggested_score is null or (suggested_score >= 0 and suggested_score <= 10)),
  rubric           jsonb,
  status           public.ai_suggestion_status not null default 'pending',
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index ai_suggestions_sub_idx on public.ai_grading_suggestions (submission_id);

-- Nhật ký chi phí từng lượt gọi AI để kiểm soát ngân sách
create table public.ai_usage_log (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions (id) on delete set null,
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10, 6) not null default 0,
  created_at    timestamptz not null default now()
);
create index ai_usage_created_idx on public.ai_usage_log (created_at);

alter table public.ai_grading_suggestions enable row level security;
alter table public.ai_usage_log           enable row level security;

-- Chỉ giáo viên thấy gợi ý AI (học sinh không thấy cho đến khi giáo viên trả bài)
create policy ai_suggestions_teacher_all on public.ai_grading_suggestions
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

create policy ai_usage_teacher_select on public.ai_usage_log
  for select using (public.is_teacher());
