create extension if not exists pgcrypto;
create schema if not exists private;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  google_id text not null,
  place_id text,
  google_maps_url text not null check (
    google_maps_url ~ '^https://(www\.)?google\.[^/]+/maps'
    or google_maps_url ~ '^https://maps\.app\.goo\.gl/'
  ),
  address text not null default '',
  rating numeric(2,1) not null default 0 check (rating between 0 and 5),
  total_reviews integer not null default 0 check (total_reviews >= 0),
  photo_url text,
  active boolean not null default true,
  initialized_at timestamptz,
  last_sync_at timestamptz,
  last_review_id text,
  last_review_at timestamptz,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'syncing', 'ok', 'error')),
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint establishments_organization_google_id_key unique (organization_id, google_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_review_id text not null,
  author_name text not null default 'Client Google',
  author_image text,
  rating smallint not null check (rating between 1 and 5),
  text text not null default '',
  language text,
  published_at timestamptz,
  review_url text,
  owner_response text,
  requires_attention boolean not null default false,
  requires_ai_analysis boolean not null default false,
  status text not null default 'new' check (status in ('new', 'to_process', 'processed', 'ignored')),
  historical_import boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_establishment_external_review_id_key unique (establishment_id, external_review_id),
  constraint reviews_attention_rule check (
    (rating in (1, 2) and requires_attention and not requires_ai_analysis)
    or (rating = 3 and not requires_attention and requires_ai_analysis)
    or (rating in (4, 5) and not requires_attention and not requires_ai_analysis)
  )
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  sync_type text not null check (sync_type in ('initialization', 'incremental')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  provider text not null default 'outscraper',
  provider_requests integer not null default 0 check (provider_requests >= 0),
  reviews_fetched integer not null default 0 check (reviews_fetched >= 0),
  reviews_inserted integer not null default 0 check (reviews_inserted >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index organization_members_user_idx
  on public.organization_members (user_id, organization_id);
create index establishments_organization_active_idx
  on public.establishments (organization_id, active);
create index establishments_sync_idx
  on public.establishments (active, last_sync_at)
  where active;
create index reviews_organization_status_date_idx
  on public.reviews (organization_id, status, published_at desc);
create index reviews_establishment_date_idx
  on public.reviews (establishment_id, published_at desc);
create index reviews_attention_idx
  on public.reviews (organization_id, published_at desc)
  where requires_attention or requires_ai_analysis;
create index sync_runs_establishment_started_idx
  on public.sync_runs (establishment_id, started_at desc);

create or replace function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = org_id
      and member.user_id = (select auth.uid())
  )
$$;

create or replace function private.has_org_role(org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = org_id
      and member.user_id = (select auth.uid())
      and member.role = any(allowed_roles)
  )
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, text[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid), private.has_org_role(uuid, text[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.establishments enable row level security;
alter table public.reviews enable row level security;
alter table public.sync_runs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations, public.organization_members, public.establishments, public.reviews, public.sync_runs to authenticated;
grant update (name) on public.organizations to authenticated;
grant update (name, active) on public.establishments to authenticated;
grant update (status) on public.reviews to authenticated;

create policy organizations_select
on public.organizations for select to authenticated
using ((select private.is_org_member(id)));

create policy organizations_update
on public.organizations for update to authenticated
using ((select private.has_org_role(id, array['owner', 'admin'])))
with check ((select private.has_org_role(id, array['owner', 'admin'])));

create policy organization_members_select
on public.organization_members for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy establishments_select
on public.establishments for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy establishments_update
on public.establishments for update to authenticated
using ((select private.has_org_role(organization_id, array['owner', 'admin', 'manager'])))
with check ((select private.has_org_role(organization_id, array['owner', 'admin', 'manager'])));

create policy reviews_select
on public.reviews for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy reviews_update
on public.reviews for update to authenticated
using ((select private.has_org_role(organization_id, array['owner', 'admin', 'manager'])))
with check ((select private.has_org_role(organization_id, array['owner', 'admin', 'manager'])));

create policy sync_runs_select
on public.sync_runs for select to authenticated
using ((select private.is_org_member(organization_id)));

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function private.touch_updated_at();

create trigger establishments_touch_updated_at
before update on public.establishments
for each row execute function private.touch_updated_at();

create trigger reviews_touch_updated_at
before update on public.reviews
for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
begin
  insert into public.organizations (name, created_by)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'organization_name', ''),
      split_part(coalesce(new.email, 'Mon organisation'), '@', 1)
    ),
    new.id
  )
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  return new;
end
$$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

do $$
declare
  existing_user record;
  new_organization_id uuid;
begin
  for existing_user in
    select users.id, users.email, users.raw_user_meta_data
    from auth.users as users
    where not exists (
      select 1
      from public.organization_members member
      where member.user_id = users.id
    )
  loop
    insert into public.organizations (name, created_by)
    values (
      coalesce(
        nullif(existing_user.raw_user_meta_data ->> 'organization_name', ''),
        split_part(coalesce(existing_user.email, 'Mon organisation'), '@', 1)
      ),
      existing_user.id
    )
    returning id into new_organization_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (new_organization_id, existing_user.id, 'owner');
  end loop;
end
$$;

