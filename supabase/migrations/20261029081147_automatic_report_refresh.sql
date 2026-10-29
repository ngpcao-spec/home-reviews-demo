-- Future successful incremental commits only. Installation/backfill enqueues nothing.
begin;
set local lock_timeout='5s';
create table private.automatic_report_runtime(singleton boolean primary key default true check(singleton),enabled boolean not null default false,activated_at timestamptz);
insert into private.automatic_report_runtime values(true,false,null);
create table private.report_review_coverage(
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 organization_id uuid not null,language text not null check(language in('fr','vi')),report_id uuid not null,
 source_run_id uuid not null,policy_epoch uuid,google_ids_sha256 text[] not null,
 usable boolean not null,missing_ids integer not null,authority_user_id uuid,
 primary key(establishment_id,language),
 foreign key(establishment_id,language) references public.current_report_publications(establishment_id,language) on delete cascade
);
create table private.automatic_report_attempts(
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 language text not null,reference_report_id uuid not null,request_id uuid,source_run_id uuid,
 new_reviews integer not null,negative_reviews integer not null,
 state text not null check(state in('reserved','joined','blocked')),error_code text,created_at timestamptz not null default clock_timestamp(),
 primary key(establishment_id,language,reference_report_id)
);
create table private.automatic_report_checks(establishment_id uuid not null references public.establishments(id) on delete cascade,language text not null,primary key(establishment_id,language));
create table private.shared_jev_sync_bindings(sync_job_id uuid primary key,run_id uuid not null references public.analysis_jev_batch_runs(id) on delete cascade);
alter table private.shared_jev_sync_bindings enable row level security;
revoke all on private.shared_jev_sync_bindings from public,anon,authenticated;
grant all on private.shared_jev_sync_bindings to service_role;
alter table private.automatic_report_runtime enable row level security;
alter table private.report_review_coverage enable row level security;
alter table private.automatic_report_attempts enable row level security;
alter table private.automatic_report_checks enable row level security;
revoke all on private.automatic_report_runtime,private.report_review_coverage,private.automatic_report_attempts,private.automatic_report_checks from public,anon,authenticated;
grant all on private.automatic_report_runtime,private.report_review_coverage,private.automatic_report_attempts,private.automatic_report_checks to service_role;
alter table public.report_generation_requests add column origin text not null default 'manual' check(origin in('manual','automatic_thresholds'));
alter table public.report_generation_requests add column origin_reference_report_id uuid;
alter table public.report_generation_requests add column origin_counts jsonb;

