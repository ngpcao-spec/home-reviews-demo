-- Independent application variant. No enqueue, consent, provider call or wake at deployment.
create table public.analysis_parallel_reports(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id), reference_report_id uuid not null references public.historical_establishment_reports(id),
 reference_generation_id uuid not null, language text not null check(language in('fr','vi')), configuration_version text not null default 'jls-direct4-parallel-no-luna-v1',
 protocol_id uuid unique references public.analysis_jls_restaurant_protocols(id), run_id uuid unique references public.analysis_jls_restaurant_runs(id),
 corpus_sha256 text not null, source_report jsonb not null, source_reviews jsonb not null,
 imported_derivative_id uuid unique, source_archive_id uuid references public.analysis_jls_snapshot_preparations(id),
 raw_response jsonb, original_report jsonb, derived_report jsonb, corrections jsonb, controls jsonb, statistics jsonb, usage jsonb,
 state text not null default 'queued', error_code text, generated_at timestamptz, created_at timestamptz not null default now(),
 unique(organization_id,reference_report_id,reference_generation_id,language,configuration_version),
 check(corpus_sha256=public.jls_restaurant_hash(source_reviews)), check((protocol_id is null)=(run_id is null)));
create index parallel_reports_establishment on public.analysis_parallel_reports(organization_id,establishment_id,language,created_at desc);
create table public.analysis_parallel_jev_cache(
 organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id),review_id uuid not null,
 analysis_text_sha256 text not null,configuration_sha256 text not null,model text not null check(model='jev-1.13.0'),
 task_id uuid not null references public.analysis_jls_restaurant_tasks(id),status text not null check(status in('reserved','completed','uncertain')),
 body jsonb,sha256 text,created_at timestamptz not null default now(),
 primary key(organization_id,establishment_id,review_id,analysis_text_sha256,configuration_sha256,model));
create index parallel_cache_task on public.analysis_parallel_jev_cache(task_id);
do $$declare t text;begin
 foreach t in array array['analysis_parallel_reports','analysis_parallel_jev_cache'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy organization_read on public.%I for select to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())))',t,t);
 end loop;end $$;

