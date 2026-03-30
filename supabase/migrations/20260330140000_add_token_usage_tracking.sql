-- Extend uk_chat_model_usage with cumulative daily token and tool-call counters.
-- These are incremented asynchronously after each streamed response finishes.

alter table public.uk_chat_model_usage
  add column if not exists total_prompt_tokens bigint not null default 0,
  add column if not exists total_completion_tokens bigint not null default 0,
  add column if not exists total_tool_calls integer not null default 0;

-- Atomic increment avoids read-then-write races from concurrent requests.
create or replace function public.increment_token_usage(
  p_user_id uuid,
  p_model_id text,
  p_usage_date date,
  p_prompt_tokens bigint,
  p_completion_tokens bigint,
  p_tool_calls integer
) returns void
language sql
as $$
  update public.uk_chat_model_usage
  set
    total_prompt_tokens = total_prompt_tokens + p_prompt_tokens,
    total_completion_tokens = total_completion_tokens + p_completion_tokens,
    total_tool_calls = total_tool_calls + p_tool_calls,
    updated_at = now()
  where user_id = p_user_id
    and model_id = p_model_id
    and usage_date = p_usage_date;
$$;
