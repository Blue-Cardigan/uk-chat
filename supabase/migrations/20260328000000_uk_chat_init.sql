create extension if not exists pgcrypto;

create table if not exists public.uk_chat_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  mcp_token text,
  theme_preference text not null default 'system' check (theme_preference in ('system', 'light', 'dark')),
  created_at timestamptz not null default now()
);

create table if not exists public.uk_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.uk_chat_profiles(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.uk_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.uk_chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.uk_chat_email_gate (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  invited_at timestamptz not null default now(),
  claimed_at timestamptz
);

alter table public.uk_chat_profiles enable row level security;
alter table public.uk_chat_conversations enable row level security;
alter table public.uk_chat_messages enable row level security;
alter table public.uk_chat_email_gate enable row level security;

drop policy if exists profiles_select_own on public.uk_chat_profiles;
create policy profiles_select_own on public.uk_chat_profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.uk_chat_profiles;
create policy profiles_update_own on public.uk_chat_profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists conversations_select_own on public.uk_chat_conversations;
create policy conversations_select_own on public.uk_chat_conversations
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists conversations_insert_own on public.uk_chat_conversations;
create policy conversations_insert_own on public.uk_chat_conversations
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists conversations_update_own on public.uk_chat_conversations;
create policy conversations_update_own on public.uk_chat_conversations
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists conversations_delete_own on public.uk_chat_conversations;
create policy conversations_delete_own on public.uk_chat_conversations
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists messages_select_own on public.uk_chat_messages;
create policy messages_select_own on public.uk_chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.uk_chat_conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

drop policy if exists messages_insert_own on public.uk_chat_messages;
create policy messages_insert_own on public.uk_chat_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.uk_chat_conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

drop policy if exists email_gate_admin_read on public.uk_chat_email_gate;
create policy email_gate_admin_read on public.uk_chat_email_gate
  for select to authenticated
  using (auth.jwt() ->> 'email' = current_setting('request.jwt.claim.email', true));
