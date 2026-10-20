-- Giả lập tối thiểu các phần của Supabase mà migration cần (chỉ để kiểm thử cục bộ,
-- KHÔNG chạy file này trên Supabase thật).
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
-- Như Supabase: bảng mới trong public tự cấp mọi quyền cho anon và authenticated
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;

create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
