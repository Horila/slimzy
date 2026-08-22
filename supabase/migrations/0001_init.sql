-- Single-user job-hunting agent schema. Every table scoped to auth.uid() via RLS.

create table cv (
  user_id uuid primary key references auth.users(id) on delete cascade,
  filename text not null,
  raw_text text not null,
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  external_id text not null,
  title text not null,
  company text,
  location text,
  description text,
  url text,
  salary text,
  fetched_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  cv_draft text not null,
  cover_letter_draft text not null,
  verify_warnings text,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table cv enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table chat_messages enable row level security;

create policy "own cv" on cv for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own jobs" on jobs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own applications" on applications for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own chat_messages" on chat_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict do nothing;

create policy "own cv file read" on storage.objects for select
  using (bucket_id = 'cvs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own cv file write" on storage.objects for insert
  with check (bucket_id = 'cvs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own cv file update" on storage.objects for update
  using (bucket_id = 'cvs' and auth.uid()::text = (storage.foldername(name))[1]);
