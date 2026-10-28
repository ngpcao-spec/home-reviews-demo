begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.establishments,public.initial_import_jobs,public.review_sync_jobs in access exclusive mode nowait;

alter table public.initial_import_jobs
 add column request_kind text not null default 'initial' check(request_kind in('initial','reload')),
 add column request_key uuid;
create unique index initial_import_reload_intent on public.initial_import_jobs(user_id,request_key) where request_kind='reload';
alter table public.establishments
 add column review_reload_job_id uuid,
 add column review_reload_request_id uuid,
 add column review_reload_status text not null default 'idle' check(review_reload_status in('idle','queued','running','failed','completed')),
 add column review_reload_count integer,
 add column review_reload_completed_at timestamptz,
 add column review_reload_barrier_at timestamptz;

create table private.review_reload_staging(
 job_id uuid primary key references public.initial_import_jobs(id),
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 bundle jsonb not null,summary jsonb not null,sha256 text not null,created_at timestamptz not null default now()
);
alter table private.review_reload_staging enable row level security;
revoke all on private.review_reload_staging from public,anon,authenticated;
grant select,delete on private.review_reload_staging to service_role;
-- Includes clicks joining/resuming an earlier job: a lost reply must not turn
-- that same manual intent into a fresh paid collection after the job finishes.
create table private.review_reload_intents(
 user_id uuid not null,request_key uuid not null,establishment_id uuid not null references public.establishments(id) on delete cascade,
 job_id uuid not null references public.initial_import_jobs(id),created_at timestamptz not null default now(),primary key(user_id,request_key)
);
alter table private.review_reload_intents enable row level security;
revoke all on private.review_reload_intents from public,anon,authenticated;

