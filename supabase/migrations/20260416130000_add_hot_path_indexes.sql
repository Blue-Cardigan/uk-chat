-- Indexes for hot query paths (#10).
-- uk_chat_model_usage (user_id, usage_date) already indexed in 20260328150000.

create index if not exists uk_chat_conversations_user_id_idx
  on public.uk_chat_conversations (user_id);

create index if not exists uk_chat_messages_conversation_id_idx
  on public.uk_chat_messages (conversation_id);

create index if not exists uk_chat_conversations_updated_at_idx
  on public.uk_chat_conversations (updated_at);
