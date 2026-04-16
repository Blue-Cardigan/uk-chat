-- Role-based admin management (#8).
-- Replaces the ADMIN_EMAIL env-var single-admin bottleneck.

create table if not exists public.uk_chat_admin_roles (
  user_id uuid primary key references public.uk_chat_profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'superadmin')),
  granted_by uuid references public.uk_chat_profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

create index if not exists uk_chat_admin_roles_role_idx
  on public.uk_chat_admin_roles (role);

alter table public.uk_chat_admin_roles enable row level security;

-- Service role bypasses RLS; authenticated clients cannot read this table directly.
drop policy if exists admin_roles_service_only on public.uk_chat_admin_roles;
create policy admin_roles_select_own on public.uk_chat_admin_roles
  for select to authenticated
  using (auth.uid() = user_id);
