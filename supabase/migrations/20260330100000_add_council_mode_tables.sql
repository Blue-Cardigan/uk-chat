create table if not exists public.uk_chat_councils (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.uk_chat_conversations(id) on delete cascade,
  user_id uuid not null references public.uk_chat_profiles(id) on delete cascade,
  issue text not null,
  scope jsonb not null,
  resolved_geography jsonb not null,
  routing jsonb not null,
  agents jsonb not null,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_uk_chat_councils_user_created
  on public.uk_chat_councils(user_id, created_at desc);

create table if not exists public.uk_chat_council_turns (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references public.uk_chat_councils(id) on delete cascade,
  turns jsonb not null,
  source text not null check (source in ('initial', 'follow_up')),
  created_at timestamptz not null default now()
);

create index if not exists idx_uk_chat_council_turns_council_created
  on public.uk_chat_council_turns(council_id, created_at asc);

alter table public.uk_chat_councils enable row level security;
alter table public.uk_chat_council_turns enable row level security;

drop policy if exists councils_select_own on public.uk_chat_councils;
create policy councils_select_own on public.uk_chat_councils
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists councils_insert_own on public.uk_chat_councils;
create policy councils_insert_own on public.uk_chat_councils
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists councils_update_own on public.uk_chat_councils;
create policy councils_update_own on public.uk_chat_councils
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists council_turns_select_own on public.uk_chat_council_turns;
create policy council_turns_select_own on public.uk_chat_council_turns
  for select to authenticated
  using (
    exists (
      select 1
      from public.uk_chat_councils c
      where c.id = council_id
        and c.user_id = auth.uid()
    )
  );