create function public.check_parallel_protocol(b jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(b->>'version'='jls-direct4-parallel-no-luna-v1'
 and b->>'max_luna_calls'='0' and b->>'max_sol_calls'='1' and b->>'max_apify_calls'='0' and b->>'automatic_retry'='false' and b->>'production_enabled'='false'
 and b->>'classification_configuration_sha256'='84e19915b4b01af0bca311790f5a531ae23984b2d4a8cbc7d6340417ff299651'
 and public.jls_restaurant_hash(b->'configuration'->'jev')=b->>'classification_configuration_sha256'
 and public.jls_restaurant_hash(b->'configuration')=b->>'configuration_sha256'
 and public.jls_restaurant_hash(b->'source_snapshot')=b->>'source_snapshot_sha256'
 and public.jls_restaurant_hash(b->'source_snapshot'->'reviews')=b->'source_snapshot'->>'source_reviews_sha256'
 and public.jls_restaurant_hash(b->'pending')=b->>'pending_sha256'
 and jsonb_array_length(b->'pending')=(b->>'max_jev_calls')::int
 and jsonb_array_length(b->'source_snapshot'->'reviews')=(b->'denominators'->>'source_reviews')::int
 and (b->'denominators'->>'analytical_reviews')::int+(b->'denominators'->>'textless_statistics_only')::int=(b->'denominators'->>'source_reviews')::int
 and b->'reference'->>'report_sha256'=public.jls_restaurant_hash(b->'frozen_report')
 and b->'frozen_report'->>'organization_id'=b->>'organization_id' and b->'frozen_report'->>'establishment_id'=b->>'establishment_id',false)
$$;
do $$declare expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check check (('||expr||') or (body->>''version''=''jls-direct4-parallel-no-luna-v1'' and establishment_id=(body->>''establishment_id'')::uuid and organization_id=(body->>''organization_id'')::uuid and authority_user_id=(body->>''authority_user_id'')::uuid and public.check_parallel_protocol(body))) not valid';
end $$;

create function public.start_parallel_report(p_body jsonb,p_sha text,p_user uuid) returns uuid language plpgsql set search_path='' as $$
declare h public.historical_report_runs;cur public.historical_establishment_reports;pair public.analysis_parallel_reports;p uuid;r uuid;v jsonb;x jsonb;c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into cur from public.historical_establishment_reports where id=(p_body->'reference'->>'report_id')::uuid for share;
 if cur.id is null or cur.ai_status<>'completed' or cur.generation_id::text is distinct from p_body->'reference'->>'generation_id'
 or to_jsonb(cur) is distinct from p_body->'frozen_report' or p_body->>'authority_user_id' is distinct from p_user::text
 or cur.organization_id::text is distinct from p_body->>'organization_id' or cur.establishment_id::text is distinct from p_body->>'establishment_id'
 or cur.preferred_language is distinct from p_body->>'language' or not public.check_parallel_protocol(p_body) or public.jls_restaurant_hash(p_body)<>p_sha
 or not exists(select 1 from public.organization_members where organization_id=cur.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'PARALLEL_SOURCE_OR_ACCESS_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(cur.id::text||cur.generation_id::text||cur.preferred_language,0));
 select * into pair from public.analysis_parallel_reports where reference_report_id=cur.id and reference_generation_id=cur.generation_id and language=cur.preferred_language and configuration_version=p_body->>'version';
 if pair.id is not null then return pair.id;end if;
 select * into h from public.historical_report_runs where id=(p_body->'reference'->>'historical_run_id')::uuid and generation_id=cur.generation_id and status='completed' and organization_id=cur.organization_id and establishment_id=cur.establishment_id;
 if h.id is null or jsonb_array_length(h.snapshot->'reviews')<>jsonb_array_length(p_body->'source_snapshot'->'reviews')
 or (select count(distinct value->>'id') from jsonb_array_elements(p_body->'source_snapshot'->'reviews'))<>cur.stored_reviews_count
 or (select count(*) from jsonb_array_elements(p_body->'source_snapshot'->'reviews') where value->>'analysis_text' is not null)<>(p_body->>'max_jev_calls')::int then raise exception 'PARALLEL_CORPUS_UNAVAILABLE';end if;
 for v in select value from jsonb_array_elements(p_body->'source_snapshot'->'reviews') loop
  select value into x from jsonb_array_elements(h.snapshot->'reviews') where value->>'id'=v->>'id';
  if x is null or v->>'original_text' is distinct from coalesce(x->>'original_text','') or v->>'analysis_text' is distinct from nullif(x->>'analysis_text','')
   or v->'rating' is distinct from x->'rating' or v->'review_detailed_rating' is distinct from x->'review_detailed_rating' or v->'review_context' is distinct from x->'review_context'
   or v->'analysis_source' is distinct from x->'analysis_source' or v->'analysis_language' is distinct from x->'analysis_language'
   or v->>'organization_id'<>cur.organization_id::text or v->>'establishment_id'<>cur.establishment_id::text
   or v->>'original_text_sha256' is distinct from encode(extensions.digest(v->>'original_text','sha256'),'hex')
   or v->>'analysis_text' is not null and v->>'analysis_text_sha256' is distinct from encode(extensions.digest(v->>'analysis_text','sha256'),'hex') then raise exception 'PARALLEL_CORPUS_CHANGED';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_body->'pending') loop
  select value into x from jsonb_array_elements(p_body->'source_snapshot'->'reviews') where value->>'id'=v->>'review_id';
  if x->>'analysis_text' is null or v->'payload'->'state'->>'analysis_text' is distinct from x->>'analysis_text'
   or v->'payload'->>'model' is distinct from 'jev-1.13.0' or v->'payload'->'questions' is distinct from p_body->'configuration'->'jev'->'questions'
   or v->>'request_sha256' is distinct from public.jls_restaurant_hash(v->'payload') or v->'identity'->>'configuration_sha256' is distinct from p_body->>'classification_configuration_sha256'
   or v->'identity'->>'analysis_text_sha256' is distinct from x->>'analysis_text_sha256' then raise exception 'PARALLEL_REQUEST_CHANGED';end if;
 end loop;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256) values(cur.organization_id,cur.establishment_id,p_user,p_body,p_sha) returning id into p;
 -- Seed only exact short-configuration, served-model and text-compatible saved receipts.
 insert into public.analysis_parallel_jev_cache(organization_id,establishment_id,review_id,analysis_text_sha256,configuration_sha256,model,task_id,status,body,sha256)
 select distinct on(t.review_id,t.identity->>'analysis_text_sha256') t.organization_id,oldp.establishment_id,t.review_id,t.identity->>'analysis_text_sha256',p_body->>'classification_configuration_sha256','jev-1.13.0',t.id,'completed',a.body,a.sha256
 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_runs oldr on oldr.id=t.run_id join public.analysis_jls_restaurant_protocols oldp on oldp.id=oldr.protocol_id
 join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
 where t.organization_id=cur.organization_id and oldp.establishment_id=cur.establishment_id and t.phase='jev' and t.status='completed'
 and oldr.consent->>'consent_source'<>'technical_qualification_no_spending' and not public.is_jls_sql_qualification(oldr.id)
 and oldp.body->>'classification_configuration_sha256'=p_body->>'classification_configuration_sha256' and t.identity->>'configuration_sha256'=p_body->>'classification_configuration_sha256'
 and a.body->'direct4_result'->>'model'='jev-1.13.0' and a.sha256=public.jls_restaurant_hash(a.body)
 and exists(select 1 from jsonb_array_elements(p_body->'pending') seed_entry(value) where seed_entry.value->>'review_id'=t.review_id::text and seed_entry.value->'identity'->>'analysis_text_sha256'=t.identity->>'analysis_text_sha256')
 order by t.review_id,t.identity->>'analysis_text_sha256',t.completed_at desc on conflict do nothing;
 c=jsonb_build_object('consent_source','user_in_app_button','protocol_id',p,'protocol_sha256',p_sha,'user_id',p_user,'created_at',now(),'expires_at',now()+interval '24 hours',
  'scope',jsonb_build_object('max_jev_calls',p_body->'max_jev_calls','max_luna_calls',0,'max_sol_calls',1,'max_apify_calls',0,'automatic_retry',false));
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at) values(p,cur.organization_id,c,public.jls_restaurant_hash(c),now()+interval '24 hours') returning id into r;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
 select r,cur.organization_id,'jev',value->>'review_id',(value->>'review_id')::uuid,value->'payload',value->>'request_sha256',value->'identity' from jsonb_array_elements(p_body->'pending');
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,protocol_id,run_id,corpus_sha256,source_report,source_reviews)
 values(cur.organization_id,cur.establishment_id,cur.id,cur.generation_id,cur.preferred_language,p,r,p_body->'source_snapshot'->>'source_reviews_sha256',p_body->'frozen_report',p_body->'source_snapshot'->'reviews') returning id into p;
 return p;
