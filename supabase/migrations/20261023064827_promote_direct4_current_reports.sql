-- Routing only; no generation, consent, paid task or provider wake on migration.
create table public.report_pipeline_settings(id boolean primary key default true check(id),engine text not null check(engine in('sol_legacy','jev_sol_v2')),updated_at timestamptz not null default now(),reason text not null);
insert into public.report_pipeline_settings values(true,'sol_legacy',now(),'Staged deployment; activation follows non-spending verification');
create table public.report_pipeline_events(id bigint generated always as identity primary key,engine text not null,reason text not null,created_at timestamptz not null default now());
create table public.report_generation_requests(
 id uuid primary key,organization_id uuid not null references public.organizations(id),establishment_id uuid not null references public.establishments(id),
 authority_user_id uuid not null references auth.users(id),language text not null check(language in('fr','vi')),engine text not null check(engine in('sol_legacy','jev_sol_v2')),
 source_run_id uuid unique not null references public.historical_report_runs(id),comparison_id uuid unique references public.analysis_parallel_reports(id),created_at timestamptz not null default now());
create index report_request_scope on public.report_generation_requests(organization_id,establishment_id,language,created_at desc);
alter table public.report_pipeline_settings enable row level security;
alter table public.report_pipeline_events enable row level security;
alter table public.report_generation_requests enable row level security;
revoke all on public.report_pipeline_settings,public.report_pipeline_events,public.report_generation_requests from public,anon,authenticated;
grant select on public.report_pipeline_settings,public.report_generation_requests to authenticated;
grant all on public.report_pipeline_settings,public.report_pipeline_events,public.report_generation_requests to service_role;
grant usage,select on sequence public.report_pipeline_events_id_seq to service_role;
create policy configuration_read on public.report_pipeline_settings for select to authenticated using(true);
create policy server_audit_only on public.report_pipeline_events for select to authenticated using(false);
create policy organization_read on public.report_generation_requests for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=report_generation_requests.organization_id and m.user_id=(select auth.uid())));
create trigger report_pipeline_events_immutable before update or delete on public.report_pipeline_events for each row execute function public.pilot_evidence_immutable();
create function public.set_current_report_pipeline(p_engine text,p_reason text) returns text language plpgsql set search_path='' as $$begin
 if current_user<>'service_role' or p_engine not in('sol_legacy','jev_sol_v2') or length(btrim(p_reason))<12 then raise exception 'FORBIDDEN';end if;
 update public.report_pipeline_settings set engine=p_engine,reason=p_reason,updated_at=now() where id;
 insert into public.report_pipeline_events(engine,reason) values(p_engine,p_reason);return p_engine;end $$;
revoke all on function public.set_current_report_pipeline(text,text) from public,anon,authenticated;
grant execute on function public.set_current_report_pipeline(text,text) to service_role;

-- Current generations have a frozen source run, not a fabricated Sol report.
alter table public.analysis_parallel_reports alter column reference_report_id drop not null;
alter table public.analysis_parallel_reports add column current_source_run_id uuid unique references public.historical_report_runs(id);
alter table public.analysis_parallel_reports add constraint parallel_source_required check(reference_report_id is not null or current_source_run_id is not null) not valid;
alter table public.analysis_parallel_launch_preparations alter column reference_report_id drop not null;
alter table public.analysis_parallel_launch_preparations add column current_source_run_id uuid unique references public.historical_report_runs(id);
alter table public.analysis_parallel_launch_preparations add constraint parallel_preparation_source_required check(reference_report_id is not null or current_source_run_id is not null) not valid;

create function public.guard_report_request() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or (to_jsonb(new)-'comparison_id') is distinct from (to_jsonb(old)-'comparison_id') or old.comparison_id is not null then raise exception 'REPORT_REQUEST_IMMUTABLE';end if;return new;end $$;
create trigger report_request_immutable before update or delete on public.report_generation_requests for each row execute function public.guard_report_request();

