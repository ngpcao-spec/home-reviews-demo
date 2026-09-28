create table public.review_sync_runtime_config (
  singleton boolean primary key default true check(singleton),
  scheduler_enqueue_limit integer not null default 1000
    check(scheduler_enqueue_limit between 1 and 10000),
  claim_batch integer not null default 25 check(claim_batch between 1 and 100),
  worker_concurrency integer not null default 5 check(worker_concurrency between 1 and 32),
  worker_time_budget_ms integer not null default 50000
    check(worker_time_budget_ms between 5000 and 120000),
  max_batches_per_invocation integer not null default 8
    check(max_batches_per_invocation between 1 and 100),
  lease_seconds integer not null default 240 check(lease_seconds between 30 and 900),
  max_pages_per_claim integer not null default 5 check(max_pages_per_claim between 1 and 25),
  max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  retry_base_seconds integer not null default 60 check(retry_base_seconds between 1 and 3600),
  provider_slot_count integer not null default 5 check(provider_slot_count between 1 and 64),
  provider_lease_seconds integer not null default 60 check(provider_lease_seconds between 10 and 180),
  provider_cooldown_ms integer not null default 200 check(provider_cooldown_ms between 0 and 10000),
  jitter_fraction numeric(5,4) not null default 0.1000
    check(jitter_fraction between 0 and 0.5),
  jitter_cap_minutes integer not null default 30 check(jitter_cap_minutes between 0 and 180),
  completed_retention_days integer not null default 14
    check(completed_retention_days between 1 and 365),
  dead_retention_days integer not null default 90
    check(dead_retention_days between 7 and 730),
  maintenance_batch_size integer not null default 1000
    check(maintenance_batch_size between 10 and 10000),
  updated_at timestamptz not null default now()
);
insert into public.review_sync_runtime_config(singleton) values(true);
alter table public.review_sync_runtime_config enable row level security;
revoke all on public.review_sync_runtime_config from public,anon,authenticated;
grant all on public.review_sync_runtime_config to service_role;

insert into public.review_sync_provider_slots(slot_number)
select n from generate_series(6,64) n on conflict do nothing;

create or replace function public.get_review_sync_runtime_config()
returns public.review_sync_runtime_config
language sql stable security definer set search_path='' as $$
  select * from public.review_sync_runtime_config where singleton=true
$$;
revoke all on function public.get_review_sync_runtime_config() from public,anon,authenticated;
grant execute on function public.get_review_sync_runtime_config() to service_role;

create or replace function public.configure_review_sync_runtime(
  p_provider_slot_count integer default null,
  p_worker_concurrency integer default null,
  p_claim_batch integer default null,
  p_worker_time_budget_ms integer default null,
  p_max_batches_per_invocation integer default null,
  p_jitter_fraction numeric default null,
  p_jitter_cap_minutes integer default null,
  p_completed_retention_days integer default null,
  p_dead_retention_days integer default null,
  p_maintenance_batch_size integer default null
) returns public.review_sync_runtime_config
language plpgsql security definer set search_path='' as $$
declare v_config public.review_sync_runtime_config;
begin
  update public.review_sync_runtime_config set
    provider_slot_count=coalesce(p_provider_slot_count,provider_slot_count),
    worker_concurrency=coalesce(p_worker_concurrency,worker_concurrency),
    claim_batch=coalesce(p_claim_batch,claim_batch),
    worker_time_budget_ms=coalesce(p_worker_time_budget_ms,worker_time_budget_ms),
    max_batches_per_invocation=coalesce(p_max_batches_per_invocation,max_batches_per_invocation),
    jitter_fraction=coalesce(p_jitter_fraction,jitter_fraction),
    jitter_cap_minutes=coalesce(p_jitter_cap_minutes,jitter_cap_minutes),
    completed_retention_days=coalesce(p_completed_retention_days,completed_retention_days),
    dead_retention_days=coalesce(p_dead_retention_days,dead_retention_days),
    maintenance_batch_size=coalesce(p_maintenance_batch_size,maintenance_batch_size),
    updated_at=now()
  where singleton=true returning * into v_config;
  if v_config.worker_concurrency>v_config.provider_slot_count then
    raise exception 'WORKER_CONCURRENCY_EXCEEDS_PROVIDER_SLOTS';
  end if;
  return v_config;
