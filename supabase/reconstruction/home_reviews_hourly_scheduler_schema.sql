-- Recovered from production migration 20260927041042, read-only 2026-11-11.
-- Empty isolated database reconstruction only; never deploy as a migration.
alter table public.organizations
  add column if not exists monitoring_interval_hours smallint not null default 12;

alter table public.organizations
  drop constraint if exists organizations_monitoring_interval_hours_check;
alter table public.organizations
  add constraint organizations_monitoring_interval_hours_check
  check (monitoring_interval_hours in (1,3,6,12,24));

alter table public.establishments
  add column if not exists next_sync_at timestamptz,
  add column if not exists last_sync_status text not null default 'pending',
  add column if not exists last_sync_error text,
  add column if not exists sync_lock_token uuid,
  add column if not exists sync_locked_until timestamptz;

alter table public.establishments
  drop constraint if exists establishments_last_sync_status_check;
alter table public.establishments
  add constraint establishments_last_sync_status_check
  check (last_sync_status in ('pending','syncing','ok','error'));

update public.establishments
set last_sync_status=case
  when sync_status in ('pending','syncing','ok','error') then sync_status
  else 'pending'
end,
last_sync_error=sync_error
where true;

update public.establishments e
set next_sync_at=coalesce(e.last_sync_at,now()) + make_interval(hours=>o.monitoring_interval_hours)
from public.organizations o
where o.id=e.organization_id and e.next_sync_at is null;

create index if not exists establishments_due_sync_idx
  on public.establishments (next_sync_at,id)
  where active=true;

create index if not exists establishments_sync_lease_idx
  on public.establishments (sync_locked_until)
  where sync_locked_until is not null;

create or replace function private.set_new_establishment_schedule()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_hours integer;
begin
  if new.next_sync_at is null then
    select monitoring_interval_hours into v_hours
    from public.organizations where id=new.organization_id;
    new.next_sync_at:=coalesce(new.last_sync_at,now())+make_interval(hours=>coalesce(v_hours,12));
  end if;
  return new;
end
$$;

drop trigger if exists set_new_establishment_schedule on public.establishments;
create trigger set_new_establishment_schedule
before insert on public.establishments
for each row execute function private.set_new_establishment_schedule();

create or replace function private.reschedule_organization_establishments()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.monitoring_interval_hours is distinct from old.monitoring_interval_hours then
    update public.establishments
    set next_sync_at=coalesce(last_sync_at,now())+make_interval(hours=>new.monitoring_interval_hours)
    where organization_id=new.id and active=true;
  end if;
  return new;
end
$$;

drop trigger if exists reschedule_organization_establishments on public.organizations;
create trigger reschedule_organization_establishments
after update of monitoring_interval_hours on public.organizations
for each row execute function private.reschedule_organization_establishments();

create or replace function public.set_monitoring_interval(p_hours smallint)
returns smallint
language plpgsql
security definer
set search_path=''
as $$
declare v_organization_id uuid;
begin
  if p_hours not in (1,3,6,12,24) then raise exception 'INVALID_MONITORING_INTERVAL'; end if;
  select organization_id into v_organization_id
  from public.organization_members
  where user_id=auth.uid() and role in ('owner','admin')
  order by created_at asc limit 1;
  if v_organization_id is null then raise exception 'FORBIDDEN'; end if;
  update public.organizations set monitoring_interval_hours=p_hours where id=v_organization_id;
  return p_hours;
end
$$;
revoke all on function public.set_monitoring_interval(smallint) from public,anon;
grant execute on function public.set_monitoring_interval(smallint) to authenticated;

create or replace function public.claim_due_review_establishments(
  p_limit integer default 20,
  p_lease_minutes integer default 30
)
returns table(
  id uuid,
  organization_id uuid,
  google_id text,
  google_maps_url text,
  last_review_id text,
  last_review_at timestamptz,
  lock_token uuid
)
language sql
security definer
set search_path=''
as $$
  with due as (
    select e.id
    from public.establishments e
    where e.active=true
      and e.next_sync_at<=now()
      and (e.sync_locked_until is null or e.sync_locked_until<=now())
    order by e.next_sync_at,e.id
    for update skip locked
    limit least(greatest(p_limit,1),100)
  ),
  claimed as (
    update public.establishments e
    set sync_lock_token=extensions.gen_random_uuid(),
        sync_locked_until=now()+make_interval(mins=>least(greatest(p_lease_minutes,5),120)),
        last_sync_status='syncing',
        last_sync_error=null
    from due
    where e.id=due.id
    returning e.id,e.organization_id,e.google_id,e.google_maps_url,e.last_review_id,e.last_review_at,e.sync_lock_token
  )
  select c.id,c.organization_id,c.google_id,c.google_maps_url,c.last_review_id,c.last_review_at,c.sync_lock_token
  from claimed c
$$;
revoke all on function public.claim_due_review_establishments(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_due_review_establishments(integer,integer) to service_role;

create or replace function public.complete_review_sync(p_establishment_id uuid,p_lock_token uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_updated integer;
begin
  update public.establishments e
  set last_sync_at=now(),
      next_sync_at=now()+make_interval(hours=>o.monitoring_interval_hours),
      last_sync_status='ok',
      last_sync_error=null,
      sync_lock_token=null,
      sync_locked_until=null
  from public.organizations o
  where e.id=p_establishment_id
    and e.organization_id=o.id
    and e.sync_lock_token=p_lock_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end
$$;
revoke all on function public.complete_review_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_review_sync(uuid,uuid) to service_role;

create or replace function public.fail_review_sync(p_establishment_id uuid,p_lock_token uuid,p_error text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_updated integer;
begin
  update public.establishments
  set last_sync_status='error',
      last_sync_error=left(coalesce(p_error,'SYNC_FAILED'),200),
      sync_lock_token=null,
      sync_locked_until=null
  where id=p_establishment_id and sync_lock_token=p_lock_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end
$$;
revoke all on function public.fail_review_sync(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_review_sync(uuid,uuid,text) to service_role;

create table if not exists private.review_scheduler_credentials(
  singleton boolean primary key default true check(singleton),
  token_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on private.review_scheduler_credentials from public,anon,authenticated;

-- Credential provisioning omitted: local test provisions its own synthetic token.

create or replace function public.verify_review_scheduler_token(p_token text)
returns boolean
language sql
security definer
set search_path=''
as $$
  select exists(
    select 1 from private.review_scheduler_credentials
    where singleton=true
      and token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
  )
$$;
revoke all on function public.verify_review_scheduler_token(text) from public,anon,authenticated;
grant execute on function public.verify_review_scheduler_token(text) to service_role;

