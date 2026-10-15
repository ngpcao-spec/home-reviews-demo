-- Separate 32k restart; no consent, run, task, wake or provider call.
CREATE OR REPLACE FUNCTION public.authorize_jls_restaurant(p_protocol uuid, p_consent jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p.id is null then raise exception 'JLS_PROTOCOL_MISSING';end if;
 select * into r from public.analysis_jls_restaurant_runs where protocol_id=p.id;
 if r.id is not null then return r.id;end if;
 if p_consent is null or jsonb_typeof(p_consent->'scope') is distinct from 'object'
 or p_consent->>'requested_at' is null or p_consent->>'expires_at' is null
 or p_consent->>'protocol_sha256' is distinct from p.sha256
 or p_consent->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or p_consent->'operator_identity' is distinct from jsonb_build_object('kind','codex_admin','channel','supabase_mcp')
 or p_consent->>'user_directive' is null or p_consent->>'directive_sha256' is null
 or p.sha256<>public.jls_restaurant_hash(p.body) or p_sha<>public.jls_restaurant_hash(p_consent)
 or p_consent->>'protocol_sha256'<>p.sha256 or p_consent->>'consent_source'<>'user_directive_codex_delegation'
 or p_consent->'operator_identity'<>jsonb_build_object('kind','codex_admin','channel','supabase_mcp')
 or length(p_consent->>'user_directive')<20
 or p_consent->>'directive_sha256'<>encode(extensions.digest(p_consent->>'user_directive','sha256'),'hex')
 or abs(extract(epoch from now()-(p_consent->>'requested_at')::timestamptz))>300
 or (p_consent->>'expires_at')::timestamptz<=now() or (p_consent->>'expires_at')::timestamptz>now()+interval '24 hours 5 minutes'
 or p_consent->'scope'<>jsonb_build_object('establishment_id',p.establishment_id,'organization_id',p.organization_id,'language','vi',
 'configuration_sha256',p.body->>'configuration_sha256','max_jev_calls',(p.body->>'max_jev_calls')::int,
 'max_luna_calls',(p.body->>'max_luna_calls')::int,'max_sol_calls',1,'automatic_retry',false,'provider_client_retries',0,'apify_calls',0)
 or not exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'))
 then raise exception 'JLS_NEW_GO_REQUIRED';end if;
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at)
 values(p.id,p.organization_id,p_consent,p_sha,(p_consent->>'expires_at')::timestamptz) returning * into r;
 for v in select value from jsonb_array_elements(p.body->'pending') loop
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
  values(r.id,r.organization_id,'jev',v->>'review_id',(v->>'review_id')::uuid,(v->'payload')||jsonb_build_object('questions',p.body->'configuration'->'jev_request_template'->'questions'),v->>'request_sha256',v->'identity');
 end loop;return r.id;end $function$
;
CREATE OR REPLACE FUNCTION public.claim_jls_restaurant_task(p_run uuid, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;c public.analysis_jev_review_cache;x jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker<>p_worker or r.lease_until<=now() then return null;end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if t.request_sha256<>public.jls_restaurant_hash(t.request) then raise exception 'JLS_REQUEST_CHANGED';end if;
 if t.phase='jev' then
  x=public.reserve_jev_economy_cache(p.authority_user_id,t.identity);
  select * into c from public.analysis_jev_review_cache where id=(x->>'id')::uuid for update;
  if c.status='completed' then
   update public.analysis_jls_restaurant_tasks set status='reused',cache_id=c.id,completed_at=now() where id=t.id;return null;
  end if;
  if x->>'claimed'<>'true' then
   update public.analysis_jls_restaurant_runs set status='blocked',error_code='JLS_CACHE_RESERVATION_UNCERTAIN' where id=r.id;return null;end if;
 end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=t.phase and request_count=1)>=
 (case t.phase when 'jev' then (p.body->>'max_jev_calls')::int when 'luna' then (p.body->>'max_luna_calls')::int else 1 end) then raise exception 'JLS_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now(),cache_id=c.id where id=t.id returning * into t;
 if t.phase='jev' then update public.analysis_jev_review_cache set status='dispatched',attempt_id=t.id,confirmed_by=p.authority_user_id,confirmed_at=now() where id=c.id;end if;
 return to_jsonb(t);end $function$