end $$;

create function public.claim_parallel_report_task(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;c public.analysis_parallel_jev_cache;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p.body->>'version'<>'jls-direct4-parallel-no-luna-v1' or not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() then return null;end if;
 loop
  select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
  if t.id is null then return null;end if;
  if t.phase not in('jev','sol') or t.request_sha256<>public.jls_restaurant_hash(t.request) then raise exception 'PARALLEL_REQUEST_CHANGED';end if;
  if t.phase='jev' then
   if not exists(select 1 from jsonb_array_elements(p.body->'pending') x where x->>'review_id'=t.review_id::text and x->>'request_sha256'=t.request_sha256 and x->'identity'=t.identity) then raise exception 'PARALLEL_MANIFEST_CHANGED';end if;
   if exists(select 1 from public.analysis_jls_restaurant_tasks oldt join public.analysis_jls_restaurant_runs oldr on oldr.id=oldt.run_id join public.analysis_jls_restaurant_protocols oldp on oldp.id=oldr.protocol_id
    where oldt.run_id<>r.id and oldt.organization_id=r.organization_id and oldp.establishment_id=p.establishment_id and oldt.review_id=t.review_id and oldt.phase='jev' and oldt.request_count=1 and oldt.status not in('completed','reused')
    and oldp.body->>'classification_configuration_sha256'=p.body->>'classification_configuration_sha256' and oldt.identity->>'analysis_text_sha256'=t.identity->>'analysis_text_sha256'
    and oldr.consent->>'consent_source'<>'technical_qualification_no_spending' and not public.is_jls_sql_qualification(oldr.id)) then raise exception 'PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN';end if;
   insert into public.analysis_parallel_jev_cache(organization_id,establishment_id,review_id,analysis_text_sha256,configuration_sha256,model,task_id,status)
   values(r.organization_id,p.establishment_id,t.review_id,t.identity->>'analysis_text_sha256',p.body->>'classification_configuration_sha256','jev-1.13.0',t.id,'reserved') on conflict do nothing;
   select * into c from public.analysis_parallel_jev_cache where organization_id=r.organization_id and establishment_id=p.establishment_id and review_id=t.review_id and analysis_text_sha256=t.identity->>'analysis_text_sha256' and configuration_sha256=p.body->>'classification_configuration_sha256' and model='jev-1.13.0' for update;
   if c.status='completed' then
    if c.sha256 is distinct from public.jls_restaurant_hash(c.body) then raise exception 'PARALLEL_CACHE_CHANGED';end if;
    insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values(r.id,r.organization_id,'task:'||t.id,c.body,c.sha256) on conflict do nothing;
    update public.analysis_jls_restaurant_tasks set status='reused',completed_at=now() where id=t.id;continue;
   end if;
   if c.task_id<>t.id or c.status<>'reserved' then raise exception 'PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN';end if;
  elsif not exists(select 1 from public.analysis_jls_sol_ready_artifacts a where a.source_run_id=r.id and a.body->>'request_sha256'=t.request_sha256) then raise exception 'PARALLEL_SOL_NOT_READY';end if;
  if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=t.phase and request_count=1)>=(case when t.phase='jev' then (p.body->>'max_jev_calls')::int else 1 end) then raise exception 'JLS_CALL_LIMIT';end if;
  update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now() where id=t.id returning * into t;return to_jsonb(t);
 end loop;
