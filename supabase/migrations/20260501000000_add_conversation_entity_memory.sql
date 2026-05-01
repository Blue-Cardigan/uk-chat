-- Conversation-scoped entity memory.
-- Persists the resolved AmbientContext from the previous turn so multi-turn
-- references like "and what about flooding there?" reuse prior entities
-- without needing the user to repeat them.
--
-- Stored as opaque JSONB; the api/_lib/ambient-context.ts mergeAmbientContext
-- function caps each list at 10 entries before writing back, so row size stays
-- bounded.

alter table public.uk_chat_conversations
  add column if not exists entity_memory jsonb not null default '{}'::jsonb;
