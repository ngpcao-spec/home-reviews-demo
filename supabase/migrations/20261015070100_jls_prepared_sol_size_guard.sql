-- Preserve the SQL size guard on both resume and CPU-prepared protocols.
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
 update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;end $function$;
