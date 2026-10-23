-- No supplier transport. This immutable receipt separates expensive source/request
-- certification from atomic queue creation; each RPC keeps the existing 8s limit.
create table public.analysis_parallel_launch_preparations(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 authority_user_id uuid not null references auth.users(id),
 reference_report_id uuid not null references public.historical_establishment_reports(id),
 reference_generation_id uuid not null,
 body jsonb not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 unique(organization_id,reference_report_id,reference_generation_id,sha256)
);
alter table public.analysis_parallel_launch_preparations enable row level security;
revoke all on public.analysis_parallel_launch_preparations from public,anon,authenticated;
grant select,insert on public.analysis_parallel_launch_preparations to service_role;
create trigger immutable_parallel_launch_preparation before update or delete on public.analysis_parallel_launch_preparations
 for each row execute function public.pilot_evidence_immutable();

CREATE OR REPLACE FUNCTION public.prepare_parallel_report(p_body jsonb, p_sha text, p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare h public.historical_report_runs;cur public.historical_establishment_reports;pair public.analysis_parallel_reports;p uuid;r uuid;v jsonb;x jsonb;c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into cur from public.historical_establishment_reports where id=(p_body->'reference'->>'report_id')::uuid for share;
 if cur.id is null or cur.ai_status<>'completed' or cur.generation_id::text is distinct from p_body->'reference'->>'generation_id'
 or to_jsonb(cur) is distinct from p_body->'frozen_report' or p_body->>'authority_user_id' is distinct from p_user::text
 or cur.organization_id::text is distinct from p_body->>'organization_id' or cur.establishment_id::text is distinct from p_body->>'establishment_id'
 or cur.preferred_language is distinct from p_body->>'language' or p_body->>'version' is distinct from 'jls-direct4-parallel-no-luna-v1' or public.jls_restaurant_hash(p_body)<>p_sha
 or not exists(select 1 from public.organization_members where organization_id=cur.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'PARALLEL_SOURCE_OR_ACCESS_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(cur.id::text||cur.generation_id::text||cur.preferred_language,0));
 select * into pair from public.analysis_parallel_reports where reference_report_id=cur.id and reference_generation_id=cur.generation_id and language=cur.preferred_language and configuration_version=p_body->>'version';
 if pair.id is not null then return pair.id;end if;
 select * into h from public.historical_report_runs where id=(p_body->'reference'->>'historical_run_id')::uuid and generation_id=cur.generation_id and status='completed' and organization_id=cur.organization_id and establishment_id=cur.establishment_id;
 if h.id is null or jsonb_array_length(h.snapshot->'reviews')<>jsonb_array_length(p_body->'source_snapshot'->'reviews')
 or (select count(distinct value->>'id') from jsonb_array_elements(p_body->'source_snapshot'->'reviews'))<>cur.stored_reviews_count
 or (select count(*) from jsonb_array_elements(p_body->'source_snapshot'->'reviews') where value->>'analysis_text' is not null)<>(p_body->>'max_jev_calls')::int then raise exception 'PARALLEL_CORPUS_UNAVAILABLE';end if;
 -- Materialize each frozen array once, instead of scanning 610 rows for each review/request.
 if exists(with frozen as materialized(select value as frozen_value from jsonb_array_elements(h.snapshot->'reviews')),
 proposed as materialized(select value as proposed_value from jsonb_array_elements(p_body#>'{source_snapshot,reviews}'))
 select 1 from proposed left join frozen on frozen_value->>'id'=proposed_value->>'id'
 where frozen_value is null or proposed_value->>'original_text' is distinct from coalesce(frozen_value->>'original_text','') or proposed_value->>'analysis_text' is distinct from nullif(frozen_value->>'analysis_text','')
 or proposed_value->'rating' is distinct from frozen_value->'rating' or proposed_value->'review_detailed_rating' is distinct from frozen_value->'review_detailed_rating' or proposed_value->'review_context' is distinct from frozen_value->'review_context'
 or proposed_value->'analysis_source' is distinct from frozen_value->'analysis_source' or proposed_value->'analysis_language' is distinct from frozen_value->'analysis_language'
 or proposed_value->>'organization_id' is distinct from cur.organization_id::text or proposed_value->>'establishment_id' is distinct from cur.establishment_id::text
 or proposed_value->>'original_text_sha256' is distinct from encode(extensions.digest(proposed_value->>'original_text','sha256'),'hex')
 or proposed_value->>'analysis_text' is not null and proposed_value->>'analysis_text_sha256' is distinct from encode(extensions.digest(proposed_value->>'analysis_text','sha256'),'hex')) then raise exception 'PARALLEL_CORPUS_CHANGED';end if;
 if exists(with frozen as materialized(select value as frozen_value from jsonb_array_elements(p_body#>'{source_snapshot,reviews}')),
 proposed as materialized(select value as proposed_value from jsonb_array_elements(p_body->'pending'))
 select 1 from proposed left join frozen on frozen_value->>'id'=proposed_value->>'review_id'
 where frozen_value->>'analysis_text' is null or proposed_value#>>'{payload,state,analysis_text}' is distinct from frozen_value->>'analysis_text'
 or proposed_value#>>'{payload,model}' is distinct from 'jev-1.13.0' or proposed_value#>'{payload,questions}' is distinct from p_body#>'{configuration,jev,questions}'
 or proposed_value->>'request_sha256' is distinct from public.jls_restaurant_hash(proposed_value->'payload')
 or proposed_value#>>'{identity,configuration_sha256}' is distinct from p_body->>'classification_configuration_sha256'
 or proposed_value#>>'{identity,analysis_text_sha256}' is distinct from frozen_value->>'analysis_text_sha256') then raise exception 'PARALLEL_REQUEST_CHANGED';end if;
 insert into public.analysis_parallel_launch_preparations(organization_id,authority_user_id,reference_report_id,reference_generation_id,body,sha256)
 values(cur.organization_id,p_user,cur.id,cur.generation_id,p_body,p_sha)
 on conflict(organization_id,reference_report_id,reference_generation_id,sha256) do nothing returning id into p;
 if p is null then select id into p from public.analysis_parallel_launch_preparations where organization_id=cur.organization_id and reference_report_id=cur.id and reference_generation_id=cur.generation_id and sha256=p_sha and body=p_body and authority_user_id=p_user;end if;
 if p is null then raise exception 'PARALLEL_PREPARATION_CHANGED';end if;return p;
end $function$;
CREATE OR REPLACE FUNCTION public.start_parallel_report_internal(p_body jsonb, p_sha text, p_user uuid, p_delegation jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare certified boolean=false;h public.historical_report_runs;cur public.historical_establishment_reports;pair public.analysis_parallel_reports;p uuid;r uuid;v jsonb;x jsonb;c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if; if p_delegation is not null and not public.check_parallel_delegation(p_body,p_sha,p_delegation) then raise exception 'PARALLEL_DELEGATION_INVALID';end if;
 select exists(select 1 from public.analysis_parallel_launch_preparations where sha256=p_sha and body=p_body and authority_user_id=p_user and organization_id=(p_body->>'organization_id')::uuid and reference_report_id=(p_body#>>'{reference,report_id}')::uuid and reference_generation_id=(p_body#>>'{reference,generation_id}')::uuid) into certified;
 select * into cur from public.historical_establishment_reports where id=(p_body->'reference'->>'report_id')::uuid for share;
 if cur.id is null or cur.ai_status<>'completed' or cur.generation_id::text is distinct from p_body->'reference'->>'generation_id'
 or to_jsonb(cur) is distinct from p_body->'frozen_report' or p_body->>'authority_user_id' is distinct from p_user::text
 or cur.organization_id::text is distinct from p_body->>'organization_id' or cur.establishment_id::text is distinct from p_body->>'establishment_id'
 or cur.preferred_language is distinct from p_body->>'language' or p_body->>'version' is distinct from 'jls-direct4-parallel-no-luna-v1' or (case when certified then false else public.jls_restaurant_hash(p_body)<>p_sha end)
 or not exists(select 1 from public.organization_members where organization_id=cur.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'PARALLEL_SOURCE_OR_ACCESS_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(cur.id::text||cur.generation_id::text||cur.preferred_language,0));
 select * into pair from public.analysis_parallel_reports where reference_report_id=cur.id and reference_generation_id=cur.generation_id and language=cur.preferred_language and configuration_version=p_body->>'version';
 if pair.id is not null then return pair.id;end if;
 if not certified then
 select * into h from public.historical_report_runs where id=(p_body->'reference'->>'historical_run_id')::uuid and generation_id=cur.generation_id and status='completed' and organization_id=cur.organization_id and establishment_id=cur.establishment_id;
 if h.id is null or jsonb_array_length(h.snapshot->'reviews')<>jsonb_array_length(p_body->'source_snapshot'->'reviews')
 or (select count(distinct value->>'id') from jsonb_array_elements(p_body->'source_snapshot'->'reviews'))<>cur.stored_reviews_count
 or (select count(*) from jsonb_array_elements(p_body->'source_snapshot'->'reviews') where value->>'analysis_text' is not null)<>(p_body->>'max_jev_calls')::int then raise exception 'PARALLEL_CORPUS_UNAVAILABLE';end if;
 -- Materialize each frozen array once, instead of scanning 610 rows for each review/request.
 if exists(with frozen as materialized(select value as frozen_value from jsonb_array_elements(h.snapshot->'reviews')),
 proposed as materialized(select value as proposed_value from jsonb_array_elements(p_body#>'{source_snapshot,reviews}'))
 select 1 from proposed left join frozen on frozen_value->>'id'=proposed_value->>'id'
 where frozen_value is null or proposed_value->>'original_text' is distinct from coalesce(frozen_value->>'original_text','') or proposed_value->>'analysis_text' is distinct from nullif(frozen_value->>'analysis_text','')
 or proposed_value->'rating' is distinct from frozen_value->'rating' or proposed_value->'review_detailed_rating' is distinct from frozen_value->'review_detailed_rating' or proposed_value->'review_context' is distinct from frozen_value->'review_context'
 or proposed_value->'analysis_source' is distinct from frozen_value->'analysis_source' or proposed_value->'analysis_language' is distinct from frozen_value->'analysis_language'
 or proposed_value->>'organization_id' is distinct from cur.organization_id::text or proposed_value->>'establishment_id' is distinct from cur.establishment_id::text
 or proposed_value->>'original_text_sha256' is distinct from encode(extensions.digest(proposed_value->>'original_text','sha256'),'hex')
 or proposed_value->>'analysis_text' is not null and proposed_value->>'analysis_text_sha256' is distinct from encode(extensions.digest(proposed_value->>'analysis_text','sha256'),'hex')) then raise exception 'PARALLEL_CORPUS_CHANGED';end if;
 if exists(with frozen as materialized(select value as frozen_value from jsonb_array_elements(p_body#>'{source_snapshot,reviews}')),
 proposed as materialized(select value as proposed_value from jsonb_array_elements(p_body->'pending'))
 select 1 from proposed left join frozen on frozen_value->>'id'=proposed_value->>'review_id'
 where frozen_value->>'analysis_text' is null or proposed_value#>>'{payload,state,analysis_text}' is distinct from frozen_value->>'analysis_text'
 or proposed_value#>>'{payload,model}' is distinct from 'jev-1.13.0' or proposed_value#>'{payload,questions}' is distinct from p_body#>'{configuration,jev,questions}'
 or proposed_value->>'request_sha256' is distinct from public.jls_restaurant_hash(proposed_value->'payload')
 or proposed_value#>>'{identity,configuration_sha256}' is distinct from p_body->>'classification_configuration_sha256'
 or proposed_value#>>'{identity,analysis_text_sha256}' is distinct from frozen_value->>'analysis_text_sha256') then raise exception 'PARALLEL_REQUEST_CHANGED';end if;
 end if;
 -- Existing protocol CHECK still verifies all configuration/source/request hashes.
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
 if p_delegation is null then c=jsonb_build_object('consent_source','user_in_app_button','protocol_id',p,'protocol_sha256',p_sha,'user_id',p_user,'created_at',now(),'expires_at',now()+interval '24 hours',
  'scope',jsonb_build_object('max_jev_calls',p_body->'max_jev_calls','max_luna_calls',0,'max_sol_calls',1,'max_apify_calls',0,'automatic_retry',false));
else c=p_delegation||jsonb_build_object('protocol_id',p,'authority_user_id',p_user);end if;  insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at) values(p,cur.organization_id,c,public.jls_restaurant_hash(c),(c->>'expires_at')::timestamptz) returning id into r;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
 select r,cur.organization_id,'jev',value->>'review_id',(value->>'review_id')::uuid,value->'payload',value->>'request_sha256',value->'identity' from jsonb_array_elements(p_body->'pending');
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,protocol_id,run_id,corpus_sha256,source_report,source_reviews)
 values(cur.organization_id,cur.establishment_id,cur.id,cur.generation_id,cur.preferred_language,p,r,p_body->'source_snapshot'->>'source_reviews_sha256',p_body->'frozen_report',p_body->'source_snapshot'->'reviews') returning id into p;
 return p;
end $function$
;
revoke all on function public.prepare_parallel_report(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_parallel_report(jsonb,text,uuid) to service_role;
