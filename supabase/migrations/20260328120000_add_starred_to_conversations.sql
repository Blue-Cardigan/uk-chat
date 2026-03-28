alter table public.uk_chat_conversations
  add column if not exists starred boolean not null default false;
