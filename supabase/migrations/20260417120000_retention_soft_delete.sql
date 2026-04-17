-- Assert that uk_chat_messages.conversation_id cascades on conversation delete. The retention
-- cron hard-deletes conversations past the soft-delete grace window and relies on this cascade
-- to remove child messages; without it the delete would either fail (FK violation) or orphan rows.
do $$
begin
  if not exists (
    select 1
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc
      on tc.constraint_name = rc.constraint_name
     and tc.constraint_schema = rc.constraint_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'uk_chat_messages'
      and rc.delete_rule = 'CASCADE'
  ) then
    raise exception 'uk_chat_messages.conversation_id must have ON DELETE CASCADE for retention cron';
  end if;
end$$;

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
