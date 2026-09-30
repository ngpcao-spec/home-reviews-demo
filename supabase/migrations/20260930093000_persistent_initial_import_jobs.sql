create table public.initial_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null check (char_length(query) between 2 and 500),
  expected_google_id text not null check (char_length(expected_google_id) >= 2),
  establishment_id uuid references public.establishments(id) on delete set null,
  preferred_language text not null default 'fr' check (preferred_language in ('fr','vi')),
  candidate_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','retry','completed','failed')),
  reviews_target integer not null default 500 check (reviews_target between 1 and 500),
  reviews_fetched integer not null default 0 check (reviews_fetched >= 0),
  reviews_inserted integer not null default 0 check (reviews_inserted >= 0),
  provider_requests integer not null default 0 check (provider_requests >= 0),
  provider_run_id text,
  provider_dataset_id text,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  locked_by text,
  error_code text,
  result jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index initial_import_jobs_one_active_place
  on public.initial_import_jobs(organization_id,expected_google_id)
  where status in ('queued','running','retry');
create index initial_import_jobs_claim_idx
  on public.initial_import_jobs(available_at,created_at,id)
  where status in ('queued','retry');
create index initial_import_jobs_expired_lease_idx
  on public.initial_import_jobs(lease_until,id) where status='running';
create index initial_import_jobs_user_state_idx
  on public.initial_import_jobs(user_id,acknowledged_at,created_at desc);

alter table public.initial_import_jobs enable row level security;
revoke all on public.initial_import_jobs from public,anon,authenticated;
grant select on public.initial_import_jobs to authenticated;
grant all on public.initial_import_jobs to service_role;
create policy initial_import_jobs_select on public.initial_import_jobs
  for select to authenticated
  using (user_id=(select auth.uid())
    and (select private.is_org_member(organization_id)));

alter table public.establishments
  add column if not exists initial_import_job_id uuid;
create unique index if not exists establishments_initial_import_job_key
  on public.establishments(initial_import_job_id)
  where initial_import_job_id is not null;

create function public.enqueue_initial_import_job(
  p_organization_id uuid,
  p_user_id uuid,
  p_query text,
  p_expected_google_id text,
  p_preferred_language text,
  p_candidate_snapshot jsonb default '{}'::jsonb
) returns public.initial_import_jobs
language plpgsql security definer set search_path='' as $$
declare v_job public.initial_import_jobs%rowtype;
begin
  if not exists(
    select 1 from public.organization_members
    where organization_id=p_organization_id and user_id=p_user_id
      and role in ('owner','admin','manager')
  ) then raise exception 'FORBIDDEN'; end if;
  if exists(
    select 1 from public.establishments
    where organization_id=p_organization_id and google_id=p_expected_google_id
  ) then raise exception 'ESTABLISHMENT_ALREADY_ADDED'; end if;

  select * into v_job from public.initial_import_jobs
  where organization_id=p_organization_id
    and expected_google_id=p_expected_google_id
    and status in ('queued','running','retry')
  order by created_at desc limit 1 for update;
  if found then return v_job; end if;

  begin
    insert into public.initial_import_jobs(
      organization_id,user_id,query,expected_google_id,preferred_language,candidate_snapshot
    ) values(
      p_organization_id,p_user_id,left(trim(p_query),500),left(trim(p_expected_google_id),500),
      case when p_preferred_language='vi' then 'vi' else 'fr' end,
      coalesce(p_candidate_snapshot,'{}'::jsonb)
    ) returning * into v_job;
  exception when unique_violation then
    select * into v_job from public.initial_import_jobs
    where organization_id=p_organization_id
      and expected_google_id=p_expected_google_id
      and status in ('queued','running','retry')
    order by created_at desc limit 1;
  end;
  return v_job;