end $$;
revoke all on function public.configure_review_sync_runtime(integer,integer,integer,integer,integer,numeric,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.configure_review_sync_runtime(integer,integer,integer,integer,integer,numeric,integer,integer,integer,integer)
  to service_role;

create or replace function public.review_sync_spread_offset(
  p_establishment_id uuid,p_interval_hours integer)
returns interval language sql stable security definer set search_path='' as $$
  with config as (
    select jitter_fraction,jitter_cap_minutes
    from public.review_sync_runtime_config where singleton=true
  ), span as (
    select least(
      greatest(0,round(p_interval_hours*3600*jitter_fraction)::integer),
      jitter_cap_minutes*60
    ) seconds from config
  )
  select make_interval(secs=>case when seconds=0 then 0 else
    ((('x'||substr(md5(p_establishment_id::text),1,8))::bit(32)::bigint
      % (seconds+1))-(seconds/2))::integer end)
  from span
$$;
revoke all on function public.review_sync_spread_offset(uuid,integer) from public,anon,authenticated;
grant execute on function public.review_sync_spread_offset(uuid,integer) to service_role;

create or replace function private.set_new_establishment_schedule()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_hours integer;
begin
  if new.next_sync_at is null then
    select monitoring_interval_hours into v_hours
    from public.organizations where id=new.organization_id;
    v_hours:=coalesce(v_hours,12);
    new.next_sync_at:=coalesce(new.last_sync_at,now())+make_interval(hours=>v_hours)
      +public.review_sync_spread_offset(new.id,v_hours);
  end if;
  return new;
end $$;

create or replace function public.set_monitoring_interval(p_hours smallint)
returns smallint language plpgsql security definer set search_path='' as $$
declare v_organization_id uuid;
begin
  if p_hours not in(1,3,6,12,24) then raise exception 'INVALID_MONITORING_INTERVAL'; end if;
  select organization_id into v_organization_id
  from public.organization_members
  where user_id=(select auth.uid()) and role in('owner','admin')
  order by created_at limit 1;
  if v_organization_id is null then raise exception 'FORBIDDEN'; end if;
  update public.organizations set monitoring_interval_hours=p_hours
  where id=v_organization_id;
  update public.establishments set
    next_sync_at=coalesce(last_sync_at,now())+make_interval(hours=>p_hours)
      +public.review_sync_spread_offset(id,p_hours)
  where organization_id=v_organization_id and active=true;
  return p_hours;
end $$;

create or replace function public.claim_review_provider_slot(
  p_worker_token text,p_lease_seconds integer default 60)
returns smallint language plpgsql security definer set search_path='' as $$
declare v_slot smallint; v_slot_count integer;
begin
  select provider_slot_count into v_slot_count
  from public.review_sync_runtime_config where singleton=true;
  select slot_number into v_slot from public.review_sync_provider_slots
  where slot_number<=v_slot_count and available_at<=now()
    and (locked_by is null or lease_until<now())
  order by slot_number for update skip locked limit 1;
  if v_slot is null then return null; end if;
  update public.review_sync_provider_slots set locked_by=left(p_worker_token,160),
    lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,60),10),180)),
    updated_at=now() where slot_number=v_slot;
  return v_slot;
end $$;

