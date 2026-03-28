alter table public.uk_chat_profiles
  add column if not exists email text;

alter table public.uk_chat_email_gate
  add column if not exists pending_mcp_token text;

create unique index if not exists uk_chat_profiles_email_key on public.uk_chat_profiles (email) where email is not null;

drop policy if exists profiles_insert_own on public.uk_chat_profiles;
create policy profiles_insert_own on public.uk_chat_profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists email_gate_select_self on public.uk_chat_email_gate;
create policy email_gate_select_self on public.uk_chat_email_gate
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists email_gate_update_self on public.uk_chat_email_gate;
create policy email_gate_update_self on public.uk_chat_email_gate
  for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));
