-- Future jobs only: this migration neither enqueues nor resumes any import.
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.initial_import_jobs in access exclusive mode;
do $$begin
 if exists(select 1 from public.initial_import_jobs where status='running' and lease_until>clock_timestamp()) then raise exception 'INITIAL_IMPORT_DEPLOYMENT_BUSY';end if;
end $$;
alter table public.initial_import_jobs
 add column worker_started_at timestamptz,
 add column provider_start_attempted_at timestamptz,
 add column provider_started_at timestamptz,
 add column provider_run_saved_at timestamptz,
 add column provider_finished_at timestamptz,
 add column provider_finished_observed_at timestamptz,
 add column provider_status text,
 add column retrieval_started_at timestamptz,
 add column retrieval_completed_at timestamptz,
 add column persistence_started_at timestamptz,
 add column persistence_completed_at timestamptz,
 add column phase_events jsonb not null default '[]',
 add column provider_attempt_history jsonb not null default '[]',
 add column resolution_diagnostic_id uuid,
 add column wake_requested_at timestamptz,
 add column wake_request_id bigint,
 add column wake_count integer not null default 0,
 add column wake_error text;

create function private.dispatch_initial_import(p_job uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs;rid bigint;begin
 if exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) then return null;end if;
 select * into j from public.initial_import_jobs where id=p_job for update;
 if not found or j.status not in('queued','retry') or j.available_at>clock_timestamp()+interval '5 seconds'
  or j.provider_start_attempted_at is not null and j.provider_run_id is null then return null;end if;
 if j.wake_requested_at>clock_timestamp()-interval '1 second' then return j.wake_request_id;end if;
 begin
  select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-initial-import-jobs',
   headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
    (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
   body:=jsonb_build_object('ready_at',j.available_at),timeout_milliseconds:=180000) into rid;
  update public.initial_import_jobs set wake_requested_at=clock_timestamp(),wake_request_id=rid,wake_count=wake_count+1,wake_error=null where id=p_job;
 exception when others then
  update public.initial_import_jobs set wake_error='INITIAL_IMPORT_WAKE_FAILED_CRON_RECOVERY' where id=p_job;
  raise warning 'INITIAL_IMPORT_WAKE_FAILED_CRON_RECOVERY';
 end;
 return rid;
end $$;
create function private.initial_import_ready_wake() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform private.dispatch_initial_import(new.id);return new;end $$;
revoke all on function private.dispatch_initial_import(uuid),private.initial_import_ready_wake() from public,anon,authenticated,service_role;
create trigger initial_import_insert_wake after insert on public.initial_import_jobs for each row
 when(new.status='queued') execute function private.initial_import_ready_wake();
create trigger initial_import_continue_wake after update of status,available_at on public.initial_import_jobs for each row
 when(new.status in('queued','retry') and (new.status is distinct from old.status or new.available_at is distinct from old.available_at))
 execute function private.initial_import_ready_wake();

create function public.wake_initial_import_queue(p_job uuid) returns bigint language plpgsql security definer set search_path='' as $$
begin return private.dispatch_initial_import(p_job);end $$;
revoke all on function public.wake_initial_import_queue(uuid) from public,anon,authenticated;
grant execute on function public.wake_initial_import_queue(uuid) to service_role;

-- Serializing claims makes immediate wakes obey the existing worker budget
-- globally, even if the cron and several immediate invocations overlap.
create function public.claim_initial_import_jobs(p_worker_id text,p_limit integer,p_lease_seconds integer,p_max_running integer)
returns setof public.initial_import_jobs language plpgsql security definer set search_path='' as $$
declare capacity integer;active_n integer;begin
 if exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('initial-import-claims-v1',0));
 update public.initial_import_jobs set status='failed',error_code='APIFY_START_OUTCOME_UNKNOWN',locked_by=null,lease_until=null,finished_at=clock_timestamp()
  where status='running' and lease_until<clock_timestamp() and provider_start_attempted_at is not null and provider_run_id is null;
 select least(greatest(coalesce(p_max_running,2),1),provider_slot_count) into capacity from public.review_sync_runtime_config where singleton;
 select count(*) into active_n from public.initial_import_jobs where status='running' and lease_until>clock_timestamp();
 capacity=greatest(coalesce(capacity,0)-active_n,0);
 return query with candidates as (
  select id from public.initial_import_jobs where ((status in('queued','retry') and available_at<=clock_timestamp()) or (status='running' and lease_until<clock_timestamp()))
   and not(provider_start_attempted_at is not null and provider_run_id is null)
  order by available_at,created_at,id for update skip locked limit least(greatest(coalesce(p_limit,5),1),25,capacity)
 ) update public.initial_import_jobs j set status='running',locked_by=left(p_worker_id,120),
  lease_until=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
  started_at=coalesce(j.started_at,clock_timestamp()),finished_at=null,updated_at=clock_timestamp()
 from candidates c where j.id=c.id returning j.*;