end $$;

create function public.capture_parallel_jev_cache() returns trigger language plpgsql set search_path='' as $$
declare b jsonb;h text;begin
 if new.phase<>'jev' or new.status not in('completed','invalid_output','billing_uncertain','blocked') or not exists(select 1 from public.analysis_parallel_jev_cache where task_id=new.id) then return new;end if;
 select body,sha256 into b,h from public.analysis_jls_restaurant_artifacts where run_id=new.run_id and kind='task:'||new.id;
 update public.analysis_parallel_jev_cache set status=case when new.status='completed' then 'completed' else 'uncertain' end,body=b,sha256=h where task_id=new.id and status='reserved';return new;
end $$;
create trigger capture_parallel_jev after update of status on public.analysis_jls_restaurant_tasks for each row when(old.status is distinct from new.status) execute function public.capture_parallel_jev_cache();

create function public.stage_parallel_report(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() or r.stage<>'jev' or p_stage<>'prepare_evidence' or p_tasks<>'[]'::jsonb
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='jev' and status not in('completed','reused')) then return false;end if;
 update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;
end $$;
create function public.check_parallel_ready(b jsonb) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id
 join public.analysis_jls_sol_ready_artifacts a on a.source_run_id=r.id
 where p.body->>'version'='jls-direct4-parallel-no-luna-v1' and r.id=(b->>'source_run_id')::uuid and p.id=(b->>'source_protocol_id')::uuid
 and p.sha256=b->>'source_protocol_sha256' and a.body=b and a.sha256=public.jls_restaurant_hash(b))
$$;
create function public.prepare_parallel_ready(p_run uuid,p_worker text,p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;a uuid;t uuid;op uuid;e jsonb;s jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 select id into op from public.analysis_jls_sol_ready_operations where run_id=r.id;if op is not null then return op;end if;
 if p.body->>'version'<>'jls-direct4-parallel-no-luna-v1' or not public.jls_restaurant_valid(r.id) or r.stage<>'prepare_evidence' or r.worker is distinct from p_worker or r.lease_until<=now()
 or p_body->>'version'<>p.body->>'version' or p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'source_protocol_id'<>p.id::text or p_body->>'source_protocol_sha256'<>p.sha256 or p_body->>'source_run_id'<>r.id::text
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='jev' and status not in('completed','reused'))
 or p_body->>'statistics_sha256'<>public.jls_restaurant_hash(p_body->'statistics')
 or (p_body->'statistics'->'scope'->>'analysed_text_reviews')::int<>(p.body->'denominators'->>'analytical_reviews')::int
 or (p_body->'statistics'->'scope'->>'source_reviews')::int<>(p.body->'denominators'->>'source_reviews')::int
 or p_body->>'request_raw_sha256'<>encode(extensions.digest(p_body->>'request_json','sha256'),'hex')
 or p_body->>'request_sha256'<>public.jls_restaurant_hash((p_body->>'request_json')::jsonb)
 or (p_body->>'request_json')::jsonb->>'model'<>'gpt-6.1-sol'
 or (p_body->'measurement'->>'guarded_input_tokens')::int>32768
 or jsonb_array_length(p_body->'evidence') not between 1 and 32 then raise exception 'PARALLEL_SOL_NOT_READY';end if;
 for e in select value from jsonb_array_elements(p_body->'evidence') loop
  select value into s from jsonb_array_elements(p.body->'source_snapshot'->'reviews') where value->>'id'=e->>'review_id';
  if s is null or s->>'analysis_text_sha256'<>e->>'analysis_text_sha256' or e->>'quote_sha256'<>encode(extensions.digest(e->>'quote','sha256'),'hex')
   or substring(s->>'analysis_text' from (e->>'quote_start')::int+1 for (e->>'quote_end')::int-(e->>'quote_start')::int)<>e->>'quote' then raise exception 'PARALLEL_QUOTE_CHANGED';end if;
 end loop;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256) values(r.organization_id,p.id,r.id,p_body,p_sha) returning id into a;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256) values(r.id,r.organization_id,'sol','sol',(p_body->>'request_json')::jsonb,p_body->>'request_sha256') returning id into t;
 insert into public.analysis_jls_sol_ready_operations(artifact_id,protocol_id,protocol_sha256,run_id,task_id,organization_id,mode,phase,status) values(a,p.id,p.sha256,r.id,t,r.organization_id,'paid','sol','queued') returning id into op;
 update public.analysis_jls_restaurant_runs set stage='sol' where id=r.id;return op;