-- Shares the corpus lock used by ingestion/freezing, then locks the restaurant.
-- No provider request is made by this function. The existing durable queue wakes after commit.
create function public.request_review_reload(p_establishment uuid,p_request_key uuid)
returns public.initial_import_jobs language plpgsql security definer set search_path='' as $$
declare e public.establishments;j public.initial_import_jobs;v_language text;
begin
 if p_request_key is null or auth.uid() is null then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 select * into e from public.establishments where id=p_establishment and exists(
  select 1 from public.organization_members m where m.organization_id=establishments.organization_id
   and m.user_id=auth.uid() and m.role in('owner','admin','manager')) for update;
 if not found then raise exception 'FORBIDDEN';end if;
 select q.* into j from private.review_reload_intents i join public.initial_import_jobs q on q.id=i.job_id
  where i.user_id=auth.uid() and i.request_key=p_request_key;
 if found then
  if j.establishment_id is distinct from e.id then raise exception 'RELOAD_INTENT_SCOPE';end if;
  return j;
 end if;
 select * into j from public.initial_import_jobs where id=e.review_reload_job_id for update;
 if found and j.status in('queued','running','retry') then
  insert into private.review_reload_intents(user_id,request_key,establishment_id,job_id) values(auth.uid(),p_request_key,e.id,j.id);
  update public.establishments set review_reload_request_id=p_request_key where id=e.id;
  return j;
 end if;
 if found and j.status='failed' then
  if j.provider_start_attempted_at is not null and j.provider_run_id is null then raise exception 'APIFY_START_OUTCOME_UNKNOWN';end if;
  perform private.assert_review_reload_idle(e.id);
  -- A validated stage is retried as a database commit only. A known unconfirmed run
  -- is observed again, without replacing its consumed provider identity.
  if exists(select 1 from private.review_reload_staging where job_id=j.id)
    or j.provider_run_id is not null and (j.provider_status is null or j.provider_status not in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED')
      or j.provider_status='SUCCEEDED' and coalesce(j.error_code,'') not in('RELOAD_COLLECTION_INCOMPLETE','RELOAD_COLLECTION_UNVERIFIED',
       'RELOAD_RESTAURANT_MISMATCH','RELOAD_LANGUAGE_MISMATCH','RELOAD_FRESHNESS_UNVERIFIED','RELOAD_GOOGLE_TOTAL_INCONSISTENT')) then
   update public.initial_import_jobs set status='queued',available_at=now(),locked_by=null,lease_until=null,
    error_code=null,finished_at=null,updated_at=now() where id=j.id returning * into j;
   insert into private.review_reload_intents(user_id,request_key,establishment_id,job_id) values(auth.uid(),p_request_key,e.id,j.id);
   update public.establishments set review_reload_status='queued',review_reload_request_id=p_request_key where id=e.id;
   return j;
  end if;
 end if;
 if exists(select 1 from public.initial_import_jobs q where q.organization_id=e.organization_id and q.expected_google_id=e.google_id
   and (q.status in('queued','running','retry') or q.provider_start_attempted_at is not null and
     (q.provider_run_id is null or q.status<>'completed' and
      (q.provider_finished_observed_at is null or coalesce(q.provider_status,'') not in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED')))))
  or exists(select 1 from public.review_sync_jobs s where s.establishment_id=e.id and
   (s.status in('queued','running','retry') or (s.provider_start_attempted_at is not null or s.apify_run_id is not null)
    and s.status<>'completed' and (s.apify_run_id is null or coalesce(s.error_code,'') not in('APIFY_RUN_FAILED','APIFY_RUN_TIMED-OUT','APIFY_RUN_ABORTED')))) then
  raise exception 'REVIEW_COLLECTION_BUSY';end if;
 perform private.assert_review_reload_idle(e.id);
 select preferred_language into v_language from public.profiles where user_id=auth.uid();
 if v_language is null or v_language not in('fr','vi') then raise exception 'RELOAD_LANGUAGE_REQUIRED';end if;
 insert into public.initial_import_jobs(organization_id,user_id,query,expected_google_id,establishment_id,preferred_language,
  request_kind,request_key,reviews_target,status,candidate_snapshot)
 values(e.organization_id,auth.uid(),'https://www.google.com/maps?cid='||e.google_id,e.google_id,e.id,v_language,
  'reload',p_request_key,150,'queued','{}') returning * into j;
 insert into private.review_reload_intents(user_id,request_key,establishment_id,job_id) values(auth.uid(),p_request_key,e.id,j.id);
 update public.establishments set review_reload_job_id=j.id,review_reload_request_id=p_request_key,review_reload_status='queued' where id=e.id;
 return j;
end$$;

create function private.assert_review_reload_idle(p_establishment uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.historical_report_runs where establishment_id=p_establishment and status not in('completed','failed','cancelled','abandoned','superseded','invalid_output'))
 or exists(select 1 from public.analysis_jev_batch_runs b where establishment_id=p_establishment and
  (b.armed or b.sol_request_count>0 and b.sol_receipt is null or exists(select 1 from public.analysis_jev_batch_tasks t
   where t.run_id=b.id and t.request_count>0 and t.receipt is null)))
 or exists(select 1 from private.kh_en_experiments x where x.establishment_id=p_establishment and
  (x.armed or exists(select 1 from private.kh_en_calls c where c.experiment_id=x.id and c.attempts>0 and c.state<>'received')))
 or exists(select 1 from private.review_display_receipts d join public.reviews r on r.id=d.review_id
  where r.establishment_id=p_establishment and d.status not in('completed','failed'))
 or exists(select 1 from public.review_sync_jobs s where s.establishment_id=p_establishment and
   (s.status in('queued','running','retry') or (s.provider_start_attempted_at is not null or s.apify_run_id is not null)
    and s.status<>'completed' and (s.apify_run_id is null or coalesce(s.error_code,'') not in('APIFY_RUN_FAILED','APIFY_RUN_TIMED-OUT','APIFY_RUN_ABORTED'))))
 or exists(select 1 from public.initial_import_jobs q join public.establishments e on e.organization_id=q.organization_id and e.google_id=q.expected_google_id
  where e.id=p_establishment and q.id is distinct from e.review_reload_job_id and q.status in('queued','running','retry')) then
  raise exception 'RELOAD_GENERATION_OR_RESULT_PENDING';end if;
end$$;

create function private.guard_review_reload_generation() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.establishments;v_id uuid;
begin
 if current_setting('home.retention_maintenance',true)='on' then return new;end if;
 v_id:=new.establishment_id;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||v_id::text,0));
 select * into e from public.establishments where id=v_id for update;
 if exists(select 1 from public.initial_import_jobs where id=e.review_reload_job_id and status in('queued','running','retry')) then
  raise exception 'REVIEW_RELOAD_IN_PROGRESS';end if;
 if tg_table_name='current_report_publications' then
  if e.review_reload_barrier_at is not null and (new.source_created_at<e.review_reload_barrier_at
   or exists(select 1 from private.retired_generation_keys where source_run_id=new.source_run_id)) then
   raise exception 'RELOAD_OBSOLETE_PUBLICATION';end if;
 end if;
 return new;
end$$;
create trigger review_reload_generation_guard before insert on public.report_generation_requests for each row execute function private.guard_review_reload_generation();
create trigger review_reload_source_guard before insert or update on public.historical_report_runs for each row execute function private.guard_review_reload_generation();
create trigger review_reload_batch_guard before insert or update on public.analysis_jev_batch_runs for each row execute function private.guard_review_reload_generation();
create trigger review_reload_publication_guard before insert or update on public.current_report_publications for each row execute function private.guard_review_reload_generation();
create trigger review_reload_experiment_guard before insert or update on private.kh_en_experiments for each row execute function private.guard_review_reload_generation();

create function private.guard_review_reload_settings() returns trigger language plpgsql set search_path='' as $$begin
 if current_user not in('postgres','supabase_admin','service_role') and
  (new.review_reload_job_id,new.review_reload_request_id,new.review_reload_status,new.review_reload_count,new.review_reload_completed_at,new.review_reload_barrier_at)
  is distinct from (old.review_reload_job_id,old.review_reload_request_id,old.review_reload_status,old.review_reload_count,old.review_reload_completed_at,old.review_reload_barrier_at) then
  raise exception 'FORBIDDEN';end if;return new;
end$$;
create trigger review_reload_settings_guard before update on public.establishments for each row execute function private.guard_review_reload_settings();

-- Guard every ingestion (including a late sync), preserving all ordinary sync logic.
do $$declare d text;anchor text:=' prior=current_setting(''home.retention_ingest'',true);';begin
 d:=pg_get_functiondef('public.ingest_recent_reviews(uuid,uuid,jsonb,text)'::regprocedure);
 if position(anchor in d)=0 then raise exception 'RELOAD_INGESTION_ANCHOR_MISMATCH';end if;
 d:=replace(d,anchor,$patch$
 if exists(select 1 from public.establishments e join public.initial_import_jobs j on j.id=e.review_reload_job_id
   where e.id=p_establishment and j.status in('queued','running','retry')
    and j.id::text is distinct from current_setting('home.review_reload_job',true)) then raise exception 'REVIEW_RELOAD_IN_PROGRESS';end if;
 if exists(select 1 from public.establishments e cross join jsonb_array_elements(p_bundle) x
   where e.id=p_establishment and e.review_reload_barrier_at is not null
    and (nullif(x#>>'{row,provider_scraped_at}','') is null or (x#>>'{row,provider_scraped_at}')::timestamptz<e.review_reload_barrier_at)) then
  raise exception 'RELOAD_OBSOLETE_INGESTION';end if;
 prior=current_setting('home.retention_ingest',true);$patch$);
 execute d;
end$$;

create function public.stage_review_reload(p_job uuid,p_worker text,p_bundle jsonb,p_summary jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs;e public.establishments;n integer;b jsonb;tr jsonb;v_sha text;coverage jsonb;
begin
 select * into j from public.initial_import_jobs where id=p_job and request_kind='reload' and status='running'
  and locked_by=p_worker and lease_until>now() for update;
 if not found then raise exception 'INITIAL_IMPORT_LEASE_LOST';end if;
 select * into e from public.establishments where id=j.establishment_id and review_reload_job_id=j.id;
 if not found or j.provider_status is distinct from 'SUCCEEDED' or j.provider_run_id is null
   or j.provider_dataset_id is null or j.provider_finished_observed_at is null then raise exception 'RELOAD_RESULT_UNCONFIRMED';end if;
 if jsonb_typeof(p_bundle)<>'array' then raise exception 'RELOAD_INVALID_BUNDLE';end if;
 n:=jsonb_array_length(p_bundle);
 coverage:=private.initial_review_collection_coverage(p_summary->'googleTotal',n);
 if n>150 or coverage->>'status'<>'complete' or (p_summary->>'uniqueCount')::integer is distinct from n
  or (select count(distinct btrim(value#>>'{row,external_review_id}')) from jsonb_array_elements(p_bundle))<>n
  then raise exception 'RELOAD_COLLECTION_INCOMPLETE';end if;
 if n=0 and (p_summary->'googleTotal' is distinct from '0'::jsonb or p_summary#>>'{emptyProof,reviewsCount}' is distinct from '0'
  or (p_summary#>>'{emptyProof,cid}' is distinct from e.google_id and (e.place_id is null or p_summary#>>'{emptyProof,placeId}' is distinct from e.place_id))
  or p_summary#>>'{emptyProof,language}' is distinct from j.preferred_language
  or nullif(p_summary#>>'{emptyProof,scrapedAt}','') is null or (p_summary#>>'{emptyProof,scrapedAt}')::timestamptz<j.created_at) then
  raise exception 'RELOAD_EMPTY_RESULT_UNVERIFIED';end if;
 for b in select value from jsonb_array_elements(p_bundle) loop
  if b#>>'{row,establishment_id}' is distinct from e.id::text or b#>>'{row,organization_id}' is distinct from e.organization_id::text
   or nullif(btrim(b#>>'{row,external_review_id}'),'') is null or b#>>'{row,external_review_id}' is distinct from b#>>'{raw_payload,reviewId}'
   or (b#>>'{row,rating}')::numeric not between 1 and 5
   or nullif(b#>>'{row,published_at}','') is null or (b#>>'{row,published_at}')::timestamptz>clock_timestamp()
   or coalesce(b#>>'{row,original_text}','') is distinct from coalesce(b#>>'{raw_payload,text}','')
   or b#>>'{row,requires_ai_analysis}' is distinct from 'false' or b#>>'{row,historical_import}' is distinct from 'true'
   or (b#>>'{raw_payload,cid}' is distinct from e.google_id and (e.place_id is null or b#>>'{raw_payload,placeId}' is distinct from e.place_id))
   or nullif(b#>>'{row,provider_scraped_at}','') is null or (b#>>'{row,provider_scraped_at}')::timestamptz<j.created_at
   or (nullif(b#>>'{raw_payload,language}','') is not null and lower(b#>>'{raw_payload,language}')<>j.preferred_language)
   then raise exception 'RELOAD_BUNDLE_SCOPE_OR_NATIVE_MISMATCH';end if;
  if coalesce(b#>>'{raw_payload,textTranslated}','')<>'' and b#>>'{raw_payload,translatedLanguage}' is distinct from j.preferred_language then raise exception 'RELOAD_LANGUAGE_MISMATCH';end if;
  if jsonb_typeof(b->'translations')<>'array' or jsonb_array_length(b->'translations')>1 then raise exception 'RELOAD_TRANSLATION_INVALID';end if;
  for tr in select value from jsonb_array_elements(b->'translations') loop
   if tr->>'language' is distinct from j.preferred_language or tr->>'translated_text' is distinct from b#>>'{raw_payload,textTranslated}'
    or b#>>'{raw_payload,translatedLanguage}' is distinct from j.preferred_language then raise exception 'RELOAD_TRANSLATION_INVALID';end if;
  end loop;
 end loop;
 v_sha:=encode(extensions.digest(p_bundle::text||p_summary::text,'sha256'),'hex');
 if exists(select 1 from private.review_reload_staging where job_id=j.id and sha256<>v_sha) then raise exception 'RELOAD_STAGE_IMMUTABLE';end if;
 insert into private.review_reload_staging(job_id,establishment_id,bundle,summary,sha256) values(j.id,e.id,p_bundle,p_summary,v_sha) on conflict do nothing;
 update public.initial_import_jobs set reviews_fetched=n where id=j.id;
 return true;
end$$;

create function public.review_reload_stage_ready(p_job uuid,p_worker text) returns boolean
language sql security definer set search_path='' as $$select exists(select 1 from private.review_reload_staging s
 join public.initial_import_jobs j on j.id=s.job_id where j.id=p_job and j.request_kind='reload' and j.status='running'
 and j.locked_by=p_worker and j.lease_until>now())$$;

-- Content cleanup is privileged; the caller remains service_role for the existing
-- SECURITY INVOKER ingestion. Every deletion is inside the apply RPC transaction.
create function private.remove_review_reload_corpus(p_job uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs;s uuid;x record;v_prior text;begin
 select * into j from public.initial_import_jobs where id=p_job and request_kind='reload' and status='running' for update;
 if not found or not exists(select 1 from private.review_reload_staging where job_id=j.id and establishment_id=j.establishment_id)
  or current_setting('home.review_reload_job',true) is distinct from j.id::text then raise exception 'FORBIDDEN';end if;
 perform private.assert_review_reload_idle(j.establishment_id);
 v_prior:=current_setting('home.retention_maintenance',true);perform set_config('home.retention_maintenance','on',true);
 for s in select id from public.historical_report_runs where establishment_id=j.establishment_id loop
  if not private.retention_retire_source(s,'MANUAL_REVIEW_RELOAD') then raise exception 'RELOAD_GENERATION_OR_RESULT_PENDING';end if;
 end loop;
 -- Preserve native accounting/hash/identity only; remove experimental text copies.
 for x in select c.*,e.organization_id from private.kh_en_calls c join
   (select id,(body->>'organization_id')::uuid organization_id from private.kh_en_experiments where establishment_id=j.establishment_id) e on e.id=c.experiment_id loop
  perform private.record_retention_attempt('private.kh_en_calls',to_jsonb(x)||jsonb_build_object(
   'id',x.experiment_id::text||':'||x.phase,'organization_id',j.organization_id,'establishment_id',j.establishment_id,
   'request_count',x.attempts,'status',case when x.state='received' then 'completed' else 'unknown' end,
   'receipt_sha256',x.receipt->>'raw_response_sha256','completed_at',x.finished_at));
 end loop;
 delete from private.kh_en_calls where experiment_id in(select id from private.kh_en_experiments where establishment_id=j.establishment_id);
 delete from private.kh_en_experiments where establishment_id=j.establishment_id;
 delete from public.restaurant_recommendation_sheets where establishment_id=j.establishment_id;
 delete from public.current_report_publications where establishment_id=j.establishment_id;
 delete from public.historical_establishment_reports where establishment_id=j.establishment_id;
 delete from public.weekly_establishment_reports where establishment_id=j.establishment_id;
 delete from private.retired_report_scopes where establishment_id=j.establishment_id;
 delete from public.push_test_deliveries where review_id in(select id from public.reviews where establishment_id=j.establishment_id);
 perform private.record_retention_attempt('public.reviews',to_jsonb(r)) from public.reviews r where establishment_id=j.establishment_id;
 -- These reviewed FKs remove translations, raw provider data, display copies,
 -- reply drafts and notifications. Restrictive legacy FKs fail closed.
 delete from public.reviews where establishment_id=j.establishment_id;
 delete from private.review_seen_keys where establishment_id=j.establishment_id;
 delete from public.review_observation_totals where establishment_id=j.establishment_id;
 delete from public.establishment_snapshots where establishment_id=j.establishment_id;
 perform set_config('home.retention_maintenance',coalesce(v_prior,''),true);
end$$;

create function public.apply_review_reload(p_job uuid,p_worker text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.initial_import_jobs;e public.establishments;s private.review_reload_staging;v jsonb;result jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into j from public.initial_import_jobs where id=p_job and request_kind='reload';
 if not found then raise exception 'RELOAD_JOB_MISSING';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||j.establishment_id::text,0));
 select * into e from public.establishments where id=j.establishment_id for update;
 select * into j from public.initial_import_jobs where id=p_job for update;
 if j.status='completed' and j.result->>'reload_replaced'='true' then return j.result;end if;
 if j.status<>'running' or j.locked_by is distinct from p_worker or j.lease_until<=now() or e.review_reload_job_id is distinct from j.id then raise exception 'INITIAL_IMPORT_LEASE_LOST';end if;
 select * into s from private.review_reload_staging where job_id=j.id;
 if not found or s.sha256 is distinct from encode(extensions.digest(s.bundle::text||s.summary::text,'sha256'),'hex') then raise exception 'RELOAD_STAGE_MISSING_OR_CHANGED';end if;
 perform set_config('home.review_reload_job',j.id::text,true);
 perform private.remove_review_reload_corpus(j.id);
 v:=public.ingest_recent_reviews(e.id,e.organization_id,s.bundle,'apify');
 if (v->>'retained')::integer is distinct from jsonb_array_length(s.bundle) then raise exception 'RELOAD_PERSISTENCE_COUNT_MISMATCH';end if;
 update public.establishments set initial_import_job_id=j.id,review_reload_barrier_at=j.created_at where id=e.id;
 result:=jsonb_build_object('establishmentId',e.id,'inserted',v->'retained','reviewsTarget',150,
  'reportedGoogleTotal',s.summary->'googleTotal','reload_replaced',true,'stage_sha256',s.sha256,'importStatus','completed');
 if not public.finalize_initial_import_job(j.id,p_worker,e.id,s.bundle#>>'{0,row,external_review_id}',
   (s.bundle#>>'{0,row,published_at}')::timestamptz,e.reporting_started_at,result) then raise exception 'INITIAL_IMPORT_LEASE_LOST';end if;
 update public.initial_import_jobs set reviews_inserted=(v->>'retained')::integer,persistence_completed_at=clock_timestamp() where id=j.id;
 update public.establishments set review_reload_status='completed',review_reload_count=(v->>'retained')::integer,
  review_reload_completed_at=clock_timestamp(),active=e.active,next_sync_at=case when e.active then next_sync_at end where id=e.id;
 delete from private.review_reload_staging where job_id=j.id;
 return result;
end$$;

create function public.fail_review_reload(p_job uuid,p_worker text,p_error text,p_summary jsonb default '{}') returns text
language plpgsql security definer set search_path='' as $$declare j public.initial_import_jobs;begin
 select * into j from public.initial_import_jobs where id=p_job and request_kind='reload' for update;
 if j.status='completed' then return j.status;end if;
 if j.status<>'running' or j.locked_by is distinct from p_worker then raise exception 'INITIAL_IMPORT_LEASE_LOST';end if;
 update public.initial_import_jobs set status='failed',error_code=left(p_error,200),result=jsonb_build_object('validation',p_summary),
  locked_by=null,lease_until=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
 update public.establishments set review_reload_status='failed' where id=j.establishment_id and review_reload_job_id=j.id;
 return 'failed';
end$$;

-- Reuse durable running/failed transitions, without an import-added notification.
create function private.reflect_review_reload_state() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.establishments set review_reload_status=case when new.status in('queued','retry') then 'queued' else new.status end
 where id=new.establishment_id and review_reload_job_id=new.id;
 return new;
end$$;
create trigger review_reload_state after update of status on public.initial_import_jobs for each row when(new.request_kind='reload') execute function private.reflect_review_reload_state();
drop trigger initial_import_completion_notification on public.initial_import_jobs;
create trigger initial_import_completion_notification after update of status on public.initial_import_jobs
for each row when(new.request_kind='initial' and new.status='completed' and old.status is distinct from 'completed'
 and new.result->'collection'->>'status' is distinct from 'partial') execute function private.notify_initial_import_completed();

-- The old merge retry endpoint must never reset or resend a full-reload job.
do $$declare d text;anchor text:='  if not found then raise exception ''IMPORT_JOB_NOT_RETRYABLE''; end if;';begin
 d:=pg_get_functiondef('public.retry_initial_import_job(uuid)'::regprocedure);
 if position(anchor in d)=0 then raise exception 'RELOAD_RETRY_ANCHOR_MISMATCH';end if;
 execute replace(d,anchor,anchor||' if j.request_kind=''reload'' then raise exception ''USE_MANUAL_RELOAD'';end if;');
end$$;

create function private.expire_review_reload_stages() returns void language sql security definer set search_path='' as $$
 delete from private.review_reload_staging s using public.initial_import_jobs j
 where j.id=s.job_id and j.status not in('queued','running','retry') and s.created_at<now()-interval '24 hours'
$$;
-- New empty staging table only. Existing queues and data are not touched on deploy.
select cron.schedule('expire-review-reload-stages','17 * * * *','select private.expire_review_reload_stages()');

revoke all on function public.request_review_reload(uuid,uuid) from public,anon;
grant execute on function public.request_review_reload(uuid,uuid) to authenticated;
revoke all on function private.assert_review_reload_idle(uuid),private.guard_review_reload_generation(),
 private.remove_review_reload_corpus(uuid),private.reflect_review_reload_state(),private.expire_review_reload_stages(),private.guard_review_reload_settings() from public,anon,authenticated;
grant execute on function private.remove_review_reload_corpus(uuid) to service_role;
revoke all on function public.stage_review_reload(uuid,text,jsonb,jsonb),public.review_reload_stage_ready(uuid,text),
 public.apply_review_reload(uuid,text),public.fail_review_reload(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage_review_reload(uuid,text,jsonb,jsonb),public.review_reload_stage_ready(uuid,text),
 public.apply_review_reload(uuid,text),public.fail_review_reload(uuid,text,text,jsonb) to service_role;
commit;
