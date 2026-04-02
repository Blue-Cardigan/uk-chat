create table if not exists public.uk_chat_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.uk_chat_profiles(id) on delete cascade,
  conversation_id uuid not null references public.uk_chat_conversations(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed')),
  model_id text not null,
  require_data_tool_call boolean not null default false,
  completed_slices integer not null default 0,
  max_slices integer not null default 6,
  latest_messages jsonb not null default '[]'::jsonb,
  assistant_parts jsonb,
  quant_telemetry jsonb not null default '{}'::jsonb,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  tool_calls integer not null default 0,
  request_idempotency_key text,
  last_continue_key text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists uk_chat_jobs_user_id_idx on public.uk_chat_jobs(user_id);
create index if not exists uk_chat_jobs_conversation_id_idx on public.uk_chat_jobs(conversation_id);
create index if not exists uk_chat_jobs_status_idx on public.uk_chat_jobs(status);
create unique index if not exists uk_chat_jobs_request_idempotency_idx
  on public.uk_chat_jobs(user_id, conversation_id, request_idempotency_key)
  where request_idempotency_key is not null;

alter table public.uk_chat_jobs enable row level security;

drop policy if exists jobs_select_own on public.uk_chat_jobs;
create policy jobs_select_own on public.uk_chat_jobs
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists jobs_insert_own on public.uk_chat_jobs;
create policy jobs_insert_own on public.uk_chat_jobs
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists jobs_update_own on public.uk_chat_jobs;
create policy jobs_update_own on public.uk_chat_jobs
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists jobs_delete_own on public.uk_chat_jobs;
create policy jobs_delete_own on public.uk_chat_jobs
  for delete to authenticated
  using (auth.uid() = user_id);
