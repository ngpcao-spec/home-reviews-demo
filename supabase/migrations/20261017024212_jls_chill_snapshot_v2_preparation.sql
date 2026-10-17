-- Chill preparation only; no execution, consent, task or wake is created.
alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check check(
 establishment_id='d40d3438-79d8-4c28-8b09-eba640598201' or
 (establishment_id='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8' and body->>'version'='jls-historical-snapshot-v2-vi-v1'));
alter table public.analysis_jls_restaurant_runs drop constraint analysis_jls_restaurant_runs_stage_check;
alter table public.analysis_jls_restaurant_runs add constraint analysis_jls_restaurant_runs_stage_check check(stage in('jev','prepare_evidence','luna','prepare_sol','sol','validate_sol'));
create table public.analysis_jls_snapshot_preparations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,protocol_id uuid not null,
 kind text not null,body jsonb not null,sha256 text not null,created_at timestamptz not null default now(),
 unique(protocol_id,kind),foreign key(protocol_id,organization_id) references public.analysis_jls_restaurant_protocols(id,organization_id));
alter table public.analysis_jls_snapshot_preparations enable row level security;
revoke all on public.analysis_jls_snapshot_preparations from anon,authenticated;
grant select on public.analysis_jls_snapshot_preparations to authenticated;
grant all on public.analysis_jls_snapshot_preparations to service_role;
create policy snapshot_preparation_read on public.analysis_jls_snapshot_preparations for select to authenticated using(
 exists(select 1 from public.organization_members m where m.organization_id=analysis_jls_snapshot_preparations.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create trigger immutable before update or delete on public.analysis_jls_snapshot_preparations for each row execute function public.pilot_evidence_immutable();

create function public.check_jls_snapshot_v2_source(p_body jsonb) returns boolean language plpgsql stable security invoker set search_path='' set jit='off' as $fn$
declare h public.historical_report_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into h from public.historical_report_runs where id=(p_body->'frozen_v2'->>'historical_run_id')::uuid;
 return coalesce(h.id='39556285-21ee-4962-9892-da3b4f0e8ca3' and h.status='completed'
 and h.organization_id=(p_body->>'organization_id')::uuid and h.establishment_id=(p_body->>'establishment_id')::uuid
 and h.requested_by=(p_body->>'authority_user_id')::uuid
 and p_body->'frozen_v2'->>'historical_run_sha256'=public.jls_restaurant_hash(to_jsonb(h))
 and p_body->'frozen_v2'->'historical_snapshot'=h.snapshot
 and h.snapshot->'base'->>'source_fingerprint'='5642ee929cce9504e5c21292b5b8b5fbb6f762181c57f918c999760948ba767f',false);
end $fn$;
create function public.save_jls_snapshot_v2_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' set jit='off' as $fn$
declare rid uuid;v jsonb;s jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_body->>'version' is distinct from 'jls-historical-snapshot-v2-vi-v1' or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->>'establishment_id' is distinct from 'a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8'
 or not public.check_jls_snapshot_v2_source(p_body)
 or p_body->>'preparation_is_not_spending_authorization' is distinct from 'true'
 or p_body->'configuration'->'policy'->>'automatic_retry' is distinct from 'false'
 or p_body->'configuration'->'policy'->>'provider_client_retries' is distinct from '0'
 or p_body->'configuration'->'policy'->>'format_version' is distinct from 'jls-prioritized-recommendations-v2'
 or p_body->'configuration'->'policy'->>'language' is distinct from 'vi'
 or p_body->>'max_sol_calls' is distinct from '1' or p_body->>'max_luna_calls' is distinct from '32'
 or jsonb_array_length(p_body->'snapshot'->'source'->'reviews')<>100 or jsonb_array_length(p_body->'english_review_ids')<>80
 or (select count(distinct value->>'id') from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews'))<>100
 or jsonb_array_length(p_body->'pending')+jsonb_array_length(p_body->'cache')<>80
 or (select count(distinct id) from(select value->>'review_id' id from jsonb_array_elements(p_body->'pending') union all select value->>'review_id' from jsonb_array_elements(p_body->'cache'))x)<>80
 or (select count(*) from jsonb_object_keys(p_body->'configuration'->'jev_request_template'->'questions'))<>25
 or p_body->'configuration'->'policy'->>'jev_configuration' is distinct from 'v12_economy_1pass_v1'
 or (p_body->>'max_jev_calls')::int<>jsonb_array_length(p_body->'pending')
 or p_body->>'configuration_sha256' is distinct from public.jls_restaurant_hash(p_body->'configuration')
 or p_body->>'cache_sha256' is distinct from public.jls_restaurant_hash(p_body->'cache')
 or p_body->>'pending_sha256' is distinct from public.jls_restaurant_hash(p_body->'pending')
 or not exists(select 1 from public.organization_members m where m.organization_id=(p_body->>'organization_id')::uuid
 and m.user_id=(p_body->>'authority_user_id')::uuid and m.role in('owner','admin','manager'))
 then raise exception 'JLS_SNAPSHOT_PROTOCOL_INVALID';end if;
 for v in select value from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews') loop
 select value into s from jsonb_array_elements(p_body->'frozen_v2'->'historical_snapshot'->'reviews') where value->>'id'=v->>'id';
 if s is null or v->>'original_text' is distinct from coalesce(s->>'original_text','')
 or v->>'analysis_text' is distinct from nullif(s->>'analysis_text','')
 or v->'review_context' is distinct from s->'review_context' or v->'review_detailed_rating' is distinct from s->'review_detailed_rating'
 or v->'rating' is distinct from s->'rating' or v->>'original_text_sha256' is distinct from encode(extensions.digest(v->>'original_text','sha256'),'hex')
 or v->>'analysis_text' is not null and (v->>'analysis_language'<>'en' or v->>'analysis_text_sha256' is distinct from encode(extensions.digest(v->>'analysis_text','sha256'),'hex'))
 then raise exception 'JLS_FROZEN_REVIEW_CHANGED';end if;end loop;
 for v in select value from jsonb_array_elements(p_body->'pending') loop
 if not(p_body->'english_review_ids' ? (v->>'review_id')) or not exists(select 1 from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews')s
 where s->>'id'=v->>'review_id' and s->>'analysis_text'=v->'payload'->'state'->>'analysis_text' and s->>'analysis_text_sha256'=v->'identity'->>'analysis_text_sha256') or v->>'request_sha256' is distinct from
 public.jls_restaurant_hash((v->'payload')||jsonb_build_object('questions',p_body->'configuration'->'jev_request_template'->'questions'))
 or v->'payload'->>'model' is distinct from 'jev-latest' or (select array_agg(key order by key) from jsonb_object_keys(v->'payload'->'state')key) is distinct from array['analysis_text','review_alias']::text[]
 then raise exception 'JLS_JEV_REQUEST_CHANGED';end if;end loop;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;
end $fn$;
create function public.save_jls_snapshot_preparation(p_protocol uuid,p_kind text,p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 if p.id is null or p.body->>'version'<>'jls-historical-snapshot-v2-vi-v1' or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or length(p_kind)>100 or p_kind='' then raise exception 'JLS_PREPARATION_INVALID';end if;
 if p_kind='qualification' and (p_body->>'passed' is distinct from 'true' or p_body->>'provider_calls' is distinct from '0'
 or p_body->>'protocol_sha256' is distinct from p.sha256 or jsonb_array_length(p_body->'native_cpu_checks')<5
 or exists(select 1 from jsonb_array_elements(p_body->'native_cpu_checks')x where (x->>'cpu_ms')::int not between 1 and 1500 or x->>'execution_id' is null))
 then raise exception 'JLS_NATIVE_QUALIFICATION_REQUIRED';end if;
 insert into public.analysis_jls_snapshot_preparations(organization_id,protocol_id,kind,body,sha256)values(p.organization_id,p.id,p_kind,p_body,p_sha)
 on conflict(protocol_id,kind) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind=p_kind and sha256=p_sha;end if;
 if rid is null then raise exception 'JLS_PREPARATION_IMMUTABLE';end if;return rid;
end $fn$;
create function public.stage_jls_snapshot_v2(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean language plpgsql security invoker set search_path='' set jit='off' as $fn$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;v jsonb;plan jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p.body->>'version'<>'jls-historical-snapshot-v2-vi-v1' or not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now()
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status not in('completed','reused')) then return false;end if;
 if r.stage='jev' and p_stage='prepare_evidence' and p_tasks='[]' then update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;end if;
 if r.stage='luna' and p_stage='prepare_sol' and p_tasks='[]' and exists(select 1 from public.analysis_jls_restaurant_artifacts a where a.run_id=r.id and kind='luna_decisions'
 and a.sha256=public.jls_restaurant_hash(a.body) and a.body->>'decisions_sha256'=public.jls_restaurant_hash(a.body->'decisions'))
 then update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;end if;
 if r.stage<>'prepare_evidence' or p_stage<>'luna' then return false;end if;
 select body into plan from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='evidence_plan';
 if plan is null or jsonb_array_length(p_tasks)<>jsonb_array_length(plan->'luna_groups') or jsonb_array_length(p_tasks)>32 or (plan->>'question_count')::int>32 then return false;end if;
 for v in select value from jsonb_array_elements(p_tasks) loop
 if v->'request'->>'model'<>'gpt-6-luna' or v->>'request_sha256'<>public.jls_restaurant_hash(v->'request') or not exists(
 select 1 from jsonb_array_elements(plan->'luna_groups')g where g->>'review_id'=v->>'review_id' and g->>'request_sha256'=v->>'request_sha256') then raise exception 'JLS_LUNA_MANIFEST_CHANGED';end if;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(r.id,r.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,v->'request',v->>'request_sha256');end loop;
 update public.analysis_jls_restaurant_runs set stage='luna' where id=r.id;return true;
end $fn$;
create function public.check_jls_snapshot_ready_sources(p_body jsonb) returns boolean language plpgsql stable security invoker set search_path='' set jit='off' as $fn$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;x jsonb;t public.analysis_jls_restaurant_tasks;a public.analysis_jls_restaurant_artifacts;c public.analysis_jev_review_cache;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid;
 if p.id is null or r.id is null or r.protocol_id<>p.id or p.body->>'version'<>'jls-historical-snapshot-v2-vi-v1'
 or p.sha256<>p_body->>'source_protocol_sha256' or not public.check_jls_snapshot_v2_source(p.body)
 or p_body->>'plan_sha256'<>public.jls_restaurant_hash(p_body->'plan') or p_body->>'decisions_sha256'<>public.jls_restaurant_hash(p_body->'decisions')
 or jsonb_array_length(p_body->'source_tasks')<>jsonb_array_length(p_body->'plan'->'luna_groups')
 or jsonb_array_length(p_body->'source_tasks')>32 or jsonb_array_length(p_body->'decisions')<>(p_body->'plan'->>'question_count')::int
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts d where d.run_id=r.id and d.kind='luna_decisions'
 and d.sha256=p_body->>'source_decisions_artifact_sha256' and d.body->>'decisions_sha256'=p_body->>'decisions_sha256') then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'source_tasks') loop
 select * into t from public.analysis_jls_restaurant_tasks where id=(x->>'task_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.id is null or t.run_id<>r.id or t.phase<>'luna' or t.status<>'completed' or t.request_count<>1 or t.request_sha256<>x->>'request_sha256'
 or a.sha256 is distinct from x->>'artifact_sha256' or a.sha256<>public.jls_restaurant_hash(a.body) or a.body->>'response_sha256' is distinct from x->>'response_sha256'
 or a.body->>'response_sha256'<>public.jls_restaurant_hash(a.body->'response') then return false;end if;end loop;
 for x in select value from jsonb_array_elements(p_body->'plan'->'cache_fingerprints') loop
 select * into c from public.analysis_jev_review_cache where id=(x->>'cache_id')::uuid;
 if c.id is null or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or c.status<>'completed'
 or c.analysis_text_sha256<>x->>'text_sha256' or x->>'response_sha256'<>public.jls_restaurant_hash(jsonb_build_object(
 'cache_key',c.cache_key,'response',c.response,'theme_results',c.theme_results,'served_model',c.served_model)) then return false;end if;end loop;
 return true;
end $fn$;
create function public.bind_jls_snapshot_preparation(p_run uuid,p_stage text,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' set jit='off' as $fn$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;w text='codex_free_preparation_v1';v jsonb;plan jsonb;aid uuid;tid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p_stage='prepare_evidence' and exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='snapshot_evidence' and sha256=p_sha) then return true;end if;
 if p_stage='prepare_sol' and exists(select 1 from public.analysis_jls_sol_ready_artifacts where source_run_id=r.id and sha256=p_sha) then return true;end if;
 if p.body->>'version'<>'jls-historical-snapshot-v2-vi-v1' or r.stage<>p_stage or p_sha<>public.jls_restaurant_hash(p_body)
 or not public.check_jls_snapshot_v2_source(p.body) or not public.claim_jls_restaurant_tick(r.id,w) then return false;end if;
 if p_stage='prepare_evidence' then
 plan=p_body->'plan';
 if p_body->>'protocol_sha256'<>p.sha256 or p_body->>'plan_sha256'<>public.jls_restaurant_hash(plan)
 or jsonb_array_length(plan->'cache_fingerprints')<>80 or plan->'statistics'->'coverage'->>'analysed_reviews'<>'80'
 or plan->'statistics'->'coverage'->>'stored_reviews'<>'100' or (plan->>'question_count')::int>32 or jsonb_array_length(plan->'luna_groups')>32 then raise exception 'JLS_EVIDENCE_INVALID';end if;
 if (select count(distinct value->>'review_id') from jsonb_array_elements(plan->'cache_fingerprints'))<>80 or exists(
 select 1 from jsonb_array_elements(plan->'cache_fingerprints')x left join public.analysis_jev_review_cache c on c.id=(x->>'cache_id')::uuid
 where c.id is null or c.status<>'completed' or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id
 or c.analysis_text_sha256<>x->>'text_sha256' or x->>'response_sha256'<>public.jls_restaurant_hash(jsonb_build_object('cache_key',c.cache_key,'response',c.response,'theme_results',c.theme_results,'served_model',c.served_model)))
 then raise exception 'JLS_COMPLETED_CACHE_REQUIRED_NO_MOCK';end if;
 for v in select value from jsonb_array_elements(plan->'statistics'->'themes') loop
 if (v->>'negative_reviews')::int<>(select count(distinct c.review_id) from public.analysis_jev_review_cache c where c.id in(select (x->>'cache_id')::uuid from jsonb_array_elements(plan->'cache_fingerprints')x) and c.theme_results->(v->>'theme_key')->>'choice' in('negative','both'))
 or (v->>'positive_reviews')::int<>(select count(distinct c.review_id) from public.analysis_jev_review_cache c where c.id in(select (x->>'cache_id')::uuid from jsonb_array_elements(plan->'cache_fingerprints')x) and c.theme_results->(v->>'theme_key')->>'choice' in('positive','both'))
 then raise exception 'JLS_THEME_FREQUENCY_CHANGED';end if;end loop;
 for v in select value from jsonb_array_elements(plan->'selected') loop
 if not exists(select 1 from jsonb_array_elements(p.body->'snapshot'->'source'->'reviews')s where s->>'id'=v->>'review_id'
 and s->>'analysis_text_sha256'=v->>'analysis_text_sha256' and substring(s->>'analysis_text' from (v->>'quote_start')::int+1 for (v->>'quote_end')::int-(v->>'quote_start')::int)=v->>'quote'
 and v->>'quote_sha256'=encode(extensions.digest(v->>'quote','sha256'),'hex')) then raise exception 'JLS_QUOTE_CHANGED';end if;end loop;
 if not public.save_jls_restaurant_artifact(r.id,w,'snapshot_evidence',p_body,p_sha) or not public.save_jls_restaurant_artifact(r.id,w,'evidence_plan',plan,public.jls_restaurant_hash(plan)) then raise exception 'JLS_BIND_FAILED';end if;
 if not public.stage_jls_snapshot_v2(r.id,w,'luna',(select jsonb_agg(jsonb_build_object('review_id',g->'review_id','request',g->'payload','request_sha256',g->'request_sha256')) from jsonb_array_elements(plan->'luna_groups')g)) then raise exception 'JLS_STAGE_CHANGED';end if;
 elsif p_stage='prepare_sol' then
 if p_body->>'version'<>'jls-snapshot-sol-request-v2' or not public.check_jls_snapshot_ready_sources(p_body)
 or p_body->'sol'->'gate'->>'passed'<>'true' or p_body->'sol'->'draft'->>'format_version'<>'jls-prioritized-recommendations-v2'
 or p_body->'sol'->'draft'->>'prompt_sha256'<>p.body->'configuration'->>'sol_prompt_sha256'
 or p_body->'sol'->'draft'->>'schema_sha256'<>p.body->'configuration'->>'sol_schema_sha256'
 or p_body->>'request_raw_sha256'<>encode(extensions.digest(p_body->>'request_json','sha256'),'hex')
 or p_body->>'request_sha256'<>public.jls_restaurant_hash((p_body->>'request_json')::jsonb)
 or p_body->'measurement'->>'input_budget_tokens'<>'32768' or (p_body->'measurement'->>'guarded_input_tokens')::int>32768
 or p_body->'measurement'->>'output_reserved_tokens'<>'9500' or octet_length(p_body->>'request_json')>1048576
 then raise exception 'JLS_SOL_READY_INVALID';end if;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256)
 values(p.organization_id,p.id,r.id,p_body,p_sha) returning id into aid;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256)
 values(r.id,r.organization_id,'sol','sol',(p_body->>'request_json')::jsonb,p_body->>'request_sha256')returning id into tid;
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_id,protocol_sha256,run_id,task_id)
 values(p.organization_id,aid,'paid',p.id,p.sha256,r.id,tid);
 update public.analysis_jls_restaurant_runs set stage='sol' where id=r.id;
 else raise exception 'JLS_FREE_STAGE_INVALID';end if;
 perform public.release_jls_restaurant_tick(r.id,w,null);return true;
end $fn$;
CREATE OR REPLACE FUNCTION public.stage_jls_restaurant(p_run uuid, p_worker text, p_stage text, p_tasks jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;v jsonb;plan jsonb;draft jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p.body->>'version'='jls-historical-snapshot-v2-vi-v1' then return public.stage_jls_snapshot_v2(p_run,p_worker,p_stage,p_tasks);end if;
 if not public.jls_restaurant_valid(r.id) or r.worker<>p_worker or r.lease_until<=now()
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status not in('completed','reused')) then return false;end if;
 if not (r.stage='jev' and p_stage='luna' or r.stage='luna' and p_stage='sol' and p.body->'prepared' is null or r.stage='luna' and p_stage='prepare_sol' and p.body->'prepared' is not null or r.stage='prepare_sol' and p_stage='sol' and p.body->'prepared' is not null or r.stage='sol' and p_stage='completed') then return false;end if;
 if p_stage='completed' then update public.analysis_jls_restaurant_runs set status='completed',lease_until=null where id=r.id;return true;end if;
 if p_stage='prepare_sol' then
 if jsonb_array_length(p_tasks)<>0 or not exists(select 1 from public.analysis_jls_restaurant_artifacts a where a.run_id=r.id and a.kind='luna_decisions'
 and a.sha256=public.jls_restaurant_hash(a.body) and a.body->>'decisions_sha256'=public.jls_restaurant_hash(a.body->'decisions') and jsonb_array_length(a.body->'decisions')=(select (e.body->>'question_count')::int from public.analysis_jls_restaurant_artifacts e where e.run_id=r.id and e.kind='evidence_plan')) then return false;end if;
 update public.analysis_jls_restaurant_runs set stage='prepare_sol' where id=r.id;return true;end if;
 if p_stage='luna' then
  select body into plan from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='evidence_plan';
  if plan is null or jsonb_array_length(p_tasks)<>jsonb_array_length(plan->'luna_groups') or jsonb_array_length(p_tasks)>(p.body->>'max_luna_calls')::int
  or (plan->>'question_count')::int>32 or plan->>'source_sha256'<>p.body->'snapshot'->>'source_sha256' then return false;end if;
  if p.body->>'version' in('jls-restaurant-resume-vi-32k-v1','jls-restaurant-prepared-vi-v1') and
   (plan->>'dossier_sha256' is distinct from p.body->'resume'->>'evidence_sha256'
    or plan->>'luna_manifest_sha256' is distinct from p.body->'resume'->>'luna_manifest_sha256'
    or plan->'sol_size_policy' is distinct from p.body->'sol_size_policy') then return false;end if;
 else
  select body into draft from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='sol_dossier';
  if draft is null or draft->'gate'->>'passed'<>'true' or jsonb_array_length(p_tasks)<>1 then return false;end if;
 end if;
 if p_stage='sol' and p.body->>'version' in('jls-restaurant-resume-vi-32k-v1','jls-restaurant-prepared-vi-v1') and
  (coalesce((draft->'draft'->'estimates'->>'estimated_input_tokens')::int,-1) not between 1 and 32768
   or draft->'draft'->'config'->'sol_size_policy' is distinct from p.body->'sol_size_policy'
   or draft->'draft'->'request'->>'max_output_tokens' is distinct from '9500'
   or octet_length((draft->'draft'->'request')::text)>1048576) then return false;end if;
 if p_stage='sol' and p.body->'prepared' is not null and (
 draft->>'token_certificate_sha256' is distinct from public.jls_restaurant_hash(draft->'token_certificate')
 or draft->>'request_raw_sha256' is distinct from encode(extensions.digest(draft->>'request_json','sha256'),'hex')
 or public.jls_restaurant_hash((draft->>'request_json')::jsonb) is distinct from draft->'draft'->>'request_sha256')
 then return false;end if;
 for v in select value from jsonb_array_elements(p_tasks) loop
  if v->>'request_sha256'<>public.jls_restaurant_hash(v->'request') then raise exception 'JLS_REQUEST_CHANGED';end if;
  if p_stage='luna' then
   if v->'request'->>'model'<>'gpt-6-luna' or not exists(select 1 from jsonb_array_elements(plan->'luna_groups') g where g->>'review_id'=v->>'review_id'
    and g->>'request_sha256'=v->>'request_sha256') then raise exception 'JLS_LUNA_MANIFEST_CHANGED';end if;
  elsif v->'request'->>'model'<>'gpt-6.1-sol' or v->>'request_sha256'<>draft->'draft'->>'request_sha256' then raise exception 'JLS_SOL_MANIFEST_CHANGED';end if;
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
  values(r.id,r.organization_id,p_stage,coalesce(v->>'review_id','sol'),(v->>'review_id')::uuid,v->'request',v->>'request_sha256');
 end loop;
 update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;end $function$
;
CREATE OR REPLACE FUNCTION public.check_jls_sol_ready_sources(p_body jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;x jsonb;t public.analysis_jls_restaurant_tasks;a public.analysis_jls_restaurant_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_body->>'version'='jls-snapshot-sol-request-v2' then return public.check_jls_snapshot_ready_sources(p_body);end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid;
 if p.id is null or r.protocol_id<>p.id or r.status<>'blocked' or p.sha256<>p_body->>'source_protocol_sha256'
 or jsonb_array_length(p_body->'source_tasks')<>28
 or jsonb_array_length(p_body->'decisions')<>32 or p_body->>'decisions_sha256'<>public.jls_restaurant_hash(p_body->'decisions')
 or exists(select 1 from jsonb_array_elements(p.body->'cache') cache_entry(value) left join public.analysis_jev_review_cache c on c.id=(cache_entry.value->>'id')::uuid where c.id is null or c.status<>'completed' or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or to_jsonb(c)<>cache_entry.value)
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='sol')
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts d where d.run_id=r.id and d.kind='luna_decisions'
 and d.sha256=p_body->>'source_decisions_artifact_sha256' and d.sha256=public.jls_restaurant_hash(d.body)
 and d.body->>'decisions_sha256'=p_body->>'decisions_sha256') then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'source_tasks') loop
 select * into t from public.analysis_jls_restaurant_tasks where id=(x->>'task_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.id is null or t.run_id<>r.id or t.organization_id<>r.organization_id or t.phase<>'luna' or t.status<>'completed' or t.request_count<>1
 or t.review_id::text<>x->>'review_id' or t.request_sha256<>x->>'request_sha256' or t.request_sha256<>public.jls_restaurant_hash(t.request)
 or a.sha256 is distinct from x->>'artifact_sha256' or a.sha256<>public.jls_restaurant_hash(a.body)
 or a.body->>'response_sha256' is distinct from x->>'response_sha256'
 or a.body->>'response_sha256'<>public.jls_restaurant_hash(a.body->'response') then return false;end if;
 end loop;return true;end $function$
;
CREATE OR REPLACE FUNCTION public.authorize_jls_restaurant(p_protocol uuid, p_consent jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.analysis_jls_restaurant_protocols;a public.analysis_jls_sol_ready_artifacts;rid uuid;tid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p.body->>'version'='jls-historical-snapshot-v2-vi-v1' and
 (not public.check_jls_snapshot_v2_source(p.body) or not exists(select 1 from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind='qualification'
 and body->>'provider_calls'='0' and body->>'passed'='true' and body->>'protocol_sha256'=p.sha256))
 then raise exception 'JLS_SNAPSHOT_NOT_QUALIFIED';end if;
 if p.body->>'version'<>'jls-restaurant-sol-ready-vi-v1' then return public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id;if rid is not null then return rid;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where sha256=p.body->'sol_ready'->>'artifact_sha256';
 if a.id is null or not public.check_jls_sol_ready_sources(a.body) or not exists(select 1 from public.analysis_jls_sol_ready_checks where artifact_id=a.id)
 then raise exception 'JLS_READY_NOT_QUALIFIED';end if;
 rid=public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);
 update public.analysis_jls_restaurant_runs set stage='sol' where id=rid and status='queued';
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256)
 values(rid,p.organization_id,'sol','sol',(a.body->>'request_json')::jsonb,a.body->>'request_sha256') returning id into tid;
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_id,protocol_sha256,run_id,task_id)
 values(p.organization_id,a.id,'paid',p.id,p.sha256,rid,tid);return rid;end $function$
