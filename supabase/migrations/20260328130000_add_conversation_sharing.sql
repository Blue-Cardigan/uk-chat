alter table public.uk_chat_conversations
  add column if not exists is_public boolean not null default false,
  add column if not exists share_token text unique,
  add column if not exists shared_at timestamptz;