;
CREATE OR REPLACE FUNCTION public.save_jls_restaurant_protocol(p_body jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare id uuid;org uuid=(p_body->>'organization_id')::uuid;est uuid=(p_body->>'establishment_id')::uuid;u uuid=(p_body->>'authority_user_id')::uuid;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version' not in('jls-restaurant-delegated-vi-v1','jls-restaurant-resume-vi-32k-v1')
 or est<>'d40d3438-79d8-4c28-8b09-eba640598201'::uuid or not exists(select 1 from public.establishments e where e.id=est and e.organization_id=org and e.active)
 or not exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=u and m.role in('owner','admin','manager'))
 or (p_body->>'max_sol_calls')::int<>1 or (p_body->>'max_luna_calls')::int not between 1 and 32
 or (p_body->>'max_jev_calls')::int<>jsonb_array_length(p_body->'pending')
 or p_body->>'preparation_is_not_spending_authorization'<>'true'
 or p_body->'configuration'->'policy'->>'no_monetary_estimate'<>'true'
 or p_body->'configuration'->'policy'->>'automatic_retry'<>'false'
 or p_body->'configuration'->'policy'->>'language'<>'vi' then raise exception 'JLS_PROTOCOL_INVALID';end if;
 if p_body->>'version'='jls-restaurant-delegated-vi-v1' and (p_body->>'max_luna_calls')::int<>32 then raise exception 'JLS_PROTOCOL_INVALID';end if;
 if p_body->>'version'='jls-restaurant-resume-vi-32k-v1' then
  if p_body->'resume' is null or p_body->'sol_size_policy' is null
   or p_body->>'configuration_sha256' is distinct from public.jls_restaurant_hash(p_body->'configuration')
   or p_body->'configuration'->'policy'->'sol_size_policy' is distinct from p_body->'sol_size_policy'
   or p_body->'sol_size_policy'->>'version' is distinct from 'jls-sol-envelope-32k-v1'
   or p_body->'sol_size_policy'->>'input_budget_tokens' is distinct from '32768'
   or p_body->'sol_size_policy'->>'max_output_tokens' is distinct from '9500'
   or (p_body->>'max_jev_calls')::int<>0
   or coalesce((p_body->'resume'->'conditional_sol'->'measurement'->>'guarded_input_tokens')::int,-1) not between 1 and 32768
   or coalesce((p_body->'resume'->'conditional_sol'->'measurement'->>'request_bytes')::int,-1) not between 1 and 1048576
   or p_body->'resume'->'conditional_sol'->>'request_sha256' is distinct from public.jls_restaurant_hash(p_body->'resume'->'conditional_sol'->'request')
   or not exists(select 1 from public.analysis_jls_restaurant_protocols oldp join public.analysis_jls_restaurant_runs oldr on oldr.protocol_id=oldp.id
    where oldp.id=(p_body->'resume'->>'source_protocol_id')::uuid and oldp.sha256=p_body->'resume'->>'source_protocol_sha256'
    and oldp.organization_id=org and oldp.establishment_id=est and oldp.body->'snapshot'->>'source_sha256'=p_body->'snapshot'->>'source_sha256'
    and oldr.id=(p_body->'resume'->>'source_run_id')::uuid and oldr.status='blocked'
    and not exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=oldr.id and t.phase in('luna','sol')))
   then raise exception 'JLS_RESTART_INVALID';end if;
 end if;
 for v in select value from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews') loop
  if not exists(select 1 from public.reviews r where r.id=(v->>'id')::uuid and r.establishment_id=est and r.organization_id=org
   and encode(extensions.digest(coalesce(r.original_text,''),'sha256'),'hex')=v->>'original_text_sha256')
  then raise exception 'JLS_SOURCE_CHANGED';end if;
 end loop;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256) values(org,est,u,p_body,p_sha)
 on conflict(sha256) do nothing returning analysis_jls_restaurant_protocols.id into id;
 if id is null then select p.id into id from public.analysis_jls_restaurant_protocols p where p.sha256=p_sha;end if;
 return id;end $function$
;
CREATE OR REPLACE FUNCTION public.stage_jls_restaurant(p_run uuid, p_worker text, p_stage text, p_tasks jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;v jsonb;plan jsonb;draft jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.jls_restaurant_valid(r.id) or r.worker<>p_worker or r.lease_until<=now()
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status not in('completed','reused')) then return false;end if;
 if not (r.stage='jev' and p_stage='luna' or r.stage='luna' and p_stage='sol' or r.stage='sol' and p_stage='completed') then return false;end if;
 if p_stage='completed' then update public.analysis_jls_restaurant_runs set status='completed',lease_until=null where id=r.id;return true;end if;
 if p_stage='luna' then
  select body into plan from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='evidence_plan';
  if plan is null or jsonb_array_length(p_tasks)<>jsonb_array_length(plan->'luna_groups') or jsonb_array_length(p_tasks)>(p.body->>'max_luna_calls')::int
  or (plan->>'question_count')::int>32 or plan->>'source_sha256'<>p.body->'snapshot'->>'source_sha256' then return false;end if;
  if p.body->>'version'='jls-restaurant-resume-vi-32k-v1' and
   (plan->>'dossier_sha256' is distinct from p.body->'resume'->>'evidence_sha256'
    or plan->>'luna_manifest_sha256' is distinct from p.body->'resume'->>'luna_manifest_sha256'
    or plan->'sol_size_policy' is distinct from p.body->'sol_size_policy') then return false;end if;
 else
  select body into draft from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='sol_dossier';
  if draft is null or draft->'gate'->>'passed'<>'true' or jsonb_array_length(p_tasks)<>1 then return false;end if;
 end if;
 if p_stage='sol' and p.body->>'version'='jls-restaurant-resume-vi-32k-v1' and
  (coalesce((draft->'draft'->'estimates'->>'estimated_input_tokens')::int,-1) not between 1 and 32768
   or draft->'draft'->'config'->'sol_size_policy' is distinct from p.body->'sol_size_policy'
   or draft->'draft'->'request'->>'max_output_tokens' is distinct from '9500'
   or octet_length((draft->'draft'->'request')::text)>1048576) then return false;end if;
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

-- Existing SECURITY INVOKER, role checks, grants, RLS and immutable triggers retained.