;
do $fn$declare f record;begin for f in select oid::regprocedure p from pg_proc where pronamespace='public'::regnamespace and
 (proname like '%jls_snapshot%' or proname in('stage_jls_restaurant','check_jls_sol_ready_sources','authorize_jls_restaurant'))loop
 execute format('revoke all on function %s from public,anon,authenticated',f.p);
 execute format('grant execute on function %s to service_role',f.p);end loop;end $fn$;
create function public.wake_jls_snapshot_probe(p_protocol uuid,p_phase text,p_nonce text) returns bigint language plpgsql security invoker set search_path='' as $fn$
declare req bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_phase not in('jev','luna','sol','validate_sol','stress_validate_sol') or p_nonce!~'^[-a-zA-Z0-9_]{1,50}$'
 or not exists(select 1 from public.analysis_jls_restaurant_protocols where id=p_protocol and body->>'version'='jls-historical-snapshot-v2-vi-v1')
 then raise exception 'JLS_FREE_PROBE_SCOPE_INVALID';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode','snapshot_v2_probe','protocol_id',p_protocol,'phase',p_phase,'nonce',p_nonce),timeout_milliseconds:=1000)into req;return req;
end $fn$;
revoke all on function public.wake_jls_snapshot_probe(uuid,text,text) from public,anon,authenticated;
grant execute on function public.wake_jls_snapshot_probe(uuid,text,text) to service_role;
