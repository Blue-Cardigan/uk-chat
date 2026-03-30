create table if not exists public.system_settings (
  key text primary key,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  weekly_schedule_summary_html text
);

alter table public.system_settings enable row level security;

drop policy if exists system_settings_admin_read on public.system_settings;
create policy system_settings_admin_read on public.system_settings
  for select to authenticated
  using (auth.jwt() ->> 'email' = current_setting('request.jwt.claim.email', true));

insert into public.system_settings (key, value)
values
  ('council_national_source_preference', 'whatgov-first'),
  ('council_national_whatgov_mps_table', 'mps_uwhatgov'),
  ('council_national_whatgov_debates_table', 'casual_debates_uwhatgov')
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
