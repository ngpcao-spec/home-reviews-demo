-- Minimal local PostgreSQL schema for the actual queue functions below.
-- Captured definitions: production 2026-10-24, before initial-wake correction.
-- net.http_post writes an in-memory outbox; it cannot make an HTTP request.
create role service_role;
create role authenticated;
create role anon;
create schema net;
create schema vault;
create table public.establishments(id uuid primary key,organization_id uuid,active boolean default true);
create table public.organization_members(organization_id uuid,user_id uuid,role text);
create table public.report_pipeline_settings(id boolean primary key,engine text,jev_transport text);
create table public.historical_report_runs(
 id uuid primary key default gen_random_uuid(),generation_id uuid default gen_random_uuid(),
 organization_id uuid,establishment_id uuid,language text,requested_by uuid,model text,
 status text,snapshot jsonb default '{}',cursor int default 0,attempt_count int default 0,
 created_at timestamptz default now(),started_at timestamptz,completed_at timestamptz,
 locked_by uuid,lease_until timestamptz,next_retry_at timestamptz,
 updated_at timestamptz default now(),lease_recovery_count int default 0,
 token_usage_complete boolean default true,error_code text,last_error text
);
create table public.report_generation_requests(
 id uuid primary key,organization_id uuid,establishment_id uuid,authority_user_id uuid,
 language text,engine text,source_run_id uuid unique references public.historical_report_runs(id),
 comparison_id uuid,jev_transport text,created_at timestamptz default now()
);
create table public.analysis_parallel_reports(id uuid primary key,run_id uuid,organization_id uuid,establishment_id uuid,language text);
create table public.analysis_jls_sol_ready_operations(run_id uuid,request_count int,status text,receipt jsonb);
create table public.analysis_jls_restaurant_runs(id uuid,status text);
create table public.analysis_jev_batch_runs(id uuid primary key,report_id uuid,current_source_run_id uuid,status text);
create table public.analysis_jev_batch_tasks(run_id uuid,status text,request_count int,receipt jsonb);
create table public.test_dispatch(id bigint generated always as identity,url text,body jsonb,timeout_ms int);
create table vault.decrypted_secrets(name text,decrypted_secret text);
insert into vault.decrypted_secrets values('home_reviews_scheduler_token','LOCAL_TEST_VALUE');
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$
declare result bigint;begin
 if current_setting('home_reviews.test_wake_failure',true)='true' then raise exception 'LOCAL_DISPATCH_FAILURE';end if;
 insert into public.test_dispatch(url,body,timeout_ms)values(url,body,timeout_milliseconds)returning id into result;
 return result;
end $$;
grant usage on schema public,net,vault to service_role;
grant all on all tables in schema public,vault to service_role;
grant all on all sequences in schema public to service_role;

