-- Preparation and diagnostics only. No paid run/consent/job is created.
create table public.analysis_jls_restaurant_prepared_artifacts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,source_protocol_id uuid not null,
 body jsonb not null,sha256 text not null unique check(sha256~'^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 foreign key(source_protocol_id,organization_id) references public.analysis_jls_restaurant_protocols(id,organization_id));
create table public.analysis_jls_restaurant_cpu_probes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,protocol_id uuid not null,nonce text not null unique,
 body jsonb not null,sha256 text not null,created_at timestamptz not null default now(),
 foreign key(protocol_id,organization_id) references public.analysis_jls_restaurant_protocols(id,organization_id));
create index jls_prepared_source_org on public.analysis_jls_restaurant_prepared_artifacts(source_protocol_id,organization_id);
create index jls_cpu_probe_protocol_org on public.analysis_jls_restaurant_cpu_probes(protocol_id,organization_id);
do $$declare t text;begin foreach t in array array['analysis_jls_restaurant_prepared_artifacts','analysis_jls_restaurant_cpu_probes'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy restaurant_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
 execute format('create trigger immutable before update or delete on public.%I for each row execute function public.pilot_evidence_immutable()',t);
end loop;end $$;
alter table public.analysis_jls_restaurant_runs drop constraint analysis_jls_restaurant_runs_stage_check;
alter table public.analysis_jls_restaurant_runs add constraint analysis_jls_restaurant_runs_stage_check check(stage in('jev','luna','prepare_sol','sol'));
create function public.save_jls_restaurant_prepared_artifact(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 if p.id is null or p_sha<>public.jls_restaurant_hash(p_body) or p.body->>'version'<>'jls-restaurant-resume-vi-32k-v1'
 or p_body->>'version' is distinct from 'jls-deterministic-artifacts-v1' or p_body->>'source_protocol_sha256' is distinct from p.sha256
 or p_body->>'plan_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan')
 or p_body->>'token_certificate_sha256' is distinct from public.jls_restaurant_hash(p_body->'token_certificate')
 or p_body->'token_certificate'->>'version' is distinct from 'jls-o200k-frozen-measurements-v1'
 or p_body->'plan'->>'source_plan_sha256' is distinct from p.sha256
 or p_body->'plan'->>'statistics_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan'->'statistics')
 or p_body->'plan'->>'config_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan'->'config')
 or p_body->'plan'->>'dossier_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan'->'selected')
 or p_body->'plan'->>'luna_manifest_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan'->'luna_groups')
 or (p_body->'plan'->>'max_luna_calls')::int not between 1 and 28
 or p_body->'plan'->>'source_sha256' is distinct from p.body->'snapshot'->>'source_sha256'
 or not exists(select 1 from public.analysis_jls_restaurant_runs r where r.id=(p_body->>'source_run_id')::uuid
 and r.protocol_id=p.id and r.status='blocked' and not exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=r.id and t.phase in('luna','sol')))
 then raise exception 'JLS_PREPARED_ARTIFACT_INVALID';end if;
 insert into public.analysis_jls_restaurant_prepared_artifacts(organization_id,source_protocol_id,body,sha256)
 values(p.organization_id,p.id,p_body,p_sha) on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_prepared_artifacts where sha256=p_sha;end if;return rid;end $$;
create function public.check_jls_restaurant_prepared_cache(p_protocol uuid) returns boolean language plpgsql stable set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 return p.body->'prepared' is not null and p.sha256=public.jls_restaurant_hash(p.body) and
 jsonb_array_length(p.body->'cache')=jsonb_array_length(p.body->'english_review_ids') and not exists(
 select 1 from jsonb_array_elements(p.body->'cache') x left join public.analysis_jev_review_cache c on c.id=(x->>'id')::uuid
 where c.id is null or c.status<>'completed' or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or to_jsonb(c)<>x);
