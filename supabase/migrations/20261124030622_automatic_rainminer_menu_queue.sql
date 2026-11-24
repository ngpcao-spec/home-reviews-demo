-- Additive menu automation only. No review/report changes, no historical backfill.
-- Install with the old menu Cron paused; deploy the new worker before enabling starts.
begin;
set local lock_timeout='5s';
lock table public.rainminer_menu_jobs in access exclusive mode;
do $$begin
 if exists(select 1 from public.rainminer_menu_jobs where status='starting') then
  raise exception 'MENU_DEPLOYMENT_REQUIRES_START_RECONCILIATION';
 end if;
end$$;

create table private.rainminer_menu_config (
 singleton boolean primary key default true check(singleton),
 automatic_enabled boolean not null default false,
 launches_enabled boolean not null default false,
 budget_limit_usd numeric(12,6) not null default 0 check(budget_limit_usd>=0),
 per_run_limit_usd numeric(12,6) not null default 0.5 check(per_run_limit_usd>0 and per_run_limit_usd<=0.5),
 configured_at timestamptz,
 enrollment_started_at timestamptz not null default clock_timestamp(),
 check(not launches_enabled or (configured_at is not null and budget_limit_usd>=per_run_limit_usd))
);
insert into private.rainminer_menu_config(singleton) values(true);
alter table private.rainminer_menu_config enable row level security;
revoke all on private.rainminer_menu_config from public,anon,authenticated,service_role;
-- The cost ledger lives on durable jobs; deleting a restaurant must not erase
-- an uncertain paid start or its reservation.
alter table public.rainminer_menu_jobs
 alter column created_at set default clock_timestamp(),
 alter column establishment_id drop not null,
 drop constraint rainminer_menu_jobs_establishment_id_fkey,
 add constraint rainminer_menu_jobs_establishment_id_fkey foreign key(establishment_id)
  references public.establishments(id) on delete set null,
 add column trigger_kind text not null default 'manual' check(trigger_kind in ('manual','automatic')),
 add column provider_start_attempted_at timestamptz,
 add column provider_input jsonb,
 add column pricing_snapshot jsonb,
 add column run_receipt jsonb,
 add column reserved_cost_usd numeric(12,6) check(reserved_cost_usd>=0),
 add column actual_cost_usd numeric(12,6) check(actual_cost_usd>=0),
 add column reused_run_id text,
 add column retrieved_at timestamptz,
 add column finished_at timestamptz,
 add column updated_at timestamptz not null default now();
-- Waiting restaurants do not consume the single execution slot. Unknown starts
-- hold it: a provider may still be running, so only explicit reconciliation frees it.
drop index public.rainminer_one_active;
create unique index rainminer_one_active on public.rainminer_menu_jobs((true))
 where status in ('starting','running','unknown');
create unique index rainminer_one_pending_place on public.rainminer_menu_jobs(place_id)
 where status in ('queued','starting','running','unknown');
create unique index rainminer_one_automatic_place on public.rainminer_menu_jobs(place_id)
 where trigger_kind='automatic' and place_id ~ '^ChIJ[A-Za-z0-9_-]+$';
create index rainminer_menu_queue on public.rainminer_menu_jobs(created_at,id) where status='queued';
create index rainminer_menu_place_history on public.rainminer_menu_jobs(place_id,created_at desc);

-- A job can serve several explicitly verified targets, without exposing its
-- owner's establishment, reviews, notifications or any other organization rows.
create table private.rainminer_menu_requests (
 establishment_id uuid not null references public.establishments on delete cascade,
 request_id uuid not null,
 place_id text not null,
 job_id uuid not null references public.rainminer_menu_jobs,
 created_at timestamptz not null default clock_timestamp(),
 primary key(establishment_id,request_id)
);
create index rainminer_menu_requests_job on private.rainminer_menu_requests(job_id);
alter table private.rainminer_menu_requests enable row level security;
revoke all on private.rainminer_menu_requests from public,anon,authenticated,service_role;

create table private.rainminer_menu_enqueue_errors (
 import_job_id uuid primary key,
 establishment_id uuid references public.establishments on delete cascade,
 sqlstate text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.rainminer_menu_enqueue_errors enable row level security;
revoke all on private.rainminer_menu_enqueue_errors from public,anon,authenticated,service_role;

create function private.lock_rainminer_configuration() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(75302143);
 return new;
end$$;
create trigger rainminer_configuration_lock before update on private.rainminer_menu_config
 for each row execute function private.lock_rainminer_configuration();

create function private.rainminer_budget_used() returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(case
  when actual_cost_usd is not null and status in ('completed','failed') then actual_cost_usd
  else coalesce(reserved_cost_usd,case when status in ('starting','running','unknown')
   and (pricing_snapshot is null or provider_start_attempted_at is not null) then 0.5 else 0 end)
 end),0) from public.rainminer_menu_jobs