end $$;

-- Add only a version dispatch before existing implementations. Historical branches stay intact.
do $$declare d text;begin
 select pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure) into d;
 d=regexp_replace(d,'begin','begin if exists(select 1 from public.analysis_parallel_reports where run_id=p_run) then return public.claim_parallel_report_task(p_run,p_worker);end if;','i');execute d;
 select pg_get_functiondef('public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure) into d;
 d=regexp_replace(d,'begin','begin if exists(select 1 from public.analysis_parallel_reports where run_id=p_run) then return public.stage_parallel_report(p_run,p_worker,p_stage,p_tasks);end if;','i');execute d;
 select pg_get_functiondef('public.check_jls_sol_ready_sources(jsonb)'::regprocedure) into d;
 d=regexp_replace(d,'begin','begin if p_body->>''version''=''jls-direct4-parallel-no-luna-v1'' then return public.check_parallel_ready(p_body);end if;','i');execute d;
 select pg_get_functiondef('public.jls_restaurant_valid(uuid)'::regprocedure) into d;
 d=replace(d,'r.consent->>''consent_source''=''user_directive_codex_delegation''','r.consent->>''consent_source''=''user_directive_codex_delegation'' or (p.body->>''version''=''jls-direct4-parallel-no-luna-v1'' and r.consent->>''consent_source''=''user_in_app_button'' and r.consent->>''user_id''=p.authority_user_id::text and exists(select 1 from public.analysis_parallel_reports pair where pair.run_id=r.id and pair.protocol_id=p.id))');execute d;
end $$;

create function public.publish_parallel_report(p_run uuid) returns boolean language plpgsql set search_path='' as $$
declare pair public.analysis_parallel_reports;o public.analysis_jls_sol_ready_operations;ready_row public.analysis_jls_sol_ready_artifacts;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into pair from public.analysis_parallel_reports where run_id=p_run for update;
 if pair.id is null then return false;end if;if pair.derived_report is not null then return true;end if;
 select * into o from public.analysis_jls_sol_ready_operations where run_id=p_run and result is not null;
 if o.id is null then return false;end if;select * into ready_row from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 if o.result_sha256<>public.jls_restaurant_hash(o.result) then raise exception 'PARALLEL_RESULT_CHANGED';end if;
 v=o.result->'validated_report';
 update public.analysis_parallel_reports set state=o.status,error_code=o.error_code,raw_response=o.result->'response',original_report=v->'original_report',derived_report=case when v is null then null else jsonb_build_object('format_version',v->'format_version','statistics_sha256',v->'statistics_sha256','report',v->'report') end,
 corrections=v->'reference_derivation',controls=(v-'report'-'original_report'-'server_statistics')||jsonb_build_object('evidence',ready_row.body->'evidence'),statistics=ready_row.body->'statistics',
 usage=jsonb_build_object('sol',o.result-'validated_report'-'response'-'raw_response_text','jev',
 (select jsonb_build_object('provider_attempts',coalesce(sum(t.request_count),0),'reused_results',count(*) filter(where t.status='reused'),
 'input_tokens',sum((a.body->>'input_tokens')::bigint) filter(where t.request_count=1),'output_tokens',sum((a.body->>'output_tokens')::bigint) filter(where t.request_count=1),
 'summed_provider_duration_ms',sum((a.body->>'duration_ms')::bigint) filter(where t.request_count=1)) from public.analysis_jls_restaurant_tasks t left join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id where t.run_id=p_run and t.phase='jev'),
 'luna_calls',0,'apify_calls',0),generated_at=o.completed_at where id=pair.id;return true;
end $$;
create function public.publish_parallel_saved_result() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.analysis_parallel_reports where run_id=new.run_id) then perform public.publish_parallel_report(new.run_id);end if;return new;
end $$;
create trigger publish_parallel_result after update of result on public.analysis_jls_sol_ready_operations for each row when(old.result is null and new.result is not null) execute function public.publish_parallel_saved_result();
create function public.guard_parallel_history() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_HISTORY';end if;
 if old.derived_report is not null or old.raw_response is not null or old.imported_derivative_id is not null then raise exception 'IMMUTABLE_HISTORY';end if;
 if (to_jsonb(new)-array['state','error_code','raw_response','original_report','derived_report','corrections','controls','statistics','usage','generated_at'])<>(to_jsonb(old)-array['state','error_code','raw_response','original_report','derived_report','corrections','controls','statistics','usage','generated_at']) then raise exception 'IMMUTABLE_SOURCE';end if;return new;
