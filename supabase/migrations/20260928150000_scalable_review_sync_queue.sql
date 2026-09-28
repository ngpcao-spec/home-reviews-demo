create table public.review_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','retry','completed','dead')),
  scheduled_for timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  claim_count integer not null default 0 check (claim_count >= 0),
  lease_until timestamptz,
  locked_by text,
  pagination_cursor text,
  checkpoint_review_id text,
  checkpoint_review_at timestamptz,
  head_review_id text,
  head_review_at timestamptz,
  provider_requests integer not null default 0 check (provider_requests >= 0),
  reviews_fetched integer not null default 0 check (reviews_fetched >= 0),
  reviews_inserted integer not null default 0 check (reviews_inserted >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create unique index review_sync_jobs_one_active_per_establishment
  on public.review_sync_jobs(establishment_id)
  where status in ('queued','running','retry');
create index review_sync_jobs_claim_idx
  on public.review_sync_jobs(available_at,scheduled_for,id)
  where status in ('queued','retry');
create index review_sync_jobs_expired_lease_idx
  on public.review_sync_jobs(lease_until,id) where status='running';
create index review_sync_jobs_observability_idx
  on public.review_sync_jobs(status,created_at desc);
create index if not exists establishments_due_sync_idx
  on public.establishments(next_sync_at,id)
  where active=true and next_sync_at is not null;

alter table public.review_sync_jobs enable row level security;
revoke all on public.review_sync_jobs from public,anon,authenticated;
grant all on public.review_sync_jobs to service_role;

create table public.review_sync_provider_slots (
  slot_number smallint primary key check(slot_number>0),
  locked_by text,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.review_sync_provider_slots(slot_number)
select n from generate_series(1,5) n;
alter table public.review_sync_provider_slots enable row level security;
revoke all on public.review_sync_provider_slots from public,anon,authenticated;
grant all on public.review_sync_provider_slots to service_role;

create function public.review_sync_spread_offset(p_establishment_id uuid,p_interval_hours integer)
returns interval language sql immutable set search_path='' as $$
  select make_interval(secs=>(
    (('x'||substr(md5(p_establishment_id::text),1,8))::bit(32)::bigint
      % least(300,greatest(30,p_interval_hours*15)))
    -(least(300,greatest(30,p_interval_hours*15))/2)
  )::integer)
$$;
revoke all on function public.review_sync_spread_offset(uuid,integer) from public,anon,authenticated;
grant execute on function public.review_sync_spread_offset(uuid,integer) to service_role;

create function public.enqueue_due_review_sync_jobs(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  with due as (
    select e.id,e.organization_id,e.next_sync_at,e.last_review_id,e.last_review_at
    from public.establishments e
    where e.active=true and e.next_sync_at<=now()
    order by e.next_sync_at,e.id
    for update skip locked
    limit least(greatest(coalesce(p_limit,1000),1),10000)
  ), ins as (
    insert into public.review_sync_jobs(
      establishment_id,organization_id,scheduled_for,available_at,
      checkpoint_review_id,checkpoint_review_at)
    select id,organization_id,next_sync_at,now(),last_review_id,last_review_at from due
    on conflict do nothing returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end $$;
revoke all on function public.enqueue_due_review_sync_jobs(integer) from public,anon,authenticated;
grant execute on function public.enqueue_due_review_sync_jobs(integer) to service_role;

create function public.enqueue_user_due_review_sync_jobs(
  p_user_id uuid,p_establishment_id uuid default null,p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  with due as (
    select e.id,e.organization_id,e.next_sync_at,e.last_review_id,e.last_review_at
    from public.establishments e
    join public.organization_members m on m.organization_id=e.organization_id and m.user_id=p_user_id
    where e.active=true and e.next_sync_at<=now()
      and (p_establishment_id is null or e.id=p_establishment_id)
    order by e.next_sync_at,e.id
    for update of e skip locked
    limit least(greatest(coalesce(p_limit,100),1),1000)
  ), ins as (
    insert into public.review_sync_jobs(
      establishment_id,organization_id,scheduled_for,available_at,
      checkpoint_review_id,checkpoint_review_at)
    select id,organization_id,next_sync_at,now(),last_review_id,last_review_at from due
    on conflict do nothing returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end $$;
revoke all on function public.enqueue_user_due_review_sync_jobs(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.enqueue_user_due_review_sync_jobs(uuid,uuid,integer) to service_role;

create function public.claim_review_sync_jobs(
  p_worker_id text,p_limit integer default 25,p_lease_seconds integer default 240)
returns table(
  id uuid,establishment_id uuid,organization_id uuid,status text,attempts integer,
  pagination_cursor text,checkpoint_review_id text,checkpoint_review_at timestamptz,
  head_review_id text,head_review_at timestamptz,provider_requests integer,
  reviews_fetched integer,reviews_inserted integer,google_id text,google_maps_url text)
language sql security definer set search_path='' as $$
  with candidates as (
    select j.id from public.review_sync_jobs j
    where (j.status in ('queued','retry') and j.available_at<=now())
       or (j.status='running' and j.lease_until<now())
    order by j.available_at,j.scheduled_for,j.id
    for update skip locked
    limit least(greatest(coalesce(p_limit,25),1),100)
  ), claimed as (
    update public.review_sync_jobs j set
      status='running',locked_by=left(p_worker_id,120),
      lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
      started_at=coalesce(j.started_at,now()),finished_at=null,
      claim_count=j.claim_count+1,updated_at=now()
    from candidates c where j.id=c.id returning j.*
  )
  select c.id,c.establishment_id,c.organization_id,c.status,c.attempts,
    c.pagination_cursor,c.checkpoint_review_id,c.checkpoint_review_at,
    c.head_review_id,c.head_review_at,c.provider_requests,c.reviews_fetched,
    c.reviews_inserted,e.google_id,e.google_maps_url
  from claimed c join public.establishments e on e.id=c.establishment_id
  order by c.scheduled_for,c.id
$$;
revoke all on function public.claim_review_sync_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_review_sync_jobs(text,integer,integer) to service_role;

create function public.heartbeat_review_sync_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 240)
returns boolean language sql security definer set search_path='' as $$
  with u as (
    update public.review_sync_jobs set
      lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
      updated_at=now()
    where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
      and lease_until>now() returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.heartbeat_review_sync_job(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.heartbeat_review_sync_job(uuid,text,integer) to service_role;

create function public.checkpoint_review_sync_job(
  p_job_id uuid,p_worker_id text,p_pagination_cursor text,
  p_head_review_id text,p_head_review_at timestamptz,
  p_provider_requests integer,p_reviews_fetched integer,p_reviews_inserted integer,
  p_lease_seconds integer default 240)
returns boolean language sql security definer set search_path='' as $$
  with u as (
    update public.review_sync_jobs set
      pagination_cursor=p_pagination_cursor,
      head_review_id=coalesce(head_review_id,p_head_review_id),
      head_review_at=coalesce(head_review_at,p_head_review_at),
      provider_requests=provider_requests+greatest(coalesce(p_provider_requests,0),0),
      reviews_fetched=reviews_fetched+greatest(coalesce(p_reviews_fetched,0),0),
      reviews_inserted=reviews_inserted+greatest(coalesce(p_reviews_inserted,0),0),
      lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
      updated_at=now()
    where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
      and lease_until>now() returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.checkpoint_review_sync_job(uuid,text,text,text,timestamptz,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.checkpoint_review_sync_job(uuid,text,text,text,timestamptz,integer,integer,integer,integer) to service_role;

create function public.continue_review_sync_job(
  p_job_id uuid,p_worker_id text,p_delay_seconds integer default 0)
returns boolean language sql security definer set search_path='' as $$
  with u as (
    update public.review_sync_jobs set status='queued',
      available_at=now()+make_interval(secs=>least(greatest(coalesce(p_delay_seconds,0),0),300)),
      lease_until=null,locked_by=null,error_code=null,updated_at=now()
    where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
    returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.continue_review_sync_job(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.continue_review_sync_job(uuid,text,integer) to service_role;

create function public.complete_review_sync_job(
  p_job_id uuid,p_worker_id text,p_synced_at timestamptz default now())
returns boolean language plpgsql security definer set search_path='' as $$
declare v_job public.review_sync_jobs%rowtype; v_interval integer;
begin
  select * into v_job from public.review_sync_jobs
  where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
    and lease_until>now() for update;
  if not found then return false; end if;
  select monitoring_interval_hours into v_interval
  from public.organizations where id=v_job.organization_id;
  update public.establishments set
    last_review_id=coalesce(v_job.head_review_id,last_review_id),
    last_review_at=coalesce(v_job.head_review_at,last_review_at),
    last_sync_at=p_synced_at,
    next_sync_at=p_synced_at+make_interval(hours=>v_interval)
      +public.review_sync_spread_offset(id,v_interval),
    sync_status='ok',sync_error=null,last_sync_status='ok',last_sync_error=null,
    sync_lock_token=null,sync_locked_until=null
  where id=v_job.establishment_id;
  update public.review_sync_jobs set status='completed',lease_until=null,locked_by=null,
    pagination_cursor=null,error_code=null,finished_at=now(),updated_at=now()
  where id=p_job_id;
  return true;
end $$;
revoke all on function public.complete_review_sync_job(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_review_sync_job(uuid,text,timestamptz) to service_role;

create function public.fail_review_sync_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,
  p_max_attempts integer default 5,p_backoff_seconds integer default 60)
returns text language plpgsql security definer set search_path='' as $$
declare v_attempts integer; v_status text; v_establishment_id uuid;
begin
  select attempts+1,establishment_id into v_attempts,v_establishment_id
  from public.review_sync_jobs
  where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
  for update;
  if not found then return 'lease_lost'; end if;
  v_status:=case when p_retryable
    and v_attempts<least(greatest(coalesce(p_max_attempts,5),1),20)
    then 'retry' else 'dead' end;
  update public.review_sync_jobs set status=v_status,attempts=v_attempts,
    available_at=case when v_status='retry' then
      now()+make_interval(secs=>least(greatest(coalesce(p_backoff_seconds,60),1),86400))
      else available_at end,
    lease_until=null,locked_by=null,error_code=left(coalesce(p_error_code,'SYNC_FAILED'),200),
    finished_at=case when v_status='dead' then now() else null end,updated_at=now()
  where id=p_job_id;
  update public.establishments set
    sync_status=case when v_status='dead' then 'error' else 'pending' end,
    sync_error=left(coalesce(p_error_code,'SYNC_FAILED'),200),
    last_sync_status=case when v_status='dead' then 'error' else 'pending' end,
    last_sync_error=left(coalesce(p_error_code,'SYNC_FAILED'),200)
  where id=v_establishment_id;
  return v_status;
end $$;
revoke all on function public.fail_review_sync_job(uuid,text,text,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.fail_review_sync_job(uuid,text,text,boolean,integer,integer) to service_role;

create function public.claim_review_provider_slot(
  p_worker_token text,p_lease_seconds integer default 60)
returns smallint language plpgsql security definer set search_path='' as $$
declare v_slot smallint;
begin
  select slot_number into v_slot from public.review_sync_provider_slots
  where available_at<=now() and (locked_by is null or lease_until<now())
  order by slot_number for update skip locked limit 1;
  if v_slot is null then return null; end if;
  update public.review_sync_provider_slots set locked_by=left(p_worker_token,160),
    lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,60),10),180)),
    updated_at=now() where slot_number=v_slot;
  return v_slot;
end $$;
revoke all on function public.claim_review_provider_slot(text,integer) from public,anon,authenticated;
grant execute on function public.claim_review_provider_slot(text,integer) to service_role;

create function public.release_review_provider_slot(
  p_slot_number smallint,p_worker_token text,p_cooldown_ms integer default 200)
returns boolean language sql security definer set search_path='' as $$
  with u as (
    update public.review_sync_provider_slots set locked_by=null,lease_until=null,
      available_at=clock_timestamp()
        +(least(greatest(coalesce(p_cooldown_ms,200),0),10000)::text||' milliseconds')::interval,
      updated_at=now()
    where slot_number=p_slot_number and locked_by=left(p_worker_token,160)
    returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.release_review_provider_slot(smallint,text,integer) from public,anon,authenticated;
grant execute on function public.release_review_provider_slot(smallint,text,integer) to service_role;

create view public.review_sync_observability with(security_invoker=true) as
select
  count(*) filter(where status='queued') jobs_queued,
  count(*) filter(where status='running') jobs_running,
  count(*) filter(where status='retry') jobs_retry,
  count(*) filter(where status='dead') jobs_dead,
  extract(epoch from now()-min(scheduled_for)
    filter(where status in ('queued','running','retry')))::bigint oldest_job_lag_seconds,
  round(100.0*count(*) filter(where status='completed' and finished_at>=now()-interval '24 hours')
    /nullif(count(*) filter(where finished_at>=now()-interval '24 hours'),0),2) sync_success_rate_24h,
  round(avg(extract(epoch from finished_at-started_at))
    filter(where status='completed' and finished_at>=now()-interval '24 hours'),2)
    average_duration_seconds_24h,
  coalesce(sum(provider_requests) filter(where created_at>=now()-interval '24 hours'),0)
    provider_requests_24h,
  coalesce(sum(reviews_fetched) filter(where created_at>=now()-interval '24 hours'),0)
    reviews_fetched_24h,
  coalesce(sum(reviews_inserted) filter(where created_at>=now()-interval '24 hours'),0)
    reviews_inserted_24h,
  coalesce(sum(provider_requests) filter(where created_at>=now()-interval '24 hours'),0)
    estimated_provider_units_24h,
  (select count(*) from public.establishments e
   where e.active=true and e.next_sync_at<=now()) establishments_overdue
from public.review_sync_jobs;
revoke all on public.review_sync_observability from public,anon,authenticated;
grant select on public.review_sync_observability to service_role;

do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname in(
    'home-reviews-hourly-scheduler','home-reviews-sync-scheduler-v2',
    'home-reviews-sync-worker-v2')
  loop perform cron.unschedule(v_job.jobid); end loop;
end $$;

select cron.schedule('home-reviews-sync-scheduler-v2','* * * * *',$cron$
  select net.http_post(
    url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/schedule-google-reviews',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-home-reviews-scheduler',(
        select decrypted_secret from vault.decrypted_secrets
        where name='home_reviews_scheduler_token')),
    body:='{}'::jsonb,timeout_milliseconds:=10000);
$cron$);

select cron.schedule('home-reviews-sync-worker-v2','* * * * *',$cron$
  select net.http_post(
    url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-review-sync-jobs',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-home-reviews-scheduler',(
        select decrypted_secret from vault.decrypted_secrets
        where name='home_reviews_scheduler_token')),
    body:='{}'::jsonb,timeout_milliseconds:=10000);
$cron$);