$$;
create function private.rainminer_launch_block(p_automatic boolean) returns text
language sql stable security definer set search_path='' as $$
 select case when not launches_enabled or configured_at is null then 'MENU_LAUNCHES_DISABLED'
  when p_automatic and not automatic_enabled then 'MENU_AUTOMATIC_DISABLED'
  when private.rainminer_budget_used()+per_run_limit_usd>budget_limit_usd then 'MENU_BUDGET_LIMIT'
  end from private.rainminer_menu_config where singleton
$$;
create function private.rainminer_live_target(p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rainminer_menu_jobs j join public.establishments e
  on e.id=j.establishment_id and e.place_id=j.place_id and e.active where j.id=p_job)
 or exists(select 1 from private.rainminer_menu_requests r join public.establishments e
  on e.id=r.establishment_id and e.place_id=r.place_id and e.active where r.job_id=p_job)
$$;

-- Shared menu reuse still respects the existing pilot allowlist.
create function private.rainminer_shared_saved(p_place text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
 if not private.shared_pilot_place(p_place) then return null; end if;
 select jsonb_build_object('raw',v.raw,'result',v.menu_references,'runId',v.run_id,'collectedAt',v.collected_at)
 into saved from private.shared_restaurant_menu_versions v join private.shared_restaurants r on r.id=v.restaurant_id
 where r.place_id=p_place and v.menu_references->>'placeId'=p_place
  and jsonb_typeof(v.menu_references->'references')='array'
 order by v.collected_at desc,v.run_id limit 1;
 return saved;
end$$;

create function private.enqueue_rainminer_target(p_establishment uuid,p_request uuid,p_automatic boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.establishments; job uuid; saved jsonb;
begin
 perform pg_advisory_xact_lock(75302143);
 select * into strict e from public.establishments where id=p_establishment and active;
 select job_id into job from private.rainminer_menu_requests where establishment_id=e.id and request_id=p_request;
 if job is not null then return job; end if;
 select id into job from public.rainminer_menu_jobs where establishment_id=e.id and request_id=p_request;
 if job is not null then return job; end if;
 if coalesce(e.place_id,'') !~ '^ChIJ[A-Za-z0-9_-]+$' then
  if not p_automatic then raise exception 'MENU_PLACE_ID_REQUIRED'; end if;
  insert into public.rainminer_menu_jobs(establishment_id,place_id,request_id,trigger_kind,status,error_code,finished_at)
   values(e.id,coalesce(e.place_id,''),p_request,'automatic','failed','MENU_PLACE_ID_REQUIRED',now()) returning id into job;
 else
  -- Join an in-flight/uncertain attempt even across organizations. Automatic
  -- enrollment also reuses finished menus or the one previous automatic attempt.
  select id into job from public.rainminer_menu_jobs where place_id=e.place_id
   and (status in ('queued','starting','running','unknown') or
    (p_automatic and ((status='completed' and result->>'placeId'=e.place_id and jsonb_typeof(result->'references')='array')
      or trigger_kind='automatic')))
   order by (status in ('queued','starting','running','unknown')) desc,(status='completed') desc,created_at desc,id limit 1;
  if job is null and p_automatic then saved:=private.rainminer_shared_saved(e.place_id); end if;
  if job is null then
   insert into public.rainminer_menu_jobs(establishment_id,place_id,request_id,trigger_kind,status,raw,result,reused_run_id,retrieved_at,finished_at)
   values(e.id,e.place_id,p_request,case when p_automatic then 'automatic' else 'manual' end,
    case when saved is null then 'queued' else 'completed' end,saved->'raw',saved->'result',saved->>'runId',
    (saved->>'collectedAt')::timestamptz,case when saved is not null then now() end) returning id into job;
  end if;
 end if;
 insert into private.rainminer_menu_requests(establishment_id,request_id,place_id,job_id)
  values(e.id,p_request,coalesce(e.place_id,''),job);
 return job;
end$$;

-- Both finalize_initial_import_job and the shared fast-join end here.
-- No HTTP or provider call is made inside the import transaction.
create function private.enqueue_menu_after_initial_import() returns trigger
language plpgsql security definer set search_path='' as $$
declare c private.rainminer_menu_config; e public.establishments;
begin
 select * into c from private.rainminer_menu_config where singleton;
 if not c.automatic_enabled or new.request_kind<>'initial' or new.error_code is not null
  or new.result#>>'{collection,status}'='partial' or new.created_at<c.enrollment_started_at then return new; end if;
 select * into e from public.establishments where id=new.establishment_id and active;
 if e.id is null or e.created_at<c.enrollment_started_at then return new; end if;
 begin
  perform private.enqueue_rainminer_target(e.id,new.id,true);
 exception when others then
  -- Menu admission cannot roll back a successful review import. Persist a
  -- diagnostic for the panel/operator, with no secrets or automatic paid retry.
  insert into private.rainminer_menu_enqueue_errors(import_job_id,establishment_id,sqlstate)
   values(new.id,e.id,sqlstate) on conflict(import_job_id) do update set sqlstate=excluded.sqlstate,recorded_at=now();
 end;
 return new;
end$$;
create trigger automatic_menu_after_import after update of status on public.initial_import_jobs
 for each row when(new.status='completed' and old.status is distinct from 'completed')
 execute function private.enqueue_menu_after_initial_import();

create or replace function public.enqueue_rainminer_menu(p_establishment uuid,p_request uuid,p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid; blocked text;
begin
 select organization_id into strict org from public.establishments where id=p_establishment and active;
 if not exists(select 1 from public.organization_members where organization_id=org and user_id=p_user
  and role in ('owner','admin','manager')) then raise exception 'MENU_FORBIDDEN'; end if;
 -- An acknowledged request always returns its original reservation, even if
 -- the budget/configuration changed after the first response was lost.
 if exists(select 1 from private.rainminer_menu_requests where establishment_id=p_establishment and request_id=p_request) then
  return (select job_id from private.rainminer_menu_requests where establishment_id=p_establishment and request_id=p_request);
 end if;
 perform pg_advisory_xact_lock(75302143);
 blocked:=private.rainminer_launch_block(false);
 if blocked is not null then raise exception '%',blocked; end if;
 return private.enqueue_rainminer_target(p_establishment,p_request,false);
end$$;
-- Retire the old service-callable entry point; it bypassed the cost gate.
revoke all on function public.enqueue_rainminer_menu_before_sharing(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.claim_rainminer_menu()
returns setof public.rainminer_menu_jobs language plpgsql security definer set search_path='' as $$
declare j public.rainminer_menu_jobs; blocked text; saved jsonb;
begin
 perform pg_advisory_xact_lock(75302143);
 -- Old workers did not record attempted_at: a legacy starting lease must
 -- remain unknown, never silently return to queued.
 update public.rainminer_menu_jobs set status=case when provider_start_attempted_at is null and pricing_snapshot is not null then 'queued' else 'unknown' end,
  error_code=case when provider_start_attempted_at is null and pricing_snapshot is not null then null else 'START_OUTCOME_UNKNOWN' end,
  lease_until=null,updated_at=now()
 where status='starting' and lease_until<=now();
 -- A saved, correctly identified response can resume GETs, never another POST.
 update public.rainminer_menu_jobs set status='running',error_code=null
 where status='unknown' and run_id is not null and run_receipt->>'id'=run_id
  and run_receipt->>'actId'='8GGZ9N7j2JhqnQ3oT';
 select * into j from public.rainminer_menu_jobs where status in ('starting','running','unknown') order by created_at limit 1;
 if j.id is not null then
  if j.status<>'running' or j.lease_until>now() then return; end if;
 else
  select * into j from public.rainminer_menu_jobs where status='queued'
   and (trigger_kind='manual' or (select automatic_enabled from private.rainminer_menu_config where singleton))
   order by created_at,id for update skip locked limit 1;
  if j.id is null then return; end if;
  if not private.rainminer_live_target(j.id) then
   update public.rainminer_menu_jobs set status='failed',error_code='MENU_NO_ACTIVE_TARGET',finished_at=now() where id=j.id;
   return;
  end if;
  saved:=private.rainminer_shared_saved(j.place_id);
  if saved is not null and j.trigger_kind='automatic' then
   update public.rainminer_menu_jobs set status='completed',raw=saved->'raw',result=saved->'result',
    reused_run_id=saved->>'runId',retrieved_at=(saved->>'collectedAt')::timestamptz,finished_at=now(),error_code=null where id=j.id;
   return;
  end if;
  blocked:=private.rainminer_launch_block(j.trigger_kind='automatic');
  if blocked is not null then
   update public.rainminer_menu_jobs set error_code=blocked where id=j.id and error_code is distinct from blocked;
   return;
  end if;
 end if;
 return query update public.rainminer_menu_jobs set status=case when status='queued' then 'starting' else status end,
  -- Non-null empty metadata identifies the safe preflight stage of the new worker.
  pricing_snapshot=case when status='queued' then '{}'::jsonb else pricing_snapshot end,
  lease_until=clock_timestamp()+interval '3 minutes',updated_at=now(),error_code=null
 where id=j.id returning *;
end$$;

create function public.authorize_rainminer_start(p_job uuid,p_lease timestamptz,p_input jsonb,p_pricing jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.rainminer_menu_jobs; blocked text; cap numeric;
begin
 perform pg_advisory_xact_lock(75302143);
 select * into j from public.rainminer_menu_jobs where id=p_job and status='starting'
  and lease_until=p_lease and lease_until>clock_timestamp() and provider_start_attempted_at is null for update;
 if j.id is null then return '{"authorized":false,"reason":"MENU_LEASE_LOST"}'; end if;
 blocked:=private.rainminer_launch_block(j.trigger_kind='automatic');
 if not private.rainminer_live_target(j.id) then blocked:='MENU_NO_ACTIVE_TARGET'; end if;
 if blocked is not null then
  update public.rainminer_menu_jobs set status=case when blocked='MENU_NO_ACTIVE_TARGET' then 'failed' else 'queued' end,
   error_code=blocked,lease_until=null,updated_at=now() where id=j.id;
  return jsonb_build_object('authorized',false,'reason',blocked);
 end if;
 if p_input is distinct from jsonb_build_object('placeIds',jsonb_build_array(j.place_id),'maxMenuImages',10,'maxItems',100)
  or p_pricing->>'actorId' is distinct from '8GGZ9N7j2JhqnQ3oT' or p_pricing#>>'{pricing,pricingModel}' is distinct from 'PAY_PER_EVENT' then
  raise exception 'MENU_START_CONTRACT_MISMATCH';
 end if;
 select per_run_limit_usd into cap from private.rainminer_menu_config where singleton;
 if coalesce((p_pricing#>>'{pricing,minimalMaxTotalChargeUsd}')::numeric,0)>cap then
  raise exception 'MENU_ACTOR_PRICING_UNSUPPORTED';
 end if;
 update public.rainminer_menu_jobs set provider_start_attempted_at=clock_timestamp(),provider_input=p_input,
  pricing_snapshot=p_pricing,reserved_cost_usd=cap,updated_at=now() where id=j.id;
 return jsonb_build_object('authorized',true,'maxTotalChargeUsd',cap);
end$$;

create function public.checkpoint_rainminer_menu(p_job uuid,p_lease timestamptz,p_values jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_values->>'status' not in ('running','completed','failed','unknown') then raise exception 'MENU_INVALID_CHECKPOINT'; end if;
 update public.rainminer_menu_jobs set status=p_values->>'status',run_id=coalesce(p_values->>'run_id',run_id),
  raw=coalesce(p_values->'raw',raw),result=coalesce(p_values->'result',result),
  run_receipt=coalesce(p_values->'run_receipt',run_receipt),
  actual_cost_usd=coalesce((p_values->>'actual_cost_usd')::numeric,actual_cost_usd),
  retrieved_at=coalesce((p_values->>'retrieved_at')::timestamptz,retrieved_at),
  finished_at=case when p_values->>'status' in ('completed','failed') then now() else finished_at end,
  error_code=p_values->>'error_code',lease_until=null,updated_at=now()
 where id=p_job and lease_until=p_lease and status in ('starting','running');
 get diagnostics changed=row_count;
 return changed=1;
end$$;

create function public.read_rainminer_menu(p_establishment uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.establishments; latest jsonb; saved jsonb; shared jsonb; blocked text;
begin
 select * into e from public.establishments where id=p_establishment and active;
 if e.id is null or not exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=p_user) then
  raise exception 'MENU_FORBIDDEN';
 end if;
 select jsonb_build_object('id',j.id,'request_id',coalesce(r.request_id,j.request_id),'status',j.status,
  'error_code',j.error_code,'trigger_kind',j.trigger_kind,'collected_at',j.retrieved_at)
 into latest from public.rainminer_menu_jobs j
 left join private.rainminer_menu_requests r on r.job_id=j.id and r.establishment_id=e.id and r.place_id=e.place_id
 where j.place_id=coalesce(e.place_id,'') and (j.establishment_id=e.id or r.establishment_id=e.id)
 order by coalesce(r.created_at,j.created_at) desc,j.created_at desc limit 1;
 select j.result into saved from public.rainminer_menu_jobs j where j.place_id=e.place_id and j.status='completed'
 and (j.establishment_id=e.id or exists(select 1 from private.rainminer_menu_requests r where r.job_id=j.id and r.establishment_id=e.id and r.place_id=e.place_id))
 order by coalesce(j.retrieved_at,j.created_at) desc,j.id limit 1;
 shared:=public.read_shared_establishment_menu(e.id,p_user);
 saved:=coalesce(nullif(shared->'result','null'::jsonb),saved);
 latest:=coalesce(latest,nullif(shared->'job','null'::jsonb));
 if latest is null and exists(select 1 from private.rainminer_menu_enqueue_errors where establishment_id=e.id) then
  latest:=jsonb_build_object('status','failed','error_code','MENU_ENQUEUE_FAILED');
 end if;
 blocked:=private.rainminer_launch_block(false);
 return jsonb_build_object('job',latest,'result',saved,'launchBlock',blocked,
  'maxCostUsd',(select per_run_limit_usd from private.rainminer_menu_config where singleton));
end$$;

-- Preserve the catalog and reuse the existing sharing gates. Only menu content
-- is projected; no subscriber's private state accompanies it.
create or replace function public.seed_shared_establishment_menus(p_establishment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare restaurant uuid; copied integer;
begin
 restaurant:=public.shared_restaurant_for_establishment(p_establishment);
 if restaurant is null then return 0; end if;
 insert into private.shared_restaurant_menu_versions(restaurant_id,run_id,collected_at,raw,menu_references,provenance)
 select restaurant,coalesce(j.run_id,j.reused_run_id),coalesce(j.retrieved_at,j.created_at),j.raw,j.result,
  coalesce(j.result->'provenance','{}')||jsonb_build_object('actor','rainminer/google-maps-menu-scraper','legacyJobId',j.id)
 from public.rainminer_menu_jobs j join private.shared_restaurants r on r.id=restaurant and r.place_id=j.place_id
 where (j.establishment_id=p_establishment or exists(select 1 from private.rainminer_menu_requests q where q.job_id=j.id and q.establishment_id=p_establishment and q.place_id=j.place_id))
  and j.status='completed' and coalesce(j.run_id,j.reused_run_id) is not null and j.raw is not null and j.result is not null
 on conflict(restaurant_id,run_id) do update set menu_references=excluded.menu_references
  where private.shared_restaurant_menu_versions.menu_references is distinct from excluded.menu_references;
 get diagnostics copied=row_count;
 return copied;
end$$;
create or replace function private.capture_shared_rainminer_menu() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if new.status<>'completed' or new.raw is null or new.result is null then return new; end if;
 for target in select new.establishment_id where new.establishment_id is not null
  union select establishment_id from private.rainminer_menu_requests where job_id=new.id and place_id=new.place_id loop
  perform public.seed_shared_establishment_menus(target);
 end loop;
 return new;
end$$;

revoke all on function private.lock_rainminer_configuration(),private.rainminer_budget_used(),
 private.rainminer_launch_block(boolean),private.rainminer_live_target(uuid),private.rainminer_shared_saved(text),
 private.enqueue_rainminer_target(uuid,uuid,boolean),private.enqueue_menu_after_initial_import()
 from public,anon,authenticated,service_role;
revoke all on function public.authorize_rainminer_start(uuid,timestamptz,jsonb,jsonb),
 public.checkpoint_rainminer_menu(uuid,timestamptz,jsonb),public.read_rainminer_menu(uuid,uuid),
 public.enqueue_rainminer_menu(uuid,uuid,uuid),public.claim_rainminer_menu(),public.seed_shared_establishment_menus(uuid) from public,anon,authenticated;
grant execute on function public.authorize_rainminer_start(uuid,timestamptz,jsonb,jsonb),
 public.checkpoint_rainminer_menu(uuid,timestamptz,jsonb),public.read_rainminer_menu(uuid,uuid),
 public.enqueue_rainminer_menu(uuid,uuid,uuid),public.claim_rainminer_menu(),public.seed_shared_establishment_menus(uuid) to service_role;
commit;
