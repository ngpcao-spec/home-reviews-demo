create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create unique index if not exists organizations_created_by_unique
  on public.organizations(created_by);

create or replace function private.provision_home_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  account_email text;
  metadata jsonb;
  account_name text;
  account_avatar text;
  personal_organization_id uuid;
begin
  select users.email, coalesce(users.raw_user_meta_data, '{}'::jsonb)
  into account_email, metadata
  from auth.users as users
  where users.id = p_user_id;

  if not found then
    raise exception 'AUTH_USER_NOT_FOUND';
  end if;

  account_name := coalesce(
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'name', ''),
    nullif(metadata ->> 'display_name', ''),
    nullif(split_part(coalesce(account_email, ''), '@', 1), ''),
    'Utilisateur'
  );
  account_avatar := coalesce(
    nullif(metadata ->> 'avatar_url', ''),
    nullif(metadata ->> 'picture', '')
  );

  insert into public.profiles (user_id, email, display_name, avatar_url)
  values (p_user_id, account_email, account_name, account_avatar)
  on conflict (user_id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
      updated_at = now();

  select organizations.id
  into personal_organization_id
  from public.organizations as organizations
  where organizations.created_by = p_user_id
  limit 1;

  if personal_organization_id is null then
    insert into public.organizations (name, created_by, monitoring_interval_hours)
    values (account_name, p_user_id, 12)
    on conflict (created_by) do nothing
    returning id into personal_organization_id;

    if personal_organization_id is null then
      select organizations.id
      into personal_organization_id
      from public.organizations as organizations
      where organizations.created_by = p_user_id
      limit 1;
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (personal_organization_id, p_user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  insert into public.notification_preferences (
    user_id,
    notification_onboarding_seen,
    notification_permission_status
  )
  values (p_user_id, false, 'unknown')
  on conflict (user_id) do nothing;

  return personal_organization_id;
end
$function$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.provision_home_user(new.id);
  return new;
end
$function$;

create or replace function public.ensure_home_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;
  return private.provision_home_user(current_user_id);
end
$function$;

revoke all on function public.ensure_home_user() from public, anon;
grant execute on function public.ensure_home_user() to authenticated;

do $block$
declare
  account record;
begin
  for account in select id from auth.users loop
    perform private.provision_home_user(account.id);
  end loop;
end
$block$;
