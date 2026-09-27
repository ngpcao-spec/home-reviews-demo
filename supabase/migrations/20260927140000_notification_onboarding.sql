create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notification_onboarding_seen boolean not null default false,
  notification_permission_status text not null default 'unknown'
    check (notification_permission_status in ('unknown', 'granted', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own on public.notification_preferences
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant select, insert, update on public.notification_preferences to authenticated;
revoke all on public.notification_preferences from anon;
grant all on public.notification_preferences to service_role;

drop trigger if exists notification_preferences_touch_updated_at on public.notification_preferences;
create trigger notification_preferences_touch_updated_at
before update on public.notification_preferences
for each row execute function private.touch_updated_at();