create table public.review_sync_daily_metrics(
  metric_date date primary key,
  completed_jobs bigint not null default 0,
  dead_jobs bigint not null default 0,
  provider_requests bigint not null default 0,
  reviews_fetched bigint not null default 0,
  reviews_inserted bigint not null default 0,
  duration_seconds_sum numeric not null default 0,
  duration_samples bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.review_sync_daily_metrics enable row level security;
revoke all on public.review_sync_daily_metrics from public,anon,authenticated;
grant all on public.review_sync_daily_metrics to service_role;

create index review_sync_jobs_completed_retention_idx
  on public.review_sync_jobs(finished_at,id) where status='completed';
create index review_sync_jobs_dead_retention_idx
  on public.review_sync_jobs(finished_at,id) where status='dead';

create or replace function public.cleanup_review_sync_jobs(p_batch_size integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_batch integer;
  v_completed_days integer;
  v_dead_days integer;
  v_deleted integer;
begin
  select
    least(coalesce(p_batch_size,maintenance_batch_size),maintenance_batch_size),
    completed_retention_days,dead_retention_days
  into v_batch,v_completed_days,v_dead_days
  from public.review_sync_runtime_config where singleton=true;

  with candidates as (
    select id from public.review_sync_jobs
    where (status='completed' and finished_at<now()-make_interval(days=>v_completed_days))
       or (status='dead' and finished_at<now()-make_interval(days=>v_dead_days))
    order by finished_at,id
    for update skip locked
    limit v_batch
  ), aggregate_rows as (
    select finished_at::date metric_date,
      count(*) filter(where status='completed') completed_jobs,
      count(*) filter(where status='dead') dead_jobs,
      sum(provider_requests) provider_requests,
      sum(reviews_fetched) reviews_fetched,
      sum(reviews_inserted) reviews_inserted,
      sum(extract(epoch from finished_at-started_at))
        filter(where started_at is not null) duration_seconds_sum,
      count(*) filter(where started_at is not null) duration_samples
    from public.review_sync_jobs where id in(select id from candidates)
    group by finished_at::date
  ), metrics as (
    insert into public.review_sync_daily_metrics(
      metric_date,completed_jobs,dead_jobs,provider_requests,reviews_fetched,
      reviews_inserted,duration_seconds_sum,duration_samples)
    select metric_date,completed_jobs,dead_jobs,provider_requests,reviews_fetched,
      reviews_inserted,coalesce(duration_seconds_sum,0),duration_samples
    from aggregate_rows
    on conflict(metric_date) do update set
      completed_jobs=review_sync_daily_metrics.completed_jobs+excluded.completed_jobs,
      dead_jobs=review_sync_daily_metrics.dead_jobs+excluded.dead_jobs,
      provider_requests=review_sync_daily_metrics.provider_requests+excluded.provider_requests,
      reviews_fetched=review_sync_daily_metrics.reviews_fetched+excluded.reviews_fetched,
      reviews_inserted=review_sync_daily_metrics.reviews_inserted+excluded.reviews_inserted,
      duration_seconds_sum=review_sync_daily_metrics.duration_seconds_sum+excluded.duration_seconds_sum,
      duration_samples=review_sync_daily_metrics.duration_samples+excluded.duration_samples,
      updated_at=now()
    returning 1
  ), deleted as (
    delete from public.review_sync_jobs where id in(select id from candidates)
    returning status
  )
  select count(*) into v_deleted from deleted;
  return jsonb_build_object('deleted',v_deleted,'batchLimit',v_batch);
end $$;
revoke all on function public.cleanup_review_sync_jobs(integer) from public,anon,authenticated;
grant execute on function public.cleanup_review_sync_jobs(integer) to service_role;

do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job
    where jobname='home-reviews-sync-retention-v1'
  loop perform cron.unschedule(v_job.jobid); end loop;
end $$;
select cron.schedule(
  'home-reviews-sync-retention-v1','17 * * * *',
  $$select public.cleanup_review_sync_jobs(null);$$
);

create table public.review_sync_load_test_results(
  id bigint generated always as identity primary key,
  tested_at timestamptz not null default now(),
  establishments integer not null,
  scheduler_enqueue_ms numeric not null,
  jobs_created integer not null,
  duplicate_jobs integer not null,
  claim_events integer not null,
  double_claims integer not null,
  lease_recovered boolean not null,
  provider_concurrency_observed integer not null,
  multi_page_jobs integer not null,
  transient_retry_jobs integer not null,
  processing_ms numeric not null,
  mock_jobs_per_minute numeric not null,
  max_backlog integer not null
);
alter table public.review_sync_load_test_results enable row level security;
revoke all on public.review_sync_load_test_results from public,anon,authenticated;
grant all on public.review_sync_load_test_results to service_role;

create or replace function private.run_review_sync_queue_load_test(p_size integer)
returns table(
  establishments integer,scheduler_enqueue_ms numeric,jobs_created integer,
  duplicate_jobs integer,claim_events integer,double_claims integer,
  lease_recovered boolean,provider_concurrency_observed integer,
  multi_page_jobs integer,transient_retry_jobs integer,processing_ms numeric,
  mock_jobs_per_minute numeric,max_backlog integer)
language plpgsql security definer set search_path='' as $$
declare
  v_org uuid;
  v_prefix text:=gen_random_uuid()::text;
  v_started timestamptz;
  v_enqueue_ms numeric:=0;
  v_processing_ms numeric:=0;
  v_created integer:=0;
  v_duplicates integer:=0;
  v_claim_events integer:=0;
  v_double integer:=0;
  v_recovered boolean:=false;
  v_provider integer:=0;
  v_multi integer:=0;
  v_transient integer:=0;
  v_completed integer:=0;
  v_ids_a uuid[];
  v_ids_b uuid[];
  v_ids uuid[];
  v_expired uuid;
  v_slot smallint;
  v_iteration integer:=0;
begin
  if p_size not in(100,1000,10000) then raise exception 'INVALID_LOAD_TEST_SIZE'; end if;
  begin
    select id into v_org from public.organizations order by created_at limit 1;
    if v_org is null then raise exception 'LOAD_TEST_REQUIRES_ORGANIZATION'; end if;
    insert into public.establishments(
      id,organization_id,name,google_id,google_maps_url,next_sync_at,last_sync_at)
    select gen_random_uuid(),v_org,'Load test '||n,v_prefix||':'||n,
      'https://www.google.com/maps/search/?api=1&query=load-test-'||n,
      '2000-01-01'::timestamptz,'1999-12-31'::timestamptz
    from generate_series(1,p_size) n;

    v_started:=clock_timestamp();
    perform public.enqueue_due_review_sync_jobs(p_size);
    v_enqueue_ms:=round((extract(epoch from clock_timestamp()-v_started)*1000)::numeric,3);
    select count(*) into v_created from public.review_sync_jobs j
    join public.establishments e on e.id=j.establishment_id
    where e.google_id like v_prefix||':%';
    v_duplicates:=public.enqueue_due_review_sync_jobs(p_size);
    update public.review_sync_jobs set available_at='2000-01-01',scheduled_for='2000-01-01'
    where establishment_id in(
      select id from public.establishments where google_id like v_prefix||':%');

    select array_agg(c.id) into v_ids_a
    from public.claim_review_sync_jobs('load-a',25,240) c
    join public.establishments e on e.id=c.establishment_id
    where e.google_id like v_prefix||':%';
    select array_agg(c.id) into v_ids_b
    from public.claim_review_sync_jobs('load-b',25,240) c
    join public.establishments e on e.id=c.establishment_id
    where e.google_id like v_prefix||':%';
    select count(*) into v_double
    from unnest(coalesce(v_ids_a,array[]::uuid[])) a
    join unnest(coalesce(v_ids_b,array[]::uuid[])) b on a=b;
    v_expired:=v_ids_a[1];
    update public.review_sync_jobs set lease_until=now()-interval '1 second'
    where id=v_expired;
    select array_agg(c.id) into v_ids
    from public.claim_review_sync_jobs('load-recovery',1,240) c
    join public.establishments e on e.id=c.establishment_id
    where e.google_id like v_prefix||':%';
    v_recovered:=coalesce(v_ids[1]=v_expired,false);

    update public.review_sync_jobs set status='queued',locked_by=null,lease_until=null,
      available_at='2000-01-01',claim_count=0,attempts=0
    where establishment_id in(
      select id from public.establishments where google_id like v_prefix||':%');

    loop
      v_slot:=public.claim_review_provider_slot('load-slot:'||v_provider,60);
      exit when v_slot is null;
      v_provider:=v_provider+1;
    end loop;
    perform public.release_review_provider_slot(slot_number,'load-slot:'||(slot_number-1),0)
    from public.review_sync_provider_slots
    where slot_number<=v_provider;

    v_started:=clock_timestamp();
    loop
      v_iteration:=v_iteration+1;
      select count(*) into v_completed from public.review_sync_jobs j
      join public.establishments e on e.id=j.establishment_id
      where e.google_id like v_prefix||':%' and j.status='completed';
      select array_agg(c.id) into v_ids
      from public.claim_review_sync_jobs(
        'load-process:'||v_iteration,least(25,p_size-v_completed),240) c
      join public.establishments e on e.id=c.establishment_id
      where e.google_id like v_prefix||':%';
      exit when coalesce(cardinality(v_ids),0)=0;
      v_claim_events:=v_claim_events+cardinality(v_ids);
      update public.review_sync_jobs j set
        status=case
          when j.claim_count=1 and mod(abs(hashtext(j.establishment_id::text)::bigint),10)=0
            then 'queued'
          when j.claim_count=1 and mod(abs(hashtext(j.establishment_id::text)::bigint),20)=1
            then 'retry'
          else 'completed' end,
        attempts=case
          when j.claim_count=1 and mod(abs(hashtext(j.establishment_id::text)::bigint),20)=1
            then 1 else j.attempts end,
        available_at='2000-01-01',locked_by=null,lease_until=null,
        finished_at=case
          when not(
            j.claim_count=1 and (
              mod(abs(hashtext(j.establishment_id::text)::bigint),10)=0
              or mod(abs(hashtext(j.establishment_id::text)::bigint),20)=1))
          then now() else null end
      where j.id=any(v_ids);
      select count(*) into v_completed from public.review_sync_jobs j
      join public.establishments e on e.id=j.establishment_id
      where e.google_id like v_prefix||':%' and j.status='completed';
      exit when v_completed=p_size;
    end loop;
    v_processing_ms:=round((extract(epoch from clock_timestamp()-v_started)*1000)::numeric,3);
    select count(*) into v_completed from public.review_sync_jobs j
      join public.establishments e on e.id=j.establishment_id
      where e.google_id like v_prefix||':%' and j.status='completed';
    select count(*) into v_multi from public.review_sync_jobs j
      join public.establishments e on e.id=j.establishment_id
      where e.google_id like v_prefix||':%' and j.claim_count>1
        and mod(abs(hashtext(j.establishment_id::text)::bigint),10)=0;
    select count(*) into v_transient from public.review_sync_jobs j
      join public.establishments e on e.id=j.establishment_id
      where e.google_id like v_prefix||':%' and j.claim_count>1 and j.attempts=1;
    raise exception 'ROLLBACK_SYNTHETIC_LOAD_TEST';
  exception when raise_exception then
    if sqlerrm<>'ROLLBACK_SYNTHETIC_LOAD_TEST' then raise; end if;
  end;
  return query select p_size,v_enqueue_ms,v_created,v_duplicates,v_claim_events,
    v_double,v_recovered,v_provider,v_multi,v_transient,v_processing_ms,
    round((v_claim_events*60000/nullif(v_processing_ms,0))::numeric,2),v_created;
end $$;
revoke all on function private.run_review_sync_queue_load_test(integer)
  from public,anon,authenticated;
grant execute on function private.run_review_sync_queue_load_test(integer) to service_role;

insert into public.review_sync_load_test_results(
  establishments,scheduler_enqueue_ms,jobs_created,duplicate_jobs,claim_events,
  double_claims,lease_recovered,provider_concurrency_observed,multi_page_jobs,
  transient_retry_jobs,processing_ms,mock_jobs_per_minute,max_backlog)
select * from private.run_review_sync_queue_load_test(100)
union all select * from private.run_review_sync_queue_load_test(1000)
union all select * from private.run_review_sync_queue_load_test(10000);
