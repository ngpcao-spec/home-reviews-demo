begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.establishments, public.initial_import_jobs, public.review_sync_jobs in access exclusive mode nowait;
do $$begin
  if exists(select 1 from public.initial_import_jobs where status in ('queued','running','retry'))
    or exists(select 1 from public.review_sync_jobs where status in ('queued','running','retry')) then
    raise exception 'REVIEW_COLLECTION_DEPLOYMENT_BUSY';
  end if;
end$$;

alter table public.establishments
  add column review_collection_status text not null default 'unknown'
    check (review_collection_status in ('unknown','complete','partial','retrying')),
  add column review_collection_expected integer check (review_collection_expected between 0 and 150),
  add column review_collection_unique integer check (review_collection_unique between 0 and 150),
  add column review_collection_checked_at timestamptz;

-- Missing/coerced zero, fractional, inconsistent and out-of-range totals are not evidence.
create function private.initial_review_collection_coverage(p_google_total jsonb,p_unique integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_total bigint; v_expected integer;
begin
  if p_unique is null or p_unique < 0 or p_unique > 150 then raise exception 'INVALID_COLLECTION_UNIQUE_COUNT'; end if;
  if jsonb_typeof(p_google_total) in ('number','string') and p_google_total #>> '{}' ~ '^[0-9]{1,15}$' then
    v_total := (p_google_total #>> '{}')::bigint;
    if v_total < p_unique then v_total := null; end if;
  end if;
  if v_total is not null then v_expected := least(150,v_total)::integer;
  elsif p_unique=150 then v_expected:=150;
  end if;
  return jsonb_build_object('status',case when v_expected is null then 'unknown'
    when p_unique < v_expected then 'partial' else 'complete' end,
    'uniqueCount',p_unique,'expectedCount',v_expected,'googleTotal',v_total);
end$$;
revoke all on function private.initial_review_collection_coverage(jsonb,integer) from public,anon,authenticated;
grant execute on function private.initial_review_collection_coverage(jsonb,integer) to service_role;

create or replace function public.finalize_initial_import_job(
  p_job_id uuid,p_worker_id text,p_establishment_id uuid,p_last_review_id text,
  p_last_review_at timestamptz,p_reporting_started_at timestamptz,p_result jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_job public.initial_import_jobs%rowtype; v_interval integer; v_now timestamptz:=clock_timestamp();
  v_total jsonb; v_coverage jsonb; v_partial boolean;
begin
  select * into v_job from public.initial_import_jobs where id=p_job_id and status='running'
    and locked_by=left(p_worker_id,120) and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  -- Capture the native scalar before retention removes the raw snapshot payload.
  v_total:=p_result->'reportedGoogleTotal';
  if v_total is null or v_total='null'::jsonb then
    -- Older workers used ':direct' when a run finished during their first wake.
    -- Only accept their frozen numeric summary if the independent resolution agrees.
    select to_jsonb(s.total_reviews) into v_total from public.establishment_snapshots s
    where s.establishment_id=p_establishment_id and s.total_reviews>0
      and v_job.candidate_snapshot->>'reviewCount'=s.total_reviews::text
      and s.source_run_id in ('initial-job:'||v_job.id::text||':'||coalesce(v_job.provider_run_id,'direct'),
        'initial-job:'||v_job.id::text||':direct')
      and s.captured_at>=v_job.provider_start_attempted_at
    order by s.captured_at desc limit 1;
  end if;
  v_coverage:=private.initial_review_collection_coverage(v_total,v_job.reviews_fetched);
  v_partial:=v_coverage->>'status'='partial';
  select monitoring_interval_hours into v_interval from public.organizations where id=v_job.organization_id;
  update public.establishments set active=true,initialized_at=coalesce(initialized_at,v_now),
    last_review_id=p_last_review_id,last_review_at=p_last_review_at,reporting_started_at=p_reporting_started_at,
    last_sync_at=v_now,next_sync_at=case when v_partial then null else
      v_now+make_interval(hours=>v_interval)+public.review_sync_spread_offset(id,v_interval) end,
    review_collection_status=v_coverage->>'status',review_collection_expected=(v_coverage->>'expectedCount')::integer,
    review_collection_unique=(v_coverage->>'uniqueCount')::integer,review_collection_checked_at=v_now,
    sync_status=case when v_partial then 'error' else 'ok' end,
    sync_error=case when v_partial then 'IMPORT_COLLECTION_PARTIAL' end,
    last_sync_status=case when v_partial then 'error' else 'ok' end,
    last_sync_error=case when v_partial then 'IMPORT_COLLECTION_PARTIAL' end,updated_at=v_now
  where id=p_establishment_id and organization_id=v_job.organization_id and initial_import_job_id=p_job_id;
  if not found then raise exception 'INITIAL_IMPORT_ESTABLISHMENT_MISSING'; end if;
  update public.initial_import_jobs set establishment_id=p_establishment_id,status='completed',
    result=coalesce(p_result,'{}'::jsonb)||jsonb_build_object('collection',v_coverage,
      'importStatus',case when v_partial then 'partial' else 'completed' end),
    error_code=case when v_partial then 'IMPORT_COLLECTION_PARTIAL' end,
    lease_until=null,locked_by=null,finished_at=v_now,updated_at=v_now where id=p_job_id;
  return true;
end$$;

-- Technical completion must not send a successful-import notice for partial data.
revoke all on function public.finalize_initial_import_job(uuid,text,uuid,text,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_initial_import_job(uuid,text,uuid,text,timestamptz,timestamptz,jsonb) to service_role;

drop trigger initial_import_completion_notification on public.initial_import_jobs;
create trigger initial_import_completion_notification after update of status on public.initial_import_jobs
for each row when (new.status='completed' and old.status is distinct from 'completed'
  and new.result->'collection'->>'status' is distinct from 'partial')
execute function private.notify_initial_import_completed();

-- The scheduler already locks due restaurant rows. Share that lock before deciding
-- whether an explicit retry is safe; null next_sync_at prevents automatic collection.
create or replace function public.retry_initial_import_job(p_job_id uuid)
returns public.initial_import_jobs language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs%rowtype; e public.establishments%rowtype;
  v_partial boolean; v_new_run boolean;
begin
  select q.* into j from public.initial_import_jobs q where q.id=p_job_id and q.user_id=(select auth.uid())
    and exists(select 1 from public.organization_members m where m.organization_id=q.organization_id
      and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager'));
  if not found then raise exception 'IMPORT_JOB_NOT_RETRYABLE'; end if;
  if j.establishment_id is not null then
    select * into e from public.establishments where id=j.establishment_id and organization_id=j.organization_id for update;
    if not found or e.initial_import_job_id is distinct from j.id then raise exception 'IMPORT_JOB_NOT_RETRYABLE'; end if;
    if exists(select 1 from public.review_sync_jobs s where s.establishment_id=e.id
      and (s.status in ('queued','running','retry') or
        ((s.provider_start_attempted_at is not null or s.apify_run_id is not null) and s.status<>'completed'
          and (s.apify_run_id is null or coalesce(s.error_code,'') not in ('APIFY_RUN_FAILED','APIFY_RUN_TIMED-OUT','APIFY_RUN_ABORTED'))))) then
      raise exception 'REVIEW_COLLECTION_BUSY';
    end if;
    if exists(select 1 from public.initial_import_jobs q where q.organization_id=j.organization_id
      and q.expected_google_id=j.expected_google_id and q.id<>j.id and q.status in ('queued','running','retry')) then
      raise exception 'REVIEW_COLLECTION_BUSY';
    end if;
  end if;
  select * into j from public.initial_import_jobs where id=p_job_id for update;
  -- Repeated clicks/requests join the same queued attempt, without another wake/reset.
  if j.status in ('queued','running','retry') then return j; end if;
  v_partial:=coalesce(j.status='completed' and j.result->'collection'->>'status'='partial',false);
  if not v_partial and j.status<>'failed' then raise exception 'IMPORT_JOB_NOT_RETRYABLE'; end if;
  if j.provider_start_attempted_at is not null and j.provider_run_id is null then raise exception 'APIFY_START_OUTCOME_UNKNOWN'; end if;
  if v_partial and (j.provider_status is distinct from 'SUCCEEDED' or j.provider_run_id is null
    or j.provider_dataset_id is null or j.provider_finished_observed_at is null) then
    raise exception 'IMPORT_RESULT_NOT_CONFIRMED';
  end if;
  v_new_run:=v_partial or coalesce(j.provider_status in ('FAILED','TIMED-OUT','ABORTED'),false);
  if j.establishment_id is not null then
    update public.establishments set review_collection_status=case when review_collection_status='partial' then 'retrying' else review_collection_status end,
      next_sync_at=null,sync_status='pending',sync_error=null,updated_at=clock_timestamp() where id=j.establishment_id;
  end if;
  update public.initial_import_jobs set status='queued',attempts=0,available_at=clock_timestamp(),lease_until=null,locked_by=null,
    error_code=null,finished_at=null,acknowledged_at=null,
    provider_attempt_history=case when v_new_run then j.provider_attempt_history||jsonb_build_array(jsonb_build_object(
      'run_id',j.provider_run_id,'dataset_id',j.provider_dataset_id,'status',j.provider_status,
      'start',j.provider_start_attempted_at,'finished',j.provider_finished_at,'observed_finished',j.provider_finished_observed_at,
      'reviews_fetched',j.reviews_fetched,'reviews_inserted',j.reviews_inserted,'provider_requests',j.provider_requests,'reviews_target',j.reviews_target,
      'result',j.result,'phase_events',j.phase_events)) else j.provider_attempt_history end,
    provider_run_id=case when v_new_run then null else j.provider_run_id end,
    provider_dataset_id=case when v_new_run then null else j.provider_dataset_id end,
    provider_start_attempted_at=case when v_new_run then null else j.provider_start_attempted_at end,
    provider_run_saved_at=case when v_new_run then null else j.provider_run_saved_at end,
    provider_started_at=case when v_new_run then null else j.provider_started_at end,
    provider_finished_at=case when v_new_run then null else j.provider_finished_at end,
    provider_finished_observed_at=case when v_new_run then null else j.provider_finished_observed_at end,
    provider_status=case when v_new_run then null else j.provider_status end,
    reviews_target=case when v_new_run then 150 else j.reviews_target end,
    reviews_fetched=case when v_new_run then 0 else j.reviews_fetched end,
    reviews_inserted=case when v_new_run then 0 else j.reviews_inserted end,
    provider_requests=case when v_new_run then 0 else j.provider_requests end,
    retrieval_started_at=case when v_new_run then null else j.retrieval_started_at end,
    retrieval_completed_at=case when v_new_run then null else j.retrieval_completed_at end,
    persistence_started_at=case when v_new_run then null else j.persistence_started_at end,
    persistence_completed_at=case when v_new_run then null else j.persistence_completed_at end,
    worker_started_at=case when v_new_run then null else j.worker_started_at end,
    started_at=case when v_new_run then null else j.started_at end,
    phase_events=case when v_new_run then '[]'::jsonb else j.phase_events end,
    result=case when v_new_run then null else j.result end,updated_at=clock_timestamp()
  where id=p_job_id returning * into j;
  return j;
end$$;
revoke all on function public.retry_initial_import_job(uuid) from public,anon;
grant execute on function public.retry_initial_import_job(uuid) to authenticated;

create function private.guard_sync_during_initial_collection() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;
begin
  if new.status not in ('queued','running','retry') then return new; end if;
  select * into e from public.establishments where id=new.establishment_id for update;
  if e.review_collection_status in ('partial','retrying') or exists(select 1 from public.initial_import_jobs j
    where j.organization_id=e.organization_id and j.expected_google_id=e.google_id and j.status in ('queued','running','retry')) then
    return null;
  end if;
  return new;
end$$;
revoke all on function private.guard_sync_during_initial_collection() from public,anon,authenticated;
create trigger review_sync_initial_collection_guard before insert or update of status on public.review_sync_jobs
for each row execute function private.guard_sync_during_initial_collection();

create function private.restore_partial_collection_alert() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.establishments set review_collection_status='partial',next_sync_at=null
    where id=new.establishment_id and initial_import_job_id=new.id and review_collection_status='retrying';
  return new;
end$$;
revoke all on function private.restore_partial_collection_alert() from public,anon,authenticated;
create trigger initial_import_failed_collection_alert after update of status on public.initial_import_jobs
for each row when (new.status='failed') execute function private.restore_partial_collection_alert();

-- Reconstruct coverage only from the exact saved run and its unique fetched count.
-- No jobs are queued, resumed or dispatched by this migration.
with coverage as (
  select distinct on (j.id) j.id,private.initial_review_collection_coverage(
    case when s.total_reviews>0 and j.candidate_snapshot->>'reviewCount'=s.total_reviews::text then to_jsonb(s.total_reviews) end,
    j.reviews_fetched) c
  from public.initial_import_jobs j join public.establishments e on e.initial_import_job_id=j.id and e.id=j.establishment_id
  join public.establishment_snapshots s on s.establishment_id=e.id
    and s.source_run_id in ('initial-job:'||j.id::text||':'||j.provider_run_id,'initial-job:'||j.id::text||':direct')
    and s.captured_at>=j.provider_start_attempted_at and s.captured_at<=j.finished_at+interval '5 seconds'
  where j.status='completed' and j.provider_status='SUCCEEDED'
  order by j.id,s.captured_at desc
), saved as (
  update public.initial_import_jobs j set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('collection',c,
    'importStatus',case when c->>'status'='partial' then 'partial' else 'completed' end),
    error_code=case when c->>'status'='partial' then 'IMPORT_COLLECTION_PARTIAL' else error_code end
  from coverage where j.id=coverage.id returning j.id,j.establishment_id,coverage.c
)
update public.establishments e set review_collection_status=c->>'status',
  review_collection_expected=(c->>'expectedCount')::integer,review_collection_unique=(c->>'uniqueCount')::integer,
  review_collection_checked_at=clock_timestamp(),
  next_sync_at=case when c->>'status'='partial' then null else next_sync_at end,
  sync_status=case when c->>'status'='partial' then 'error' else sync_status end,
  sync_error=case when c->>'status'='partial' then 'IMPORT_COLLECTION_PARTIAL' else sync_error end
from saved where e.id=saved.establishment_id and e.initial_import_job_id=saved.id;
commit;