create function public.enqueue_current_report(p_establishment uuid,p_organization uuid,p_user uuid,p_language text,p_request uuid,p_legacy_model text,p_legacy_version int) returns public.historical_report_runs
language plpgsql set search_path='' set jit='off' as $$
declare r public.historical_report_runs;q public.report_generation_requests;e text;begin
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
 if exists(select 1 from public.report_generation_requests req join public.analysis_parallel_reports pair on pair.id=req.comparison_id join public.analysis_jls_sol_ready_operations op on op.run_id=pair.run_id
 where req.organization_id=p_organization and req.establishment_id=p_establishment and req.language=p_language and op.request_count=1 and (op.status='billing_uncertain' or op.receipt is null)) then raise exception 'REPORT_PREVIOUS_OUTCOME_UNCERTAIN';end if;
 if exists(select 1 from public.analysis_parallel_reports pair join public.analysis_jls_restaurant_runs j on j.id=pair.run_id where pair.establishment_id=p_establishment and pair.language=p_language and j.status in('queued','running')) then raise exception 'REPORT_OTHER_PIPELINE_RUNNING';end if;
 select engine into e from public.report_pipeline_settings where id for share;
 if e='jev_sol_v2' then
  insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model)
  values(p_organization,p_establishment,p_language,p_user,'queued','{"analysis_version":8,"english_translation_override_policy":"verified_english_translation_overrides_v1"}', 'gpt-6.1-sol') returning * into r;
 else
  if exists(select 1 from public.historical_report_runs where establishment_id=p_establishment and language=p_language and error_code='REPORT_BILLING_UNCERTAIN_NO_RETRY') then raise exception 'REPORT_BILLING_UNCERTAIN_NO_RETRY';end if;
  r=public.enqueue_historical_report(p_establishment,p_organization,p_user,p_language,p_legacy_model,p_legacy_version);
 end if;
 insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id) values(p_request,p_organization,p_establishment,p_user,p_language,e,r.id);return r;
end $$;
revoke all on function public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,int) from public,anon,authenticated;
grant execute on function public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,int) to service_role;