end $$;
revoke all on function public.enqueue_initial_import_job(uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.enqueue_initial_import_job(uuid,uuid,text,text,text,jsonb)
  to service_role;

create function public.claim_initial_import_jobs(
  p_worker_id text,p_limit integer default 5,p_lease_seconds integer default 240
) returns setof public.initial_import_jobs
language sql security definer set search_path='' as $$
  with candidates as (
    select id from public.initial_import_jobs
    where (status in ('queued','retry') and available_at<=now())
       or (status='running' and lease_until<now())
    order by available_at,created_at,id
    for update skip locked
    limit least(greatest(coalesce(p_limit,5),1),25)
  )
  update public.initial_import_jobs j set
    status='running',locked_by=left(p_worker_id,120),
    lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
    started_at=coalesce(j.started_at,now()),finished_at=null,updated_at=now()
  from candidates c where j.id=c.id returning j.*
$$;
revoke all on function public.claim_initial_import_jobs(text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.claim_initial_import_jobs(text,integer,integer)
  to service_role;

create function public.checkpoint_initial_import_job(
  p_job_id uuid,p_worker_id text,
  p_provider_run_id text default null,p_provider_dataset_id text default null,
  p_establishment_id uuid default null,p_reviews_fetched integer default null,
  p_reviews_inserted integer default null,p_provider_requests integer default 0,
  p_lease_seconds integer default 240
) returns boolean
language sql security definer set search_path='' as $$
  with u as (
    update public.initial_import_jobs set
      provider_run_id=coalesce(p_provider_run_id,provider_run_id),
      provider_dataset_id=coalesce(p_provider_dataset_id,provider_dataset_id),
      establishment_id=coalesce(p_establishment_id,establishment_id),
      reviews_fetched=coalesce(p_reviews_fetched,reviews_fetched),
      reviews_inserted=coalesce(p_reviews_inserted,reviews_inserted),
      provider_requests=provider_requests+greatest(coalesce(p_provider_requests,0),0),
      lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
      updated_at=now()
    where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
      and lease_until>now() returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.checkpoint_initial_import_job(uuid,text,text,text,uuid,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.checkpoint_initial_import_job(uuid,text,text,text,uuid,integer,integer,integer,integer)
  to service_role;

create function public.continue_initial_import_job(
  p_job_id uuid,p_worker_id text,p_delay_seconds integer default 5
) returns boolean
language sql security definer set search_path='' as $$
  with u as (
    update public.initial_import_jobs set status='queued',
      available_at=now()+make_interval(secs=>least(greatest(coalesce(p_delay_seconds,5),0),300)),
      lease_until=null,locked_by=null,error_code=null,updated_at=now()
    where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
    returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.continue_initial_import_job(uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.continue_initial_import_job(uuid,text,integer)
  to service_role;

create function public.complete_initial_import_job(
  p_job_id uuid,p_worker_id text,p_result jsonb
) returns boolean
language sql security definer set search_path='' as $$
  with u as (
    update public.initial_import_jobs set status='completed',
      result=coalesce(p_result,'{}'::jsonb),error_code=null,
      lease_until=null,locked_by=null,finished_at=now(),updated_at=now()
    where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
    returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.complete_initial_import_job(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.complete_initial_import_job(uuid,text,jsonb)
  to service_role;

create function public.fail_initial_import_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,
  p_max_attempts integer default 5,p_backoff_seconds integer default 60,
  p_reset_provider boolean default false
) returns text
language plpgsql security definer set search_path='' as $$
declare v_attempts integer; v_status text; v_establishment_id uuid;
begin
  select attempts+1,establishment_id into v_attempts,v_establishment_id
  from public.initial_import_jobs
  where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
  for update;
  if not found then return 'lease_lost'; end if;
  v_status:=case when p_retryable
    and v_attempts<least(greatest(coalesce(p_max_attempts,5),1),20)
    then 'retry' else 'failed' end;
  update public.initial_import_jobs set status=v_status,attempts=v_attempts,
    available_at=case when v_status='retry' then
      now()+make_interval(secs=>least(greatest(coalesce(p_backoff_seconds,60),1),86400))
      else available_at end,
    provider_run_id=case when p_reset_provider then null else provider_run_id end,
    provider_dataset_id=case when p_reset_provider then null else provider_dataset_id end,
    lease_until=null,locked_by=null,
    error_code=left(coalesce(p_error_code,'INITIAL_IMPORT_FAILED'),200),
    finished_at=case when v_status='failed' then now() else null end,updated_at=now()
  where id=p_job_id;
  if v_establishment_id is not null then
    update public.establishments set
      sync_status=case when v_status='failed' then 'error' else 'pending' end,
      sync_error=left(coalesce(p_error_code,'INITIAL_IMPORT_FAILED'),200),
      last_sync_status=case when v_status='failed' then 'error' else 'pending' end,
      last_sync_error=left(coalesce(p_error_code,'INITIAL_IMPORT_FAILED'),200),
      updated_at=now()
    where id=v_establishment_id;
  end if;
  return v_status;
end $$;
revoke all on function public.fail_initial_import_job(uuid,text,text,boolean,integer,integer,boolean)
  from public,anon,authenticated;
grant execute on function public.fail_initial_import_job(uuid,text,text,boolean,integer,integer,boolean)
  to service_role;

create function public.retry_initial_import_job(p_job_id uuid)
returns public.initial_import_jobs
language plpgsql security definer set search_path='' as $$
declare v_job public.initial_import_jobs%rowtype;
begin
  update public.initial_import_jobs set
    status='queued',attempts=0,available_at=now(),lease_until=null,locked_by=null,
    provider_run_id=null,provider_dataset_id=null,error_code=null,finished_at=null,
    acknowledged_at=null,updated_at=now()
  where id=p_job_id and user_id=(select auth.uid()) and status='failed'
    and (select private.is_org_member(organization_id))
  returning * into v_job;
  if not found then raise exception 'IMPORT_JOB_NOT_RETRYABLE'; end if;
  return v_job;
end $$;
revoke all on function public.retry_initial_import_job(uuid) from public,anon;
grant execute on function public.retry_initial_import_job(uuid) to authenticated;

create function public.acknowledge_initial_import_job(p_job_id uuid)
returns boolean
language sql security definer set search_path='' as $$
  with u as (
    update public.initial_import_jobs set acknowledged_at=now(),updated_at=now()
    where id=p_job_id and user_id=(select auth.uid())
      and status in ('completed','failed')
      and (select private.is_org_member(organization_id))
    returning 1
  ) select exists(select 1 from u)
$$;
revoke all on function public.acknowledge_initial_import_job(uuid) from public,anon;
grant execute on function public.acknowledge_initial_import_job(uuid) to authenticated;

do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname='home-reviews-initial-import-worker-v1'
  loop perform cron.unschedule(v_job.jobid); end loop;
end $$;

select cron.schedule('home-reviews-initial-import-worker-v1','* * * * *',$cron$
  select net.http_post(
    url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-initial-import-jobs',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-home-reviews-scheduler',(
        select decrypted_secret from vault.decrypted_secrets
        where name='home_reviews_scheduler_token')),
    body:='{}'::jsonb,timeout_milliseconds:=60000);
$cron$);