end $$;
revoke all on function public.claim_initial_import_jobs(text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_initial_import_jobs(text,integer,integer,integer) to service_role;
create or replace function public.claim_initial_import_jobs(p_worker_id text,p_limit integer default 5,p_lease_seconds integer default 240)
returns setof public.initial_import_jobs language sql security definer set search_path='' as $$
 -- Retire older workers that cannot reserve a paid start durably. The current
 -- worker (including the cron fallback) supplies its actual fourth budget arg.
 select * from public.initial_import_jobs where false
$$;

create function public.mark_initial_import_phase(p_job uuid,p_worker text,p_phase text,p_provider_at timestamptz default null,p_status text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs;t timestamptz=clock_timestamp();begin
 if p_phase not in('worker_started','provider_start','provider_started','provider_finished','retrieval_started','retrieval_completed','persistence_started','persistence_completed') then raise exception 'INITIAL_IMPORT_PHASE_INVALID';end if;
 select * into j from public.initial_import_jobs where id=p_job and status='running' and locked_by=left(p_worker,120) and lease_until>t for update;
 if not found then return false;end if;
 if p_phase='provider_start' and (j.provider_run_id is not null or j.provider_start_attempted_at is not null) then return false;end if;
 if p_phase='provider_finished' and (j.provider_run_id is null or p_status is null or p_status not in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED')) then raise exception 'INITIAL_IMPORT_TERMINAL_RUN_REQUIRED';end if;
 update public.initial_import_jobs set
  worker_started_at=case when p_phase='worker_started' then coalesce(worker_started_at,t) else worker_started_at end,
  provider_start_attempted_at=case when p_phase='provider_start' then t else provider_start_attempted_at end,
  provider_started_at=case when p_phase='provider_started' then coalesce(provider_started_at,p_provider_at) else provider_started_at end,
  provider_requests=provider_requests+case when p_phase='provider_start' then 1 else 0 end,
  provider_finished_at=case when p_phase='provider_finished' then coalesce(provider_finished_at,p_provider_at) else provider_finished_at end,
  provider_finished_observed_at=case when p_phase='provider_finished' then coalesce(provider_finished_observed_at,t) else provider_finished_observed_at end,
  provider_status=case when p_phase='provider_finished' then p_status else provider_status end,
  retrieval_started_at=case when p_phase='retrieval_started' then coalesce(retrieval_started_at,t) else retrieval_started_at end,
  retrieval_completed_at=case when p_phase='retrieval_completed' then t else retrieval_completed_at end,
  persistence_started_at=case when p_phase='persistence_started' then coalesce(persistence_started_at,t) else persistence_started_at end,
  persistence_completed_at=case when p_phase='persistence_completed' then t else persistence_completed_at end,
  phase_events=(select coalesce(jsonb_agg(value order by ord),'[]') from (select value,ordinality ord from jsonb_array_elements(j.phase_events||jsonb_build_array(jsonb_build_object('phase',p_phase,'at',t,'worker',left(p_worker,120)))) with ordinality order by ordinality desc limit 100)e),
  updated_at=t where id=p_job;
 return true;
end $$;
revoke all on function public.mark_initial_import_phase(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.mark_initial_import_phase(uuid,text,text,timestamptz,text) to service_role;

create or replace function public.continue_initial_import_job(p_job_id uuid,p_worker_id text,p_delay_seconds integer default 0)
returns boolean language sql security definer set search_path='' as $$
 with u as(update public.initial_import_jobs set status='queued',available_at=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(p_delay_seconds,0),0),300)),lease_until=null,locked_by=null,error_code=null,updated_at=clock_timestamp()
  where id=p_job_id and status='running' and locked_by=left(p_worker_id,120) and lease_until>clock_timestamp()
   and not(provider_start_attempted_at is not null and provider_run_id is null) returning 1)
 select exists(select 1 from u)
$$;

-- A successful checkpoint never changes an already attached provider identity.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.checkpoint_initial_import_job(uuid,text,text,text,uuid,integer,integer,integer,integer,text)'::regprocedure);
 a='provider_run_id=coalesce(p_provider_run_id,provider_run_id),';
 if position(a in d)=0 then raise exception 'INITIAL_CHECKPOINT_CHANGED';end if;
 d=replace(d,a,a||E'\n      provider_run_saved_at=case when p_provider_run_id is not null then coalesce(provider_run_saved_at,clock_timestamp()) else provider_run_saved_at end,');
 d=replace(d,'and status=''running''','and status=''running'' and (provider_run_id is null or p_provider_run_id is null or provider_run_id=p_provider_run_id) and (provider_dataset_id is null or p_provider_dataset_id is null or provider_dataset_id=p_provider_dataset_id)');execute d;
 d=pg_get_functiondef('public.finalize_initial_import_job(uuid,text,uuid,text,timestamptz,timestamptz,jsonb)'::regprocedure);
 d=replace(d,'v_now timestamptz:=now()','v_now timestamptz:=clock_timestamp()');execute d;
 d=pg_get_functiondef('public.enqueue_initial_import_job(uuid,uuid,text,text,text,jsonb)'::regprocedure);
 d=replace(d,'preferred_language,candidate_snapshot','preferred_language,candidate_snapshot,resolution_diagnostic_id');
 d=replace(d,$old$coalesce(p_candidate_snapshot,'{}'::jsonb)$old$,$new$coalesce(p_candidate_snapshot,'{}'::jsonb),case when p_candidate_snapshot->>'resolutionDiagnosticId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (p_candidate_snapshot->>'resolutionDiagnosticId')::uuid end$new$);execute d;
 -- No automatic new paid run on a terminal failure; manual retry may explicitly
 -- start a new run only after a native terminal result was actually observed.
 d=pg_get_functiondef('public.fail_initial_import_job(uuid,text,text,boolean,integer,integer,boolean)'::regprocedure);
 d=replace(d,'v_status:=case when p_retryable','v_status:=case when p_retryable and not p_reset_provider and not exists(select 1 from public.initial_import_jobs where id=p_job_id and provider_start_attempted_at is not null and provider_run_id is null)');
 d=replace(d,'provider_run_id=case when p_reset_provider then null else provider_run_id end,','provider_run_id=provider_run_id,');
 d=replace(d,'provider_dataset_id=case when p_reset_provider then null else provider_dataset_id end,','provider_dataset_id=provider_dataset_id,');
 d=replace(d,$old$error_code=left(coalesce(p_error_code,'INITIAL_IMPORT_FAILED'),200)$old$,$new$error_code=case when provider_start_attempted_at is not null and provider_run_id is null then 'APIFY_START_OUTCOME_UNKNOWN' else left(coalesce(p_error_code,'INITIAL_IMPORT_FAILED'),200) end$new$);execute d;
end $$;

create or replace function public.retry_initial_import_job(p_job_id uuid)
returns public.initial_import_jobs language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs;begin
 select * into j from public.initial_import_jobs where id=p_job_id and user_id=(select auth.uid()) and status='failed' and (select private.is_org_member(organization_id)) for update;
 if not found then raise exception 'IMPORT_JOB_NOT_RETRYABLE';end if;
 if j.provider_start_attempted_at is not null and j.provider_run_id is null then raise exception 'APIFY_START_OUTCOME_UNKNOWN';end if;
 -- Known running/unknown-status runs keep their ID and are only read again.
 update public.initial_import_jobs set status='queued',attempts=0,available_at=clock_timestamp(),lease_until=null,locked_by=null,error_code=null,finished_at=null,acknowledged_at=null,
  provider_attempt_history=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then j.provider_attempt_history||jsonb_build_array(jsonb_build_object('run_id',j.provider_run_id,'dataset_id',j.provider_dataset_id,'status',j.provider_status,'start',j.provider_start_attempted_at,'finished',j.provider_finished_at)) else j.provider_attempt_history end,
  provider_run_id=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_run_id end,
  provider_dataset_id=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_dataset_id end,
  provider_start_attempted_at=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_start_attempted_at end,
  provider_run_saved_at=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_run_saved_at end,
  provider_started_at=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_started_at end,
  provider_finished_at=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_finished_at end,
  provider_finished_observed_at=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_finished_observed_at end,
  provider_status=case when j.provider_status in('FAILED','TIMED-OUT','ABORTED') then null else j.provider_status end,updated_at=clock_timestamp()
 where id=p_job_id returning * into j;return j;
end $$;

-- Free capacity immediately wakes another queued job; no backfill/dispatch at deployment.
create function private.initial_import_release_wake() returns trigger language plpgsql security definer set search_path='' as $$
declare next_id uuid;begin
 select id into next_id from public.initial_import_jobs where status in('queued','retry') and available_at<=clock_timestamp() and not(provider_start_attempted_at is not null and provider_run_id is null) order by available_at,created_at,id limit 1;
 if next_id is not null then perform private.dispatch_initial_import(next_id);end if;return new;
end $$;
revoke all on function private.initial_import_release_wake() from public,anon,authenticated,service_role;
create trigger initial_import_release_wake after update of status on public.initial_import_jobs for each row
 when(old.status='running' and new.status in('completed','failed')) execute function private.initial_import_release_wake();
