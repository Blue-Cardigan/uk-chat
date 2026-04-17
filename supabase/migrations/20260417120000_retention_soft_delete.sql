alter table public.uk_chat_conversations
  add column if not exists deleted_at timestamptz;

create index if not exists uk_chat_conversations_deleted_at_idx
  on public.uk_chat_conversations (deleted_at)
  where deleted_at is not null;

drop policy if exists conversations_select_own on public.uk_chat_conversations;
create policy conversations_select_own on public.uk_chat_conversations
  for select to authenticated
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists conversations_update_own on public.uk_chat_conversations;
create policy conversations_update_own on public.uk_chat_conversations
  for update to authenticated
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

drop policy if exists messages_select_own on public.uk_chat_messages;
create policy messages_select_own on public.uk_chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.uk_chat_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
      and c.deleted_at is null
  ));

drop policy if exists messages_insert_own on public.uk_chat_messages;
create policy messages_insert_own on public.uk_chat_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.uk_chat_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
      and c.deleted_at is null
  ));