end $$;
create function public.record_jls_restaurant_cpu_probe(p_protocol uuid,p_nonce text,p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 if p.id is null or p.body->'prepared' is null or p_body->>'explicit_non_provider_test' is distinct from 'true'
 or p_body->>'provider_calls' is distinct from '0' or p_sha<>public.jls_restaurant_hash(p_body) then raise exception 'JLS_CPU_PROBE_INVALID';end if;
 insert into public.analysis_jls_restaurant_cpu_probes(organization_id,protocol_id,nonce,body,sha256) values(p.organization_id,p.id,p_nonce,p_body,p_sha)
 on conflict(nonce) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_cpu_probes where nonce=p_nonce and sha256=p_sha;end if;
 if rid is null then raise exception 'JLS_PROBE_IMMUTABLE';end if;return rid;end $$;
create function public.wake_jls_restaurant_cpu_probe(p_protocol uuid,p_nonce text,p_phase text) returns bigint language plpgsql set search_path='' as $$
declare req bigint;p public.analysis_jls_restaurant_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 if p.id is null or p.body->'prepared' is null or length(p_nonce)<8 or length(p_nonce)>100 or
 p_phase not in('verify','prepare_sol','sol_pre_send_validate') or not exists(select 1 from public.organization_members m
 where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager')) then raise exception 'JLS_CPU_PROBE_INVALID';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode','cpu_probe','protocol_id',p.id,'nonce',p_nonce,'phase',p_phase),timeout_milliseconds:=1000) into req;return req;end $$;
CREATE OR REPLACE FUNCTION public.save_jls_restaurant_protocol(p_body jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare id uuid;org uuid=(p_body->>'organization_id')::uuid;est uuid=(p_body->>'establishment_id')::uuid;u uuid=(p_body->>'authority_user_id')::uuid;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version' not in('jls-restaurant-delegated-vi-v1','jls-restaurant-resume-vi-32k-v1','jls-restaurant-prepared-vi-v1')
 or est<>'d40d3438-79d8-4c28-8b09-eba640598201'::uuid or not exists(select 1 from public.establishments e where e.id=est and e.organization_id=org and e.active)
 or not exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=u and m.role in('owner','admin','manager'))
 or (p_body->>'max_sol_calls')::int<>1 or (p_body->>'max_luna_calls')::int not between 1 and 32
 or (p_body->>'max_jev_calls')::int<>jsonb_array_length(p_body->'pending')
 or p_body->>'preparation_is_not_spending_authorization'<>'true'
 or p_body->'configuration'->'policy'->>'no_monetary_estimate'<>'true'
 or p_body->'configuration'->'policy'->>'automatic_retry'<>'false'
 or p_body->'configuration'->'policy'->>'language'<>'vi' then raise exception 'JLS_PROTOCOL_INVALID';end if;
 if p_body->>'version'='jls-restaurant-delegated-vi-v1' and (p_body->>'max_luna_calls')::int<>32 then raise exception 'JLS_PROTOCOL_INVALID';end if;
 if p_body->>'version' in('jls-restaurant-resume-vi-32k-v1','jls-restaurant-prepared-vi-v1') then
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
 if p_body->>'version'='jls-restaurant-prepared-vi-v1' and
 not exists(select 1 from public.analysis_jls_restaurant_prepared_artifacts a where a.sha256=p_body->'prepared'->>'artifact_sha256'
 and a.organization_id=org and a.source_protocol_id=(p_body->'prepared'->>'source_protocol_id')::uuid
 and a.body->>'source_protocol_sha256'=p_body->'prepared'->>'source_protocol_sha256'
 and a.body->'plan'->>'source_sha256'=p_body->'snapshot'->>'source_sha256'
 and p_body->'configuration'->'prepared_execution'->>'maximum_stages_per_wake'='1'
 and p_body->'configuration'->'prepared_execution'->>'full_reconstruction_at_wake'='false')
 then raise exception 'JLS_PREPARED_ARTIFACT_MISSING';end if;
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
 if p_stage='sol' and p.body->>'version'='jls-restaurant-resume-vi-32k-v1' and
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
do $$declare f record;begin for f in select oid::regprocedure p from pg_proc where pronamespace='public'::regnamespace and
proname in('save_jls_restaurant_prepared_artifact','check_jls_restaurant_prepared_cache','record_jls_restaurant_cpu_probe','wake_jls_restaurant_cpu_probe') loop
execute format('revoke all on function %s from public,anon,authenticated',f.p);execute format('grant execute on function %s to service_role',f.p);end loop;end $$;
