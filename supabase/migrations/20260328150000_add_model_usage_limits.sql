create table if not exists public.uk_chat_model_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.uk_chat_profiles(id) on delete cascade,
  model_id text not null,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, model_id, usage_date)
);

create index if not exists uk_chat_model_usage_user_date_idx
  on public.uk_chat_model_usage (user_id, usage_date desc);