CREATE OR REPLACE FUNCTION public.claim_historical_report_jobs(p_worker_id uuid, p_limit integer DEFAULT 2)
 RETURNS SETOF historical_report_runs
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.historical_report_runs; capacity integer; claimed integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('historical-report-global-capacity',0));
  select greatest(0,2-count(*)::integer) into capacity from public.historical_report_runs
    where status in ('queued','running','retry') and lease_until>now();
  capacity:=least(capacity,greatest(0,least(p_limit,2)));
  for r in select * from public.historical_report_runs
    where not exists(select 1 from public.report_generation_requests req where req.source_run_id=historical_report_runs.id and req.engine='jev_sol_v2' and req.comparison_id is not null) and status in ('queued','running','retry') and (lease_until is null or lease_until<=now())
      and (next_retry_at is null or next_retry_at<=now()) order by updated_at,id for update skip locked
  loop
    exit when claimed>=capacity;
    if exists(select 1 from public.historical_report_runs where establishment_id=r.establishment_id and lease_until>now() and status in ('queued','running','retry')) then continue; end if;
    if r.attempt_count>=5 then
      update public.historical_report_runs set status='failed',error_code='REPORT_ATTEMPTS_EXHAUSTED',last_error='REPORT_ATTEMPTS_EXHAUSTED',
        locked_by=null,lease_until=null,updated_at=now() where id=r.id returning * into r;
      return next r;
      continue;
    end if;
    update public.historical_report_runs set status='running',locked_by=p_worker_id,lease_until=now()+interval '240 seconds',
      attempt_count=attempt_count+1,started_at=coalesce(started_at,now()),next_retry_at=null,
      lease_recovery_count=lease_recovery_count+case when r.locked_by is not null then 1 else 0 end,
      last_error=case when r.locked_by is not null then 'REPORT_LEASE_RECOVERED' else last_error end,
      token_usage_complete=case when r.locked_by is not null then false else token_usage_complete end,
      updated_at=now() where id=r.id returning * into r;
    claimed:=claimed+1;
    return next r;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_current_report(p_establishment uuid, p_organization uuid, p_user uuid, p_language text, p_request uuid, p_legacy_model text, p_legacy_version integer)
 RETURNS historical_report_runs
 LANGUAGE plpgsql
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare r public.historical_report_runs;q public.report_generation_requests;e text;jt text;begin
 if current_user<>'service_role' or p_request is null or p_language not in('fr','vi')
 or not exists(select 1 from public.establishments where id=p_establishment and organization_id=p_organization and active)
 or not exists(select 1 from public.organization_members where organization_id=p_organization and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment::text||':'||p_language,0));
 select * into q from public.report_generation_requests where id=p_request;
 if q.id is not null then
  if q.organization_id<>p_organization or q.establishment_id<>p_establishment or q.authority_user_id<>p_user or q.language<>p_language then raise exception 'FORBIDDEN';end if;
  select * into r from public.historical_report_runs where id=q.source_run_id;return r;
 end if;
 select * into r from public.historical_report_runs where establishment_id=p_establishment and language=p_language and status in('queued','running','retry') order by created_at desc limit 1;
 if r.id is not null then return r;end if;
 if exists(select 1 from public.analysis_parallel_reports pair join public.analysis_jls_sol_ready_operations op on op.run_id=pair.run_id
 where pair.organization_id=p_organization and pair.establishment_id=p_establishment and pair.language=p_language and op.request_count=1 and (op.status='billing_uncertain' or op.receipt is null)) then raise exception 'REPORT_PREVIOUS_OUTCOME_UNCERTAIN';end if;
 if exists(select 1 from public.analysis_parallel_reports pair join public.analysis_jls_restaurant_runs j on j.id=pair.run_id where pair.establishment_id=p_establishment and pair.language=p_language and j.status in('queued','running')) then raise exception 'REPORT_OTHER_PIPELINE_RUNNING';end if;
 if exists(select 1 from public.analysis_jev_batch_runs br join public.analysis_parallel_reports bp on bp.id=br.report_id where br.current_source_run_id is not null and bp.establishment_id=p_establishment and bp.language=p_language and (br.status='billing_uncertain' or exists(select 1 from public.analysis_jev_batch_tasks bt where bt.run_id=br.id and bt.status='unknown'))) then raise exception 'REPORT_PREVIOUS_OUTCOME_UNCERTAIN';end if;
 select engine,jev_transport into e,jt from public.report_pipeline_settings where id for share;
 if e='jev_sol_v2' then
  insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model)
  values(p_organization,p_establishment,p_language,p_user,'queued','{"analysis_version":8,"english_translation_override_policy":"verified_english_translation_overrides_v1"}', 'gpt-6.1-sol') returning * into r;
 else
  if exists(select 1 from public.historical_report_runs where establishment_id=p_establishment and language=p_language and error_code='REPORT_BILLING_UNCERTAIN_NO_RETRY') then raise exception 'REPORT_BILLING_UNCERTAIN_NO_RETRY';end if;
  r=public.enqueue_historical_report(p_establishment,p_organization,p_user,p_language,p_legacy_model,p_legacy_version);
 end if;
 insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport) values(p_request,p_organization,p_establishment,p_user,p_language,e,r.id,case when e='jev_sol_v2' then jt else 'individual' end);return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.wake_current_jev_preparation(p_source uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.report_generation_requests q join public.historical_report_runs s on s.id=q.source_run_id
  where s.id=p_source and q.engine='jev_sol_v2' and q.jev_transport='batch_initial_v1' and q.comparison_id is null
  and s.status in('queued','running','retry') and s.locked_by is null and s.created_at+interval '24 hours'>now()
  and s.snapshot->'reviews' is not null and s.snapshot->'base' is not null) then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-historical-report-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
   (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
  body:='{}'::jsonb,timeout_milliseconds:=180000) into result;return result;
end $function$
;

revoke all on function public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,int),public.claim_historical_report_jobs(uuid,int),public.wake_current_jev_preparation(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,int),public.claim_historical_report_jobs(uuid,int),public.wake_current_jev_preparation(uuid) to service_role;