-- Durable hashed Google identities, independent of disposable sources/internal UUIDs.
create function private.capture_report_coverage(p public.current_report_publications) returns void language plpgsql security definer set search_path='' as $$
declare ids text[];missing integer;actor uuid;ep uuid;begin
 select coalesce(array_agg(distinct h) filter(where h is not null),'{}'),count(*) filter(where h is null) into ids,missing from(
  select coalesce(nullif(b->>'google_review_id_sha256',''),case when nullif(btrim(r.external_review_id),'') is not null then encode(extensions.digest(btrim(r.external_review_id),'sha256'),'hex') end) h
  from jsonb_array_elements(p.source_bindings) b left join public.reviews r on r.id::text=b->>'id' and r.establishment_id=p.establishment_id
 ) x;
 select authority_user_id into actor from public.report_generation_requests where source_run_id=p.source_run_id;
 if actor is null then select m.user_id into actor from public.organization_members m join public.profiles pr on pr.user_id=m.user_id
  where m.organization_id=p.organization_id and m.role in('owner','admin','manager') and pr.preferred_language=p.language order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,m.user_id limit 1;end if;
 ep=nullif(p.scope->>'policy_epoch','')::uuid;
 insert into private.report_review_coverage values(p.establishment_id,p.organization_id,p.language,p.report_id,p.source_run_id,ep,ids,
  missing=0 and cardinality(ids)=jsonb_array_length(p.source_bindings) and cardinality(ids)>0 and cardinality(ids)=coalesce((p.scope->>'review_count')::int,-1)
  and p.document->>'state'='completed' and p.document#>>'{controls,technical_checks_passed}'='true',missing,actor)
 on conflict(establishment_id,language) do update set report_id=excluded.report_id,source_run_id=excluded.source_run_id,policy_epoch=excluded.policy_epoch,
  google_ids_sha256=excluded.google_ids_sha256,usable=excluded.usable,missing_ids=excluded.missing_ids,authority_user_id=excluded.authority_user_id;
end $$;

create function private.report_refresh_counts(p_establishment uuid,p_language text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c private.report_review_coverage;p public.current_report_publications;n int;neg int;begin
 select * into c from private.report_review_coverage where establishment_id=p_establishment and language=p_language;
 select * into p from public.current_report_publications where establishment_id=p_establishment and language=p_language;
 if c.report_id is null or c.report_id is distinct from p.report_id or not c.usable or p.document->>'state' is distinct from 'completed'
  or p.document#>>'{controls,technical_checks_passed}' is distinct from 'true' or not exists(select 1 from public.review_corpus_policy where enabled and not paused and epoch=c.policy_epoch)
 then return jsonb_build_object('version','automatic-report-thresholds-v1','reference_usable',false,'reference_report_id',p.report_id,'new_reviews',null,'negative_reviews',null,'threshold_met',false);end if;
 select count(*),count(*) filter(where rating in(1,2,3)) into n,neg from(
  select distinct on(btrim(r.external_review_id)) r.external_review_id,r.rating from public.reviews r
  where r.establishment_id=p_establishment and r.id in(select public.retained_review_ids(p_establishment,clock_timestamp())) and nullif(btrim(r.external_review_id),'') is not null
  and not(encode(extensions.digest(btrim(r.external_review_id),'sha256'),'hex')=any(c.google_ids_sha256))
  order by btrim(r.external_review_id),r.published_at desc nulls last,r.id
 ) x;
 return jsonb_build_object('version','automatic-report-thresholds-v1','reference_usable',true,'reference_report_id',c.report_id,'new_reviews',n,'negative_reviews',neg,'threshold_met',neg>=3 or n>=25);
end $$;

create function private.pin_automatic_report_origin() returns trigger language plpgsql set search_path='' as $$
begin
 if nullif(current_setting('home.auto_report_reference',true),'') is not null then
  new.origin='automatic_thresholds';new.origin_reference_report_id=current_setting('home.auto_report_reference')::uuid;
  new.origin_counts=current_setting('home.auto_report_counts')::jsonb;
 end if;return new;
end $$;
create trigger pin_automatic_report_origin before insert on public.report_generation_requests for each row execute function private.pin_automatic_report_origin();

-- Same corpus lock and enqueue as a manual click. One automatic authorization per
-- successful reference, including failure/unknown: no paid retry loop after cleanup.
create function private.maybe_refresh_report(p_establishment uuid,p_language text) returns text language plpgsql security definer set search_path='' as $$
declare c private.report_review_coverage;counts jsonb;r public.historical_report_runs;q public.report_generation_requests;rid uuid;code text;begin
 if not exists(select 1 from private.automatic_report_runtime where enabled) then return 'disabled';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 select * into c from private.report_review_coverage where establishment_id=p_establishment and language=p_language;
 counts=private.report_refresh_counts(p_establishment,p_language);
 if counts->>'reference_usable' is distinct from 'true' then return 'manual_reference_required';end if;
 if counts->>'threshold_met' is distinct from 'true' then delete from private.automatic_report_checks where establishment_id=p_establishment and language=p_language;return 'below_threshold';end if;
 if not exists(select 1 from private.shared_jev_runtime where enabled) or not exists(select 1 from public.report_pipeline_settings where id and engine='jev_sol_v2' and jev_transport='batch_initial_v1')
  or not exists(select 1 from public.establishments where id=p_establishment and organization_id=c.organization_id and active)
  or not exists(select 1 from public.organization_members m join public.profiles pr on pr.user_id=m.user_id where m.organization_id=c.organization_id and m.user_id=c.authority_user_id and m.role in('owner','admin','manager') and pr.preferred_language=p_language)
  or exists(select 1 from public.review_corpus_policy where paused or ingestions_paused)
  or exists(select 1 from public.initial_import_jobs where establishment_id=p_establishment and status in('queued','running','retry')) then return 'not_eligible';end if;
 -- The just-published request may still be closing its source. Defer to its
 -- completion trigger/recovery, rather than joining it as a new refresh.
 if exists(select 1 from public.historical_report_runs where id=c.source_run_id and status in('queued','running','retry')) then
  insert into private.automatic_report_checks values(p_establishment,p_language) on conflict do nothing;return 'publication_closing';end if;
 if exists(select 1 from private.automatic_report_attempts where establishment_id=p_establishment and language=p_language and reference_report_id=c.report_id) then return 'already_authorized';end if;
 rid=gen_random_uuid();
 insert into private.automatic_report_attempts values(p_establishment,p_language,c.report_id,rid,null,(counts->>'new_reviews')::int,(counts->>'negative_reviews')::int,'reserved',null,clock_timestamp());
 begin
  perform set_config('home.auto_report_reference',c.report_id::text,true);perform set_config('home.auto_report_counts',counts::text,true);
  r=public.enqueue_current_report(p_establishment,c.organization_id,c.authority_user_id,p_language,rid,'gpt-6.1-sol',8);
  perform set_config('home.auto_report_reference','',true);perform set_config('home.auto_report_counts','',true);
  select * into q from public.report_generation_requests where source_run_id=r.id;
  if q.id is null then raise exception 'AUTOMATIC_REPORT_REQUEST_NOT_BOUND';end if;
  update private.automatic_report_attempts set request_id=q.id,source_run_id=r.id,state=case when q.id=rid then 'reserved' else 'joined' end
   where establishment_id=p_establishment and language=p_language and reference_report_id=c.report_id;
 exception when others then
  get stacked diagnostics code=message_text;
  perform set_config('home.auto_report_reference','',true);perform set_config('home.auto_report_counts','',true);
  update private.automatic_report_attempts set state='blocked',error_code=left(code,160) where establishment_id=p_establishment and language=p_language and reference_report_id=c.report_id;
  raise warning 'AUTOMATIC_REPORT_ENQUEUE_BLOCKED %',code;return 'blocked';
 end;
 delete from private.automatic_report_checks where establishment_id=p_establishment and language=p_language;
 return case when q.id=rid then 'enqueued' else 'joined' end;
end $$;

create function private.capture_report_coverage_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.capture_report_coverage(new);
 if exists(select 1 from private.automatic_report_runtime where enabled) then
  insert into private.automatic_report_checks values(new.establishment_id,new.language) on conflict do nothing;
  perform private.maybe_refresh_report(new.establishment_id,new.language);
 end if;return new;
end $$;
create trigger report_google_coverage after insert or update of report_id on public.current_report_publications for each row execute function private.capture_report_coverage_trigger();

create function private.refresh_after_report_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='failed' and old.status is distinct from new.status then
  update private.automatic_report_attempts set state='blocked',error_code=coalesce(left(new.error_code,160),'REPORT_FAILED') where source_run_id=new.id;
 end if;
 if new.status='completed' and old.status is distinct from new.status and exists(select 1 from private.automatic_report_checks where establishment_id=new.establishment_id and language=new.language)
 then perform private.maybe_refresh_report(new.establishment_id,new.language);end if;return new;
end $$;
create trigger automatic_report_after_close after update of status on public.historical_report_runs for each row execute function private.refresh_after_report_close();

create function private.record_automatic_batch_failure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('blocked','invalid_output','billing_uncertain','authorization_expired') and old.status is distinct from new.status then
  update private.automatic_report_attempts set state='blocked',error_code=coalesce(left(new.error_code,160),'REPORT_OUTCOME_UNRESOLVED') where source_run_id=new.current_source_run_id;
 end if;return new;
end $$;
create trigger automatic_report_batch_failure after update of status on public.analysis_jev_batch_runs for each row execute function private.record_automatic_batch_failure();

create function private.check_automatic_reports() returns void language plpgsql security definer set search_path='' as $$
declare x record;begin
 if not exists(select 1 from private.automatic_report_runtime where enabled) then return;end if;
 for x in select * from private.automatic_report_checks order by establishment_id,language limit 10 loop perform private.maybe_refresh_report(x.establishment_id,x.language);end loop;
end $$;

-- Enqueue is normally called as service_role. Publication/completion triggers
-- run as the owner; accept only this narrowly scoped, authorized internal call.
create function private.automatic_report_context(p_establishment uuid) returns boolean language sql stable set search_path='' as $$
 select current_user='postgres' and exists(select 1 from private.automatic_report_runtime where enabled)
 and exists(select 1 from private.report_review_coverage c where c.establishment_id=p_establishment and c.usable
 and c.report_id::text=nullif(current_setting('home.auto_report_reference',true),''))
$$;

-- Read-only, service-only projection after the existing membership check. It never
-- queues work. The UI gets counts/status, not hashed identities or internal errors.
create function public.read_report_refresh_state(p_establishment uuid,p_language text) returns jsonb language plpgsql set search_path='' as $$
declare c jsonb;a private.automatic_report_attempts;q public.report_generation_requests;s public.historical_report_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 c=private.report_refresh_counts(p_establishment,p_language);
 select * into q from public.report_generation_requests where establishment_id=p_establishment and language=p_language order by created_at desc,id desc limit 1;
 select * into s from public.historical_report_runs where id=q.source_run_id;
 select * into a from private.automatic_report_attempts where establishment_id=p_establishment and language=p_language and reference_report_id::text=c->>'reference_report_id';
 return c||jsonb_build_object('enabled',(select enabled from private.automatic_report_runtime where singleton),'origin',q.origin,'request_id',q.id,
  'state',case when s.status in('queued','running','retry') then 'in_progress' when s.status='failed' or a.state='blocked' then 'failed' else 'waiting' end);
end $$;

-- Fail on drift; keep current retention, lease, provider and publication guards.
do $patch$ declare d text;a text;begin
 d=pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
 a='current_user<>''service_role''';if position(a in d)=0 then raise exception 'AUTO_REPORT_ENQUEUE_DRIFT';end if;
 execute replace(d,a,'(current_user<>''service_role'' and not private.automatic_report_context(p_establishment))');
 d=pg_get_functiondef('public.freeze_recent_review_source(uuid,uuid,text,timestamptz)'::regprocedure);
 if position(a in d)=0 then raise exception 'AUTO_REPORT_FREEZE_DRIFT';end if;
 execute replace(d,a,'(current_user<>''service_role'' and not private.automatic_report_context(p_establishment))');
 d=pg_get_functiondef('private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean)'::regprocedure);
 a='jsonb_build_object(''id'',r->>''id'',''rating'',r->''rating''';
 if position(a in d)=0 then raise exception 'AUTO_REPORT_PUBLICATION_DRIFT';end if;
 execute replace(d,a,'jsonb_build_object(''id'',r->>''id'',''google_review_id_sha256'',case when nullif(btrim(coalesce(r->>''google_review_id'',r->>''external_review_id'')),'''') is not null then encode(extensions.digest(btrim(coalesce(r->>''google_review_id'',r->>''external_review_id'')),''sha256''),''hex'') end,''rating'',r->''rating''');
 d=pg_get_functiondef('public.commit_incremental_review_sync(uuid,text,jsonb,jsonb)'::regprocedure);
 a='return answer;';if position(a in d)=0 then raise exception 'AUTO_REPORT_SYNC_DRIFT';end if;
 execute replace(d,a,'perform private.maybe_refresh_report(e.id,j.collection_language);return answer;');
 d=pg_get_functiondef('public.jev_batch_recover()'::regprocedure);
 a='begin';if position(a in d)=0 then raise exception 'AUTO_REPORT_RECOVERY_DRIFT';end if;
 execute regexp_replace(d,'begin','begin perform private.check_automatic_reports();');
end $patch$;

-- Coalesce available, unplanned comments for the same establishment/language.
-- No debounce delay. Once normalized/planned, the frozen job is never enlarged.
do $patch$ declare d text;a text;begin
 d=pg_get_functiondef('private.enqueue_new_review_jev(uuid,uuid[])'::regprocedure);
 d=replace(d,'bid uuid;','bid uuid;existing public.analysis_jev_batch_runs;merged_snapshot jsonb;');
 a='select * into e from public.establishments where id=j.establishment_id;';
 if position(a in d)=0 then raise exception 'AUTO_JEV_ENQUEUE_DRIFT';end if;
 d=replace(d,a,a||'perform pg_advisory_xact_lock(hashtextextended(''recent-text-corpus:''||j.establishment_id::text,0));
 select run_id into bid from private.shared_jev_sync_bindings where sync_job_id=p_job;
 if bid is not null then return bid;end if;');
 a='insert into public.analysis_jev_batch_runs(';
 if position(a in d)=0 then raise exception 'AUTO_JEV_COALESCE_DRIFT';end if;
 d=replace(d,a,'if exists(select 1 from private.automatic_report_runtime where enabled) then
 select * into existing from public.analysis_jev_batch_runs b where b.establishment_id=e.id and b.organization_id=e.organization_id and b.purpose=''new_reviews''
 and b.stage=''auto_prepare'' and b.armed and b.status=''running'' and b.expires_at>clock_timestamp() and b.policy_epoch=(select epoch from public.review_corpus_policy where id)
 and b.snapshot->>''language''=j.collection_language and b.created_at>=coalesce(e.review_reload_barrier_at,b.created_at)
 and not exists(select 1 from public.analysis_jev_batch_tasks where run_id=b.id) order by b.created_at,b.id limit 1 for update;
 if existing.id is not null then
 merged_snapshot=jsonb_set(existing.snapshot,''{reviews}'',(select jsonb_agg(v order by v->>''id'') from(select distinct on(v->>''id'') v from jsonb_array_elements((existing.snapshot->''reviews'')||(snapshot->''reviews'')) x(v)
 where exists(select 1 from public.reviews r where r.id::text=v->>''id'' and r.establishment_id=e.id and r.id in(select public.retained_review_ids(e.id,clock_timestamp()))) order by v->>''id'') z));
 perform set_config(''home.shared_jev_materialize'',''on'',true);
 update public.analysis_jev_batch_runs set snapshot=merged_snapshot,snapshot_sha256=public.jls_restaurant_hash(merged_snapshot) where id=existing.id;
 perform set_config(''home.shared_jev_materialize'','''',true);
 insert into private.shared_jev_sync_bindings values(p_job,existing.id);return existing.id;end if;end if;
 '||a);
 d=replace(d,'if bid is not null then perform public.jev_batch_wake(bid);end if;','if bid is not null then insert into private.shared_jev_sync_bindings values(p_job,bid) on conflict do nothing;perform public.jev_batch_wake(bid);end if;');
 execute d;
 -- Compare-and-set normalization protects a worker that read before coalescing.
 d=pg_get_functiondef('public.jev_shared_normalize_auto(uuid,jsonb,text)'::regprocedure);
 d=replace(d,'p_sha text)','p_sha text, p_expected_sha text default null)');
 d=replace(d,'if jsonb_array_length(p_snapshot','if p_expected_sha is not null and b.snapshot_sha256 is distinct from p_expected_sha then perform public.jev_batch_wake(b.id);return false;end if; if jsonb_array_length(p_snapshot');
 execute d;
end $patch$;
drop function public.jev_shared_normalize_auto(uuid,jsonb,text);
revoke all on function public.jev_shared_normalize_auto(uuid,jsonb,text,text),private.automatic_report_context(uuid) from public,anon,authenticated;
grant execute on function public.jev_shared_normalize_auto(uuid,jsonb,text,text),private.automatic_report_context(uuid) to service_role;

-- Metadata-only initialization. No claims, dispatch, analysis, or report mutation.
do $$ declare p public.current_report_publications;begin
 for p in select * from public.current_report_publications loop perform private.capture_report_coverage(p);end loop;
end $$;
revoke all on function private.capture_report_coverage(public.current_report_publications),private.report_refresh_counts(uuid,text),private.pin_automatic_report_origin(),private.maybe_refresh_report(uuid,text),private.capture_report_coverage_trigger(),private.refresh_after_report_close(),private.record_automatic_batch_failure(),private.check_automatic_reports(),public.read_report_refresh_state(uuid,text) from public,anon,authenticated;
grant execute on function private.report_refresh_counts(uuid,text),private.maybe_refresh_report(uuid,text),private.check_automatic_reports(),public.read_report_refresh_state(uuid,text) to service_role;
commit;
