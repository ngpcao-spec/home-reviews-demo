create extension if not exists pgcrypto;
create schema if not exists private;

create type public.organization_role as enum ('owner','admin','manager','viewer');
create type public.sync_status as enum ('pending','syncing','ok','warning','error');
create type public.review_status as enum ('new','to_process','processed','ignored');
create type public.analysis_status as enum ('pending','ok','error');
create type public.review_action_type as enum ('opened','response_generated','response_copied','opened_google_maps','marked_processed','reopened','ignored');
create type public.notification_severity as enum ('info','warning','high','critical');
create type public.sync_run_status as enum ('running','success','partial','failed');
create type public.subscription_status as enum ('trial','active','past_due','canceled','expired');

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id) on delete restrict
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role public.organization_role not null default 'viewer',
  created_at timestamptz not null default now(), primary key (organization_id,user_id)
);
create table public.establishments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, address text not null, city text, country_code text, google_maps_url text not null check (google_maps_url ~ '^https://(www\.)?google\.[^/]+/maps|^https://maps\.app\.goo\.gl/'),
  google_place_ref text not null, source_provider text not null, provider_place_ref text not null, photo_url text,
  current_rating numeric(2,1) check (current_rating between 0 and 5), current_review_count integer check (current_review_count >= 0),
  is_active boolean not null default true, sync_enabled boolean not null default true, last_synced_at timestamptz,
  next_sync_at timestamptz, sync_status public.sync_status not null default 'pending', created_at timestamptz not null default now()
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade, source_provider text not null,
  external_review_id text not null, author_name text, author_avatar_url text, rating smallint not null check (rating between 1 and 5),
  review_text text, review_language text, published_at timestamptz, source_url text, is_historical_import boolean not null default false,
  requires_action boolean not null default false, status public.review_status not null default 'new', first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(establishment_id,source_provider,external_review_id)
);
create table public.review_ai_analyses (
  id uuid primary key default gen_random_uuid(), review_id uuid not null unique references public.reviews(id) on delete cascade,
  model text not null, sentiment text check (sentiment in ('negative','neutral','positive')), primary_category text,
  secondary_categories jsonb not null default '[]' check (jsonb_typeof(secondary_categories)='array'), urgency text check (urgency in ('low','medium','high','critical')),
  summary text, key_points jsonb not null default '[]' check (jsonb_typeof(key_points)='array'), suggested_response text,
  response_language text, analysis_status public.analysis_status not null default 'pending', error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.review_actions (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid references auth.users(id) on delete set null,
  action_type public.review_action_type not null, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, establishment_id uuid references public.establishments(id) on delete cascade,
  review_id uuid references public.reviews(id) on delete cascade, type text not null, title text not null, body text not null,
  severity public.notification_severity not null default 'info', read_at timestamptz, created_at timestamptz not null default now()
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'), p256dh text not null, auth text not null, user_agent text,
  created_at timestamptz not null default now(), last_used_at timestamptz
);
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade, provider text not null,
  started_at timestamptz not null default now(), finished_at timestamptz, status public.sync_run_status not null default 'running',
  reviews_fetched integer not null default 0, reviews_inserted integer not null default 0, provider_cost_estimate numeric,
  error_code text, error_message text
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'mock', provider_customer_id text, provider_subscription_id text, plan_key text not null,
  status public.subscription_status not null default 'trial', current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.plan_entitlements (
  plan_key text primary key, max_establishments integer not null check(max_establishments>0), sync_interval_minutes integer not null check(sync_interval_minutes>=5),
  max_ai_responses_month integer not null check(max_ai_responses_month>=0), max_members integer not null check(max_members>0), retention_days integer
);

create index reviews_org_status_date_idx on public.reviews(organization_id,status,published_at desc);
create index reviews_establishment_date_idx on public.reviews(establishment_id,published_at desc);
create index organization_members_user_idx on public.organization_members(user_id,organization_id);
create index establishments_organization_idx on public.establishments(organization_id);
create index review_actions_review_idx on public.review_actions(review_id);
create index review_actions_org_date_idx on public.review_actions(organization_id,created_at desc);
create index notifications_establishment_idx on public.notifications(establishment_id) where establishment_id is not null;
create index notifications_review_idx on public.notifications(review_id) where review_id is not null;
create index notifications_user_idx on public.notifications(user_id) where user_id is not null;
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index sync_runs_organization_idx on public.sync_runs(organization_id);
create index establishments_next_sync_idx on public.establishments(next_sync_at) where sync_enabled and is_active;
create index notifications_org_unread_idx on public.notifications(organization_id,created_at desc) where read_at is null;
create index sync_runs_establishment_date_idx on public.sync_runs(establishment_id,started_at desc);

create or replace function private.is_org_member(org_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_members m where m.organization_id=org_id and m.user_id=(select auth.uid()))
$$;
create or replace function private.has_org_role(org_id uuid, allowed public.organization_role[]) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_members m where m.organization_id=org_id and m.user_id=(select auth.uid()) and m.role=any(allowed))
$$;
revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid,public.organization_role[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid), private.has_org_role(uuid,public.organization_role[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.establishments enable row level security;
alter table public.reviews enable row level security;
alter table public.review_ai_analyses enable row level security;
alter table public.review_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.sync_runs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.plan_entitlements enable row level security;

revoke all on all tables in schema public from anon,authenticated;
grant select,insert,update,delete on public.organizations,public.organization_members,public.establishments,public.reviews,public.review_actions,public.notifications,public.push_subscriptions to authenticated;
grant select on public.review_ai_analyses,public.sync_runs,public.subscriptions,public.plan_entitlements to authenticated;

create policy organizations_select on public.organizations for select to authenticated using ((select private.is_org_member(id)));
create policy organizations_insert on public.organizations for insert to authenticated with check ((select auth.uid())=created_by);
create policy organizations_update on public.organizations for update to authenticated using ((select private.has_org_role(id,array['owner','admin']::public.organization_role[]))) with check ((select private.has_org_role(id,array['owner','admin']::public.organization_role[])));
create policy organizations_delete on public.organizations for delete to authenticated using ((select private.has_org_role(id,array['owner']::public.organization_role[])));
create policy members_select on public.organization_members for select to authenticated using ((select private.is_org_member(organization_id)));
create policy members_insert on public.organization_members for insert to authenticated with check ((select private.has_org_role(organization_id,array['owner','admin']::public.organization_role[])) or (user_id=(select auth.uid()) and role='owner' and exists(select 1 from public.organizations o where o.id=organization_id and o.created_by=(select auth.uid()))));
create policy members_update on public.organization_members for update to authenticated using ((select private.has_org_role(organization_id,array['owner','admin']::public.organization_role[]))) with check ((select private.has_org_role(organization_id,array['owner','admin']::public.organization_role[])));
create policy members_delete on public.organization_members for delete to authenticated using ((select private.has_org_role(organization_id,array['owner']::public.organization_role[])));

create policy establishments_select on public.establishments for select to authenticated using ((select private.is_org_member(organization_id)));
create policy establishments_insert on public.establishments for insert to authenticated with check ((select private.has_org_role(organization_id,array['owner','admin','manager']::public.organization_role[])));
create policy establishments_update on public.establishments for update to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','manager']::public.organization_role[]))) with check ((select private.has_org_role(organization_id,array['owner','admin','manager']::public.organization_role[])));
create policy establishments_delete on public.establishments for delete to authenticated using ((select private.has_org_role(organization_id,array['owner','admin']::public.organization_role[])));
create policy reviews_select on public.reviews for select to authenticated using ((select private.is_org_member(organization_id)));
create policy reviews_update on public.reviews for update to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','manager']::public.organization_role[]))) with check ((select private.has_org_role(organization_id,array['owner','admin','manager']::public.organization_role[])));
create policy analyses_select on public.review_ai_analyses for select to authenticated using (exists(select 1 from public.reviews r where r.id=review_id and (select private.is_org_member(r.organization_id))));
create policy actions_select on public.review_actions for select to authenticated using ((select private.is_org_member(organization_id)));
create policy actions_insert on public.review_actions for insert to authenticated with check ((select private.is_org_member(organization_id)) and user_id=(select auth.uid()));
create policy notifications_select on public.notifications for select to authenticated using ((select private.is_org_member(organization_id)) and (user_id is null or user_id=(select auth.uid())));
create policy notifications_update on public.notifications for update to authenticated using ((select private.is_org_member(organization_id)) and (user_id is null or user_id=(select auth.uid()))) with check ((select private.is_org_member(organization_id)) and (user_id is null or user_id=(select auth.uid())));
create policy push_select on public.push_subscriptions for select to authenticated using (user_id=(select auth.uid()));
create policy push_insert on public.push_subscriptions for insert to authenticated with check (user_id=(select auth.uid()));
create policy push_update on public.push_subscriptions for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id=(select auth.uid()));
create policy sync_runs_select on public.sync_runs for select to authenticated using ((select private.is_org_member(organization_id)));
create policy subscriptions_select on public.subscriptions for select to authenticated using ((select private.is_org_member(organization_id)));
create policy entitlements_select on public.plan_entitlements for select to authenticated using (true);

create or replace function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end $$;
create trigger reviews_touch before update on public.reviews for each row execute function private.touch_updated_at();
create trigger analyses_touch before update on public.review_ai_analyses for each row execute function private.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function private.touch_updated_at();

insert into public.plan_entitlements values ('starter',1,180,50,2,90),('pro',5,60,250,5,365),('business',20,30,1500,20,null);

-- Creates a private tenant atomically for each verified Auth user.
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare new_org uuid;
begin
  insert into public.organizations(name,created_by) values (coalesce(nullif(new.raw_user_meta_data->>'organization_name',''),split_part(coalesce(new.email,'Mon organisation'),'@',1)),new.id) returning id into new_org;
  insert into public.organization_members(organization_id,user_id,role) values(new_org,new.id,'owner');
  insert into public.subscriptions(organization_id,provider,plan_key,status,current_period_start,current_period_end) values(new_org,'mock','starter','trial',now(),now()+interval '14 days');
  return new;
end $$;
revoke all on function private.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
