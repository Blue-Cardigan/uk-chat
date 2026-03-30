alter table public.uk_chat_profiles
  add column if not exists mcp_token_encrypted text;

alter table public.uk_chat_conversations
  add column if not exists share_expires_at timestamptz;

create table if not exists public.uk_chat_user_consents (
  user_id uuid primary key references public.uk_chat_profiles(id) on delete cascade,
  privacy_notice_version text not null default '2026-03-30',
  ai_processing_acknowledged_at timestamptz,
  sharing_warning_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.uk_chat_user_consents enable row level security;

drop policy if exists user_consents_select_own on public.uk_chat_user_consents;
create policy user_consents_select_own on public.uk_chat_user_consents
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_consents_insert_own on public.uk_chat_user_consents;
create policy user_consents_insert_own on public.uk_chat_user_consents
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_consents_update_own on public.uk_chat_user_consents;
create policy user_consents_update_own on public.uk_chat_user_consents
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.uk_chat_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.uk_chat_profiles(id) on delete set null,
  actor_email text,
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists uk_chat_admin_audit_log_created_idx
  on public.uk_chat_admin_audit_log (created_at desc);

create index if not exists uk_chat_admin_audit_log_action_idx
  on public.uk_chat_admin_audit_log (action);

alter table public.uk_chat_admin_audit_log enable row level security;

alter table public.uk_chat_model_usage enable row level security;

drop policy if exists model_usage_select_own on public.uk_chat_model_usage;
create policy model_usage_select_own on public.uk_chat_model_usage
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists model_usage_insert_own on public.uk_chat_model_usage;
create policy model_usage_insert_own on public.uk_chat_model_usage
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists model_usage_update_own on public.uk_chat_model_usage;
create policy model_usage_update_own on public.uk_chat_model_usage
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