alter function public.check_parallel_protocol(jsonb) rename to check_parallel_protocol_comparison;
create function public.check_parallel_protocol(b jsonb) returns boolean language sql stable set search_path='' set jit='off' as $$
 select coalesce(case when b?'current_delivery' then
 b->>'production_enabled'='true' and b#>>'{current_delivery,version}'='jev-short-sol-compact-v2'
 and b#>>'{current_delivery,source_run_id}'=b#>>'{reference,historical_run_id}' and b#>>'{current_delivery,generation_id}'=b#>>'{reference,generation_id}'
 and b#>>'{frozen_report,ai_status}'='source_frozen'
 and exists(select 1 from public.report_generation_requests q where q.id=(b#>>'{current_delivery,request_id}')::uuid and q.source_run_id=(b#>>'{current_delivery,source_run_id}')::uuid and q.engine='jev_sol_v2' and q.organization_id=(b->>'organization_id')::uuid and q.establishment_id=(b->>'establishment_id')::uuid and q.authority_user_id=(b->>'authority_user_id')::uuid and q.language=b->>'language')
 and public.check_parallel_protocol_comparison(jsonb_set(b,'{production_enabled}','false'))
 else public.check_parallel_protocol_comparison(b) end,false);
$$;

create function public.prepare_current_v2_protocol(p_source uuid,p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' set jit='off' as $$
declare r public.historical_report_runs;q public.report_generation_requests;v uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.historical_report_runs where id=p_source;
 select * into q from public.report_generation_requests where source_run_id=r.id and engine='jev_sol_v2';
 if q.id is null or r.status not in('queued','running','retry') or r.created_at+interval '24 hours'<=now() or q.comparison_id is not null
 or not public.check_parallel_protocol(p_body) or public.jls_restaurant_hash(p_body)<>p_sha
 or p_body#>>'{current_delivery,request_id}'<>q.id::text or p_body#>>'{current_delivery,source_run_id}'<>r.id::text
 or p_body#>>'{reference,generation_id}'<>r.generation_id::text or p_body#>>'{reference,report_id}'<>r.id::text
 or p_body#>>'{reference,source_fingerprint}' is distinct from r.snapshot#>>'{base,source_fingerprint}'
 or p_body->'frozen_report' is distinct from ((r.snapshot->'base')||jsonb_build_object('id',r.id,'generation_id',r.generation_id,'preferred_language',r.language,'ai_status','source_frozen','ai_model',null,'consultant_report',null))
 or jsonb_array_length(p_body#>'{source_snapshot,reviews}')<>jsonb_array_length(r.snapshot->'reviews')
 or (select count(distinct value->>'id') from jsonb_array_elements(p_body#>'{source_snapshot,reviews}'))<>jsonb_array_length(r.snapshot->'reviews') then raise exception 'CURRENT_V2_SOURCE_CHANGED';end if;
 if exists(with src as materialized(select value v from jsonb_array_elements(r.snapshot->'reviews')),dst as materialized(select value v from jsonb_array_elements(p_body#>'{source_snapshot,reviews}'))
 select 1 from dst left join src on src.v->>'id'=dst.v->>'id' where src.v is null
 or dst.v->>'original_text' is distinct from coalesce(src.v->>'original_text',src.v->>'text','')
 or dst.v->>'analysis_text' is distinct from nullif(src.v->>'analysis_text','') or dst.v->'rating' is distinct from src.v->'rating'
 or dst.v->'review_context' is distinct from src.v->'review_context' or dst.v->'review_detailed_rating' is distinct from src.v->'review_detailed_rating'
 or dst.v->'published_at' is distinct from src.v->'published_at' or dst.v->'analysis_source' is distinct from src.v->'analysis_source' or dst.v->'analysis_language' is distinct from src.v->'analysis_language'
 or dst.v->>'organization_id'<>q.organization_id::text or dst.v->>'establishment_id'<>q.establishment_id::text
 or dst.v->>'original_text_sha256' is distinct from encode(extensions.digest(dst.v->>'original_text','sha256'),'hex')
 or dst.v->>'analysis_text' is not null and dst.v->>'analysis_text_sha256' is distinct from encode(extensions.digest(dst.v->>'analysis_text','sha256'),'hex')) then raise exception 'CURRENT_V2_TEXT_CHANGED';end if;
 if exists(with src as materialized(select value v from jsonb_array_elements(p_body#>'{source_snapshot,reviews}')),tasks as materialized(select value v from jsonb_array_elements(p_body->'pending'))
 select 1 from tasks left join src on src.v->>'id'=tasks.v->>'review_id' where src.v->>'analysis_text' is null
 or tasks.v#>>'{payload,state,analysis_text}' is distinct from src.v->>'analysis_text' or tasks.v#>>'{payload,model}' is distinct from 'jev-1.13.0'
 or tasks.v#>'{payload,questions}' is distinct from p_body#>'{configuration,jev,questions}' or tasks.v->>'request_sha256' is distinct from public.jls_restaurant_hash(tasks.v->'payload')
 or tasks.v#>>'{identity,analysis_text_sha256}' is distinct from src.v->>'analysis_text_sha256' or tasks.v#>>'{identity,configuration_sha256}' is distinct from p_body->>'classification_configuration_sha256') then raise exception 'CURRENT_V2_REQUEST_CHANGED';end if;
 insert into public.analysis_parallel_launch_preparations(organization_id,authority_user_id,reference_generation_id,current_source_run_id,body,sha256) values(q.organization_id,q.authority_user_id,r.generation_id,r.id,p_body,p_sha)
 on conflict(current_source_run_id) do nothing returning id into v;
 if v is null then select id into v from public.analysis_parallel_launch_preparations where current_source_run_id=r.id and sha256=p_sha and body=p_body;end if;
 if v is null then raise exception 'CURRENT_V2_SEALED_PROTOCOL_CHANGED';end if;return v;
end $$;
revoke all on function public.prepare_current_v2_protocol(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.prepare_current_v2_protocol(uuid,jsonb,text) to service_role;
revoke all on function public.check_parallel_protocol(jsonb) from public,anon,authenticated;
grant execute on function public.check_parallel_protocol(jsonb) to service_role;

-- Preserve the frozen current corpus after its first free snapshot step.
create function public.guard_current_v2_snapshot() returns trigger language plpgsql set search_path='' as $$begin
 if old.snapshot?'reviews' and new.snapshot is distinct from old.snapshot and exists(select 1 from public.report_generation_requests where source_run_id=old.id and engine='jev_sol_v2') then raise exception 'CURRENT_V2_SNAPSHOT_IMMUTABLE';end if;return new;end $$;
create trigger current_v2_snapshot_immutable before update on public.historical_report_runs for each row execute function public.guard_current_v2_snapshot();

do $$declare d text;a text;b text;expr text;begin
 -- Existing CHECKs reference function OIDs, so explicitly rebind the renamed
 -- comparison checker to the version-aware checker. Keep every other branch.
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 if position('check_parallel_protocol_comparison' in expr)=0 then raise exception 'CURRENT_PROTOCOL_CHECK_ANCHOR_CHANGED';end if;
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check check ('||replace(expr,'check_parallel_protocol_comparison','check_parallel_protocol')||') not valid';
 d=pg_get_functiondef('public.claim_historical_report_jobs(uuid,integer)'::regprocedure);
 a='where status in (''queued'',''running'',''retry'') and (lease_until is null or lease_until<=now())';
 if position(a in d)=0 then raise exception 'CURRENT_PREPARATION_CLAIM_CHANGED';end if;
 execute replace(d,a,'where not exists(select 1 from public.report_generation_requests req where req.source_run_id=historical_report_runs.id and req.engine=''jev_sol_v2'' and req.comparison_id is not null) and status in (''queued'',''running'',''retry'') and (lease_until is null or lease_until<=now())');
 d=pg_get_functiondef('public.start_parallel_report_internal(jsonb,text,uuid,jsonb)'::regprocedure);
 a='declare certified boolean=false;';if position(a in d)=0 then raise exception 'CURRENT_START_DECLARATION_CHANGED';end if;
 d=replace(d,a,a||'is_current boolean=p_body?''current_delivery'';rq public.report_generation_requests;src public.historical_report_runs;');
 a=' select * into cur from public.historical_establishment_reports where id=(p_body->''reference''->>''report_id'')::uuid for share;';
 if position(a in d)=0 then raise exception 'CURRENT_START_SOURCE_CHANGED';end if;
 b=' if is_current then
  if p_delegation is not null then raise exception ''CURRENT_BUTTON_REQUIRED'';end if;
  select * into rq from public.report_generation_requests where id=(p_body#>>''{current_delivery,request_id}'')::uuid and source_run_id=(p_body#>>''{current_delivery,source_run_id}'')::uuid and authority_user_id=p_user and engine=''jev_sol_v2'';
  select * into src from public.historical_report_runs where id=rq.source_run_id;
  select exists(select 1 from public.analysis_parallel_launch_preparations where current_source_run_id=src.id and sha256=p_sha and body=p_body and authority_user_id=p_user) into certified;
  if rq.id is null or not certified or src.requested_by<>p_user then raise exception ''CURRENT_V2_UNCERTIFIED_SOURCE'';end if;
  if rq.comparison_id is not null then return rq.comparison_id;end if;
  if src.status not in(''queued'',''running'',''retry'') or src.created_at+interval ''24 hours''<=now() then raise exception ''CURRENT_V2_REQUEST_EXPIRED'';end if;
  cur=jsonb_populate_record(null::public.historical_establishment_reports,p_body->''frozen_report'');
 else '||a||' end if;';
 d=replace(d,a,b);
 d=replace(d,'cur.ai_status<>''completed''','(not is_current and cur.ai_status<>''completed'')');
 d=replace(d,'to_jsonb(cur) is distinct from p_body->''frozen_report''','(not is_current and to_jsonb(cur) is distinct from p_body->''frozen_report'')');
 a=' perform pg_advisory_xact_lock(hashtextextended(cur.id::text||cur.generation_id::text||cur.preferred_language,0));';
 if position(a in d)=0 then raise exception 'CURRENT_START_LOCK_CHANGED';end if;
 d=replace(d,a,' perform pg_advisory_xact_lock(hashtextextended(''historical-enqueue:''||cur.establishment_id::text||'':''||cur.preferred_language,0));
 if not is_current and exists(select 1 from public.report_generation_requests q join public.historical_report_runs hr on hr.id=q.source_run_id where q.establishment_id=cur.establishment_id and q.language=cur.preferred_language and hr.status in(''queued'',''running'',''retry'')) then raise exception ''REPORT_OTHER_PIPELINE_RUNNING'';end if;'||a);
 a='''created_at'',now(),''expires_at'',now()+interval ''24 hours''';
 if position(a in d)=0 then raise exception 'CURRENT_START_EXPIRY_CHANGED';end if;
 d=replace(d,a,'''created_at'',case when is_current then src.created_at else now() end,''expires_at'',case when is_current then src.created_at+interval ''24 hours'' else now()+interval ''24 hours'' end');
 a='insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,protocol_id,run_id,corpus_sha256,source_report,source_reviews)';
 if position(a in d)=0 then raise exception 'CURRENT_START_PUBLICATION_CHANGED';end if;
 d=replace(d,a,'insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,protocol_id,run_id,corpus_sha256,source_report,source_reviews,current_source_run_id)');
 a='values(cur.organization_id,cur.establishment_id,cur.id,cur.generation_id,cur.preferred_language,p,r,p_body->''source_snapshot''->>''source_reviews_sha256'',p_body->''frozen_report'',p_body->''source_snapshot''->''reviews'') returning id into p;';
 if position(a in d)=0 then raise exception 'CURRENT_START_VALUES_CHANGED';end if;
 d=replace(d,a,'values(cur.organization_id,cur.establishment_id,case when is_current then null else cur.id end,cur.generation_id,cur.preferred_language,p,r,p_body->''source_snapshot''->>''source_reviews_sha256'',p_body->''frozen_report'',p_body->''source_snapshot''->''reviews'',case when is_current then src.id else null end) returning id into p;
 if is_current then
  update public.report_generation_requests set comparison_id=p where id=rq.id;
  update public.historical_report_runs set status=''running'',locked_by=null,lease_until=null,updated_at=now() where id=src.id;
 end if;');
 execute d;
end $$;

create function public.sync_current_v2_generation() returns trigger language plpgsql set search_path='' as $$
declare pair public.analysis_parallel_reports;st text;ec text;begin
 if tg_table_name='analysis_parallel_reports' then pair=new;st=new.state;ec=new.error_code;
 else select * into pair from public.analysis_parallel_reports where run_id=new.id;st=new.status;ec=new.error_code;end if;
 if pair.current_source_run_id is null then return new;end if;
 if st in('blocked','billing_uncertain','authorization_expired','invalid_output') then
  update public.historical_report_runs set status='failed',error_code=coalesce(ec,st),last_error=coalesce(ec,st),locked_by=null,lease_until=null,completed_at=now(),updated_at=now() where id=pair.current_source_run_id and status in('queued','running','retry');
 elsif pair.derived_report is not null and st in('completed','needs_review') then
  update public.historical_report_runs set status='completed',error_code=ec,last_error=ec,locked_by=null,lease_until=null,completed_at=now(),updated_at=now() where id=pair.current_source_run_id and status in('queued','running','retry');
 end if;return new;end $$;
create trigger current_v2_publication_status after update of derived_report,state on public.analysis_parallel_reports for each row execute function public.sync_current_v2_generation();
create trigger current_v2_execution_status after update of status on public.analysis_jls_restaurant_runs for each row execute function public.sync_current_v2_generation();

-- No default PUBLIC execute on new helper/trigger functions.
revoke all on function public.guard_report_request(),public.guard_current_v2_snapshot(),public.sync_current_v2_generation() from public,anon,authenticated;
grant execute on function public.guard_report_request(),public.guard_current_v2_snapshot(),public.sync_current_v2_generation() to service_role;