end $$;
create trigger parallel_history_immutable before update or delete on public.analysis_parallel_reports for each row execute function public.guard_parallel_history();

-- Trusted server import of an existing offline derivative; no run or authorization is created.
create function public.import_parallel_derivative(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare src public.analysis_jls_snapshot_preparations;cur public.historical_establishment_reports;h public.historical_report_runs;id uuid;e jsonb;r jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha<>public.jls_restaurant_hash(p_body) then raise exception 'DERIVATIVE_CHANGED';end if;
 select * into src from public.analysis_jls_snapshot_preparations where id=(p_body->>'source_archive_id')::uuid;
 select * into cur from public.historical_establishment_reports where id=(p_body->>'reference_report_id')::uuid;
 if src.sha256 is distinct from p_body->>'source_archive_sha256' or src.organization_id<>cur.organization_id or src.body->>'establishment_id'<>cur.establishment_id::text
 or src.body->'report_original_unvalidated' is distinct from p_body->'original_report' or p_body->>'corpus_sha256'<>public.jls_restaurant_hash(p_body->'source_reviews')
 or not coalesce((p_body->'controls'->>'technical_checks_passed')::boolean,false) then raise exception 'DERIVATIVE_SOURCE_CHANGED';end if;
 select * into h from public.historical_report_runs where generation_id=cur.generation_id and organization_id=cur.organization_id and establishment_id=cur.establishment_id and status='completed';
 if h.id is null or jsonb_array_length(p_body->'source_reviews')<>jsonb_array_length(h.snapshot->'reviews') then raise exception 'DERIVATIVE_CORPUS_CHANGED';end if;
 for e in select value from jsonb_array_elements(p_body->'source_reviews') loop
 select value into r from jsonb_array_elements(h.snapshot->'reviews') where value->>'id'=e->>'id';
 if r is null or e->>'analysis_text' is distinct from nullif(r->>'analysis_text','') or e->>'original_text' is distinct from coalesce(r->>'original_text','') or e->'rating' is distinct from r->'rating' then raise exception 'DERIVATIVE_CORPUS_CHANGED';end if;
 end loop;
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,corpus_sha256,source_report,source_reviews,imported_derivative_id,source_archive_id,raw_response,original_report,derived_report,corrections,controls,statistics,usage,state,generated_at)
 values(cur.organization_id,cur.establishment_id,cur.id,cur.generation_id,cur.preferred_language,p_body->>'corpus_sha256',to_jsonb(cur),p_body->'source_reviews',(p_body->>'derivative_id')::uuid,src.id,p_body->'raw_response',p_body->'original_report',p_body->'derived_report',p_body->'corrections',p_body->'controls',p_body->'statistics',p_body->'usage','completed',(p_body->>'generated_at')::timestamptz)
 on conflict(imported_derivative_id) do nothing returning analysis_parallel_reports.id into id;
 if id is null then select p.id into id from public.analysis_parallel_reports p where imported_derivative_id=(p_body->>'derivative_id')::uuid;end if;return id;
end $$;
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('check_parallel_protocol','start_parallel_report','claim_parallel_report_task','stage_parallel_report','check_parallel_ready','prepare_parallel_ready','publish_parallel_report','import_parallel_derivative','capture_parallel_jev_cache','guard_parallel_history','publish_parallel_saved_result') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;end $$;
