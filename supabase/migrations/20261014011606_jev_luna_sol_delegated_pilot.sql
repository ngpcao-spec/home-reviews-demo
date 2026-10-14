-- Technical preparation only. No authorization, run, task, cron invocation or provider call is created.
create table public.analysis_jev_luna_sol_protocols(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),plan_id uuid not null unique,
 foreign key(plan_id,organization_id) references public.analysis_jev_luna_sol_plans(id,organization_id),
 body jsonb not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),created_at timestamptz not null default now(),unique(id,organization_id));
alter table public.analysis_jev_luna_sol_protocols enable row level security;
revoke all on public.analysis_jev_luna_sol_protocols from anon,authenticated;
grant select on public.analysis_jev_luna_sol_protocols to authenticated;grant all on public.analysis_jev_luna_sol_protocols to service_role;
create policy jls_protocol_read on public.analysis_jev_luna_sol_protocols for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_luna_sol_protocols.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create index on public.analysis_jev_luna_sol_protocols(organization_id);
create trigger jls_protocol_immutable before update or delete on public.analysis_jev_luna_sol_protocols for each row execute function public.pilot_evidence_immutable();
create table public.analysis_jev_luna_sol_dossiers(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),run_id uuid not null unique,
 foreign key(run_id,organization_id) references public.analysis_jev_luna_sol_runs(id,organization_id),
 body jsonb not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),created_at timestamptz not null default now());
alter table public.analysis_jev_luna_sol_dossiers enable row level security;
revoke all on public.analysis_jev_luna_sol_dossiers from anon,authenticated;
grant select on public.analysis_jev_luna_sol_dossiers to authenticated;grant all on public.analysis_jev_luna_sol_dossiers to service_role;
create policy jls_dossier_read on public.analysis_jev_luna_sol_dossiers for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_luna_sol_dossiers.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create index on public.analysis_jev_luna_sol_dossiers(organization_id);
create trigger jls_dossier_immutable before update or delete on public.analysis_jev_luna_sol_dossiers for each row execute function public.pilot_evidence_immutable();
alter table public.analysis_jev_luna_sol_runs drop constraint analysis_jev_luna_sol_runs_status_check;
alter table public.analysis_jev_luna_sol_runs add constraint jls_delegated_status check(status in('blocked','queued','running','completed','failed','billing_uncertain','insufficient_evidence','needs_review','cost_review_required','authorization_expired'));
alter table public.analysis_jev_luna_sol_runs add column protocol_sha256 text;
alter table public.analysis_jev_luna_sol_runs add column consent_signature text;
alter table public.analysis_jev_luna_sol_runs add column operator_identity jsonb;
alter table public.analysis_jev_luna_sol_runs add column organization_authority_user_id uuid references auth.users(id);
alter table public.analysis_jev_luna_sol_runs add column authorization_recorded_by_role text;
alter table public.analysis_jev_luna_sol_runs add column gate jsonb;
alter table public.analysis_jev_luna_sol_runs add column error_code text;
alter table public.analysis_jev_luna_sol_runs add column completed_at timestamptz;
create index on public.analysis_jev_luna_sol_runs(organization_authority_user_id);
alter table public.analysis_jev_luna_sol_tasks add column parsed jsonb;
alter table public.analysis_jev_luna_sol_tasks add column provider_request_id text;
alter table public.analysis_jev_luna_sol_tasks add column usage_details jsonb;
alter table public.analysis_jev_luna_sol_tasks add column dispatched_at timestamptz;

create function public.jls_delegated_scope_check(p_plan uuid,p_verify_cache boolean default true) returns void language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_luna_sol_plans;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jev_luna_sol_plans where id=p_plan;
 if p.id is null or p.id<>'5295245f-b2c1-4f5d-80ad-ca9f821ae3da' or p.result_sha256<>'c096931805dbc7d4e655df7d1aaddd6bc92e96a6de784835e07c0220673b485a' or p.language<>'vi' or p.organization_id<>'93228bbb-6397-41e3-b8be-21ee7060eda7' or p.max_luna_calls<>24 or p.question_count<>25 or p.config_sha256<>'0004458504a1342e556ddccce7ab2d95eb2c4583305cb15a386e6d3fb09adf37' or p.dossier_sha256<>'d32edd725e7b31adbdad5903a7c62aa09a4dc0ab14272abaae60a4148533fa35' then raise exception 'JLS_DELEGATION_SCOPE_CHANGED';end if;
 if p_verify_cache then perform public.save_jls_preparation(p.body,p.result_sha256);end if; -- Complete integrity before authorization and every server wake; immutable pins before every dispatch.
end $$;
create function public.save_jls_delegated_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_luna_sol_plans;pid uuid;begin
 perform public.jls_delegated_scope_check((p_body->>'plan_id')::uuid);
 select * into p from public.analysis_jev_luna_sol_plans where id=(p_body->>'plan_id')::uuid;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or p_body->>'version' is distinct from 'jls-codex-delegated-pilot-v1' or
 p_body->>'plan_sha256' is distinct from p.result_sha256 or p_body->>'config_sha256' is distinct from p.config_sha256 or p_body->>'dossier_sha256' is distinct from p.dossier_sha256 or
 p_body->>'max_luna_calls' is distinct from '24' or p_body->>'max_sol_calls' is distinct from '1' or p_body->>'question_count' is distinct from '25' or
 p_body->>'preparation_is_not_spending_authorization' is distinct from 'true' or p_body->>'future_explicit_execution_consent_required' is distinct from 'true' or p_body->'estimates' is distinct from p.body->'estimates' or
 p_body->'sufficiency' is distinct from '{"version":"jls-evidence-sufficiency-v1","accepted":12,"axes":{"quality":2,"service":2,"price":2,"atmosphere":1},"negative":6,"low_star":4,"complete_calls":24,"complete_questions":25,"confidence_min":0.60}'::jsonb or p_body->'feasibility'->>'passed' is distinct from 'true' then raise exception 'JLS_PROTOCOL_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':protocol',0));
 select id into pid from public.analysis_jev_luna_sol_protocols where plan_id=p.id;
 if found then if not exists(select 1 from public.analysis_jev_luna_sol_protocols where id=pid and sha256=p_sha) then raise exception 'JLS_PROTOCOL_IMMUTABLE';end if;return pid;end if;
 insert into public.analysis_jev_luna_sol_protocols(organization_id,plan_id,body,sha256)values(p.organization_id,p.id,p_body,p_sha)returning id into pid;return pid;
end $$;
create function public.jls_delegation_valid(p_run uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;p public.analysis_jev_luna_sol_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run;
 select * into p from public.analysis_jev_luna_sol_protocols where plan_id=r.plan_id;
 return coalesce(r.id is not null and r.plan_id='5295245f-b2c1-4f5d-80ad-ca9f821ae3da' and r.consent_source='user_directive_codex_delegation' and r.authorized_identity is null and
 r.operator_identity='{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb and r.authorization_recorded_by_role='service_role' and
 r.consent_record->>'action'='execute_luna_and_sol_once' and r.consent_record->>'execution_authorized'='true' and r.consent_record->>'sol_phase_authorized'='true' and
 r.consent_sha256=encode(extensions.digest(public.jev_economy_canonical(r.consent_record),'sha256'),'hex') and r.protocol_sha256=p.sha256 and
 r.consent_signature=encode(extensions.hmac(public.jev_economy_canonical(r.consent_record),(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token'),'sha256'),'hex') and
 r.consent_record->>'protocol_sha256'=p.sha256 and r.consent_record->>'directive_sha256'=encode(extensions.digest(r.consent_record->>'user_directive','sha256'),'hex') and
 r.expires_at>now() and exists(select 1 from public.organization_members m where m.user_id=r.organization_authority_user_id and m.organization_id=r.organization_id and m.role in('owner','admin','manager')),false);
end $$;
drop trigger jls_execution_closed on public.analysis_jev_luna_sol_runs;
drop trigger jls_execution_closed on public.analysis_jev_luna_sol_tasks;
create function public.jls_delegated_state_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;p public.analysis_jev_luna_sol_plans;d public.analysis_jev_luna_sol_dossiers;begin
 if tg_op='DELETE' then raise exception 'JLS_HISTORY_IMMUTABLE';end if;
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if tg_table_name='analysis_jev_luna_sol_runs' then
  if tg_op='UPDATE' and (old.status in('completed','failed','billing_uncertain','insufficient_evidence','needs_review','cost_review_required','authorization_expired') or
   row(new.plan_id,new.organization_id,new.consent_source,new.consent_record,new.consent_sha256,new.consent_signature,new.authorized_identity,new.expires_at,new.max_luna_calls,new.max_sol_calls,new.protocol_sha256,new.operator_identity,new.organization_authority_user_id,new.authorization_recorded_by_role) is distinct from row(old.plan_id,old.organization_id,old.consent_source,old.consent_record,old.consent_sha256,old.consent_signature,old.authorized_identity,old.expires_at,old.max_luna_calls,old.max_sol_calls,old.protocol_sha256,old.operator_identity,old.organization_authority_user_id,old.authorization_recorded_by_role)) then raise exception 'JLS_AUTHORIZATION_IMMUTABLE';end if;
  if new.plan_id<>'5295245f-b2c1-4f5d-80ad-ca9f821ae3da' or new.authorized_identity is not null or new.max_luna_calls<>24 or new.max_sol_calls<>1 or new.operator_identity is distinct from '{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb or new.authorization_recorded_by_role is distinct from 'service_role' or new.consent_record->>'execution_authorized' is distinct from 'true' or new.consent_record->>'action' is distinct from 'execute_luna_and_sol_once' then raise exception 'JLS_NEW_EXECUTION_DIRECTIVE_REQUIRED';end if;
 else
  select * into r from public.analysis_jev_luna_sol_runs where id=new.run_id and organization_id=new.organization_id;
  select * into p from public.analysis_jev_luna_sol_plans where id=r.plan_id;
  if r.id is null or p.id is null then raise exception 'FORBIDDEN';end if;
  if tg_op='UPDATE' then
   if old.status in('completed','failed','billing_uncertain','invalid_output','cancelled') or new.request_count<old.request_count or
    row(new.run_id,new.organization_id,new.phase,new.task_key,new.review_id,new.request,new.request_sha256,new.requested_model) is distinct from row(old.run_id,old.organization_id,old.phase,old.task_key,old.review_id,old.request,old.request_sha256,old.requested_model) or
    old.request_count=1 and new.status in('queued','running') then raise exception 'JLS_NO_PAID_RETRY';end if;
  elsif new.status<>'queued' or new.request_count<>0 or not public.jls_delegation_valid(r.id) then raise exception 'JLS_DELEGATION_REQUIRED';end if;
  if new.request_sha256<>encode(extensions.digest(public.jev_economy_canonical(new.request),'sha256'),'hex') then raise exception 'JLS_REQUEST_CHANGED';end if;
  if new.phase='luna' then
   if not exists(select 1 from jsonb_array_elements(p.body->'luna_groups') g where g->>'review_id'=new.review_id::text and g->'payload'=new.request and g->>'request_sha256'=new.request_sha256) or
    tg_op='INSERT' and (select count(*) from public.analysis_jev_luna_sol_tasks where run_id=r.id and phase='luna')>=24 then raise exception 'JLS_CALL_LIMIT_OR_REQUEST_CHANGED';end if;
  else
   select * into d from public.analysis_jev_luna_sol_dossiers where run_id=r.id;
   if d.id is null or d.body->'request' is distinct from new.request then raise exception 'JLS_SOL_DOSSIER_REQUIRED';end if;
  end if;
 end if;return new;
end $$;
create trigger jls_delegated_guard before insert or update or delete on public.analysis_jev_luna_sol_runs for each row execute function public.jls_delegated_state_guard();
create trigger jls_delegated_guard before insert or update or delete on public.analysis_jev_luna_sol_tasks for each row execute function public.jls_delegated_state_guard();
create function public.jls_authorize_delegated(p_plan uuid,p_protocol_sha text,p_authorization jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_luna_sol_plans;q public.analysis_jev_luna_sol_protocols;rid uuid;authority uuid;g jsonb;begin
 perform public.jls_delegated_scope_check(p_plan);
 select * into p from public.analysis_jev_luna_sol_plans where id=p_plan;select * into q from public.analysis_jev_luna_sol_protocols where plan_id=p.id;
 select created_by into authority from public.analysis_jev_pilot_snapshots where id=p.source_snapshot_id;
 if not exists(select 1 from public.organization_members where user_id=authority and organization_id=p.organization_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if q.id is null or p_protocol_sha<>q.sha256 or p_authorization->>'protocol_sha256' is distinct from q.sha256 or
 p_authorization->>'version' is distinct from 'jls-codex-delegated-pilot-v1' or p_authorization->>'action' is distinct from 'execute_luna_and_sol_once' or p_authorization->>'execution_authorized' is distinct from 'true' or p_authorization->>'sol_phase_authorized' is distinct from 'true' or
 p_authorization->>'consent_source' is distinct from 'user_directive_codex_delegation' or p_authorization->'operator_identity' is distinct from '{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb or
 p_authorization->>'directive_sha256' is distinct from encode(extensions.digest(p_authorization->>'user_directive','sha256'),'hex') or length(coalesce(p_authorization->>'user_directive',''))<20 or
 p_authorization->'scope' is distinct from jsonb_build_object('plan_id',p.id,'plan_sha256',p.result_sha256,'config_sha256',p.config_sha256,'dossier_sha256',p.dossier_sha256,'organization_id',p.organization_id,'max_luna_calls',24,'max_sol_calls',1,'question_count',25,'automatic_retry',false,'language','vi','luna_model','gpt-6-luna','luna_endpoint','/v1/decisions','sol_model','gpt-6.1-sol','sol_endpoint','/v1/responses') or
 p_authorization->'approved_estimates' is distinct from p.body->'estimates' then raise exception 'JLS_NEW_EXECUTION_DIRECTIVE_REQUIRED';end if;
 if p_authorization->>'requested_at' is null or p_authorization->>'expires_at' is null or (p_authorization->>'requested_at')::timestamptz>now() or (p_authorization->>'requested_at')::timestamptz<now()-interval '24 hours' or (p_authorization->>'expires_at')::timestamptz<>(p_authorization->>'requested_at')::timestamptz+interval '24 hours' or (p_authorization->>'expires_at')::timestamptz<=now() then raise exception 'JLS_DELEGATION_EXPIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':delegated-run',0));
 select id into rid from public.analysis_jev_luna_sol_runs where plan_id=p.id;if found then return rid;end if;
 insert into public.analysis_jev_luna_sol_runs(organization_id,plan_id,status,consent_source,consent_record,consent_sha256,consent_signature,expires_at,max_luna_calls,max_sol_calls,protocol_sha256,operator_identity,organization_authority_user_id,authorization_recorded_by_role)
 values(p.organization_id,p.id,'queued','user_directive_codex_delegation',p_authorization,encode(extensions.digest(public.jev_economy_canonical(p_authorization),'sha256'),'hex'),encode(extensions.hmac(public.jev_economy_canonical(p_authorization),(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token'),'sha256'),'hex'),(p_authorization->>'expires_at')::timestamptz,24,1,q.sha256,p_authorization->'operator_identity',authority,current_user)returning id into rid;
 for g in select value from jsonb_array_elements(p.body->'luna_groups') loop
 insert into public.analysis_jev_luna_sol_tasks(organization_id,run_id,phase,task_key,review_id,status,request,request_sha256,requested_model)
 values(p.organization_id,rid,'luna',g->>'review_id',(g->>'review_id')::uuid,'queued',g->'payload',g->>'request_sha256','gpt-6-luna');end loop;
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload)values(p.organization_id,p.id,'user_directive_codex_delegation',jsonb_build_object('run_id',rid,'operator_identity',p_authorization->'operator_identity','directive_sha256',p_authorization->>'directive_sha256','consent_sha256',encode(extensions.digest(public.jev_economy_canonical(p_authorization),'sha256'),'hex'),'recorded_by_role',current_user));
 return rid;
end $$;
create function public.jls_stop_delegated(p_run uuid,p_status text,p_error text) returns void language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run for update;
 if r.id is null or r.status not in('queued','running') then return;end if;
 if p_status not in('failed','billing_uncertain','insufficient_evidence','cost_review_required','authorization_expired') then raise exception 'JLS_STATUS_INVALID';end if;
 update public.analysis_jev_luna_sol_tasks set status='cancelled',error_code=p_error,completed_at=now() where run_id=r.id and status='queued';
 update public.analysis_jev_luna_sol_runs set status=p_status,error_code=p_error,completed_at=now() where id=r.id;
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload)values(r.organization_id,r.plan_id,'run_stopped_no_retry',jsonb_build_object('run_id',r.id,'status',p_status,'error_code',p_error));
end $$;
create or replace function public.claim_jls_task(p_run uuid,p_worker text,p_phase text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;t public.analysis_jev_luna_sol_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run and status in('queued','running') for update;if r.id is null then return null;end if;
 if exists(select 1 from public.analysis_jev_luna_sol_tasks where run_id=r.id and status='running' and lease_until<now()) then
  update public.analysis_jev_luna_sol_tasks set status='billing_uncertain',error_code='WORKER_RESPONSE_LOST',completed_at=now() where run_id=r.id and status='running' and lease_until<now();
  perform public.jls_stop_delegated(r.id,'billing_uncertain','WORKER_RESPONSE_LOST');return null;end if;
 if not public.jls_delegation_valid(r.id) then perform public.jls_stop_delegated(r.id,'authorization_expired','JLS_AUTHORIZATION_UNAVAILABLE');return null;end if;
 perform public.jls_delegated_scope_check(r.plan_id,false);
 if (select count(*) from public.analysis_jev_luna_sol_tasks where run_id=r.id and status='running')>=8 then return null;end if;
 select * into t from public.analysis_jev_luna_sol_tasks where run_id=r.id and phase=p_phase and status='queued' order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if (select coalesce(sum(request_count),0) from public.analysis_jev_luna_sol_tasks where run_id=r.id and phase=p_phase)>=(case when p_phase='luna' then 24 else 1 end) then return null;end if;
 update public.analysis_jev_luna_sol_runs set status='running' where id=r.id;
 update public.analysis_jev_luna_sol_tasks set status='running',request_count=1,lease_owner=p_worker,lease_until=now()+interval '5 minutes',dispatched_at=now() where id=t.id returning * into t;
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload)values(r.organization_id,r.plan_id,'attempt_reserved',jsonb_build_object('run_id',r.id,'task_id',t.id,'phase',p_phase,'request_sha256',t.request_sha256));return to_jsonb(t);
end $$;
create function public.jls_finish_delegated(p_task uuid,p_worker text,p_status text,p_output jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.analysis_jev_luna_sol_tasks;r public.analysis_jev_luna_sol_runs;p public.analysis_jev_luna_sol_plans;d jsonb;e jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jev_luna_sol_tasks where id=p_task and status='running' and lease_owner=p_worker for update;
 if t.id is null then return false;end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=t.run_id;select * into p from public.analysis_jev_luna_sol_plans where id=r.plan_id;
 if p_status not in('completed','failed','billing_uncertain','invalid_output') then raise exception 'JLS_STATUS_INVALID';end if;
 if p_output ? 'response' and p_output->>'response_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_output->'response'),'sha256'),'hex') then raise exception 'JLS_RESPONSE_HASH_CHANGED';end if;
 if p_status='completed' and (p_output->>'served_model' is distinct from t.requested_model or not(p_output ? 'parsed') or not(p_output ? 'input_tokens') or not(p_output ? 'cost_usd')) then raise exception 'JLS_COMPLETED_TELEMETRY_MISSING';end if;
 if p_status='completed' and t.phase='luna' then
  if jsonb_array_length(p_output->'parsed'->'decisions')<>jsonb_array_length(t.request->'questions') or
   (select count(distinct v->>'evidence_id') from jsonb_array_elements(p_output->'parsed'->'decisions')v)<>jsonb_array_length(t.request->'questions') then raise exception 'JLS_ANSWER_COUNT_CHANGED';end if;
  for d in select value from jsonb_array_elements(p_output->'parsed'->'decisions') loop
   select value into e from jsonb_array_elements(p.body->'selected') where value->>'evidence_id'=d->>'evidence_id' and value->>'review_id'=t.review_id::text;
   if e is null or d->>'theme_key' is distinct from e->>'theme_key' or d->>'polarity' is distinct from e->>'polarity' or d->>'quote_sha256' is distinct from e->>'quote_sha256' or d->>'analysis_text_sha256' is distinct from e->>'analysis_text_sha256' or d->>'request_sha256' is distinct from t.request_sha256 or d->>'config_sha256' is distinct from p.config_sha256 or d->>'response_sha256' is distinct from p_output->>'response_sha256' or d->>'served_model' is distinct from 'gpt-6-luna' then raise exception 'JLS_DECISION_CHANGED';end if;
   if d->>'status'='ACCEPTED' and (d->>'native_choice' is distinct from 'supported' or coalesce((d->>'confidence')::numeric,0)<0.6 or d->>'refused' is distinct from 'false') then raise exception 'JLS_CONFIDENCE_GATE_CHANGED';end if;
   insert into public.analysis_jev_luna_sol_verdicts(organization_id,task_id,evidence_id,body,result_sha256,status) values(t.organization_id,t.id,d->>'evidence_id',d,encode(extensions.digest(public.jev_economy_canonical(d),'sha256'),'hex'),d->>'status');
  end loop;
 end if;
 update public.analysis_jev_luna_sol_tasks set status=p_status,response=p_output->'response',response_sha256=p_output->>'response_sha256',parsed=p_output->'parsed',served_model=p_output->>'served_model',input_tokens=(p_output->>'input_tokens')::bigint,output_tokens=(p_output->>'output_tokens')::bigint,cost_usd=(p_output->>'cost_usd')::numeric,duration_ms=(p_output->>'duration_ms')::bigint,error_code=p_output->>'error_code',response_id=p_output->>'response_id',provider_request_id=p_output->>'provider_request_id',usage_details=p_output->'usage_details',completed_at=now() where id=t.id;
 return true;
end $$;
create function public.jls_evidence_gate(p_run uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;ok boolean;a int;n int;lo int;q int;s int;pr int;at int;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run;
 ok:=(select count(*) from public.analysis_jev_luna_sol_tasks where run_id=r.id and phase='luna' and status='completed' and request_count=1)=24;
 select count(*) into a from public.analysis_jev_luna_sol_verdicts v join public.analysis_jev_luna_sol_tasks t on t.id=v.task_id where t.run_id=r.id and v.status='ACCEPTED';
 select count(*) filter(where e->>'polarity'='negative'),count(*) filter(where (e->>'rating')::int between 1 and 3),count(*) filter(where e->>'axis'='quality'),count(*) filter(where e->>'axis'='service'),count(*) filter(where e->>'axis'='price'),count(*) filter(where e->>'axis'='atmosphere') into n,lo,q,s,pr,at
 from public.analysis_jev_luna_sol_plans p cross join lateral jsonb_array_elements(p.body->'selected') e where p.id=r.plan_id and exists(select 1 from public.analysis_jev_luna_sol_verdicts v join public.analysis_jev_luna_sol_tasks t on t.id=v.task_id where t.run_id=r.id and v.evidence_id=e->>'evidence_id' and v.status='ACCEPTED');
 return jsonb_build_object('passed',ok and a>=12 and n>=6 and lo>=4 and q>=2 and s>=2 and pr>=2 and at>=1,'complete',ok,'accepted',a,'negative',n,'low_star',lo,'axes',jsonb_build_object('quality',q,'service',s,'price',pr,'atmosphere',at));
end $$;
create function public.jls_freeze_sol(p_run uuid,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;p public.analysis_jev_luna_sol_plans;g jsonb;known text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run and status in('queued','running') for update;if r.id is null then return false;end if;
 if not public.jls_delegation_valid(r.id) then perform public.jls_stop_delegated(r.id,'authorization_expired','JLS_AUTHORIZATION_EXPIRED');return false;end if;
 g:=public.jls_evidence_gate(r.id);update public.analysis_jev_luna_sol_runs set gate=g where id=r.id;
 if g->>'passed'<>'true' then perform public.jls_stop_delegated(r.id,'insufficient_evidence','JLS_EVIDENCE_GATE_FAILED');return false;end if;
 select * into p from public.analysis_jev_luna_sol_plans where id=r.plan_id;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or p_body->>'dossier_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'packet'),'sha256'),'hex') or
 p_body->'packet'->'statistics' is distinct from p.body->'statistics' or p_body->>'statistics_sha256' is distinct from p.statistics_sha256 or p_body->'request'->>'model' is distinct from 'gpt-6.1-sol' or
 (p_body->'request'->'input'->1->>'content')::jsonb is distinct from p_body->'packet' or (p_body->'request'->>'max_output_tokens')::int<>9500 or p_body->'request'->'reasoning'->>'effort' is distinct from 'low' then raise exception 'JLS_SOL_DOSSIER_CHANGED';end if;
 if (p_body->'request' #- '{input,1,content}') is distinct from (p.body->'conditional_sol_preview'->'request' #- '{input,1,content}') or
 p_body->>'prompt_sha256' is distinct from p.body->>'prompt_sha256' or p_body->>'schema_sha256' is distinct from p.body->>'schema_sha256' or
 p_body->'estimates'->'rates' is distinct from p.body->'estimates'->'sol'->'rates' then raise exception 'JLS_SOL_CONFIGURATION_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p_body->'packet'->'evidence') e where encode(extensions.digest(e->>'quote','sha256'),'hex') is distinct from e->>'quote_sha256' or
  not exists(select 1 from jsonb_array_elements(p.body->'selected') s where s->>'evidence_id'=e->>'evidence_id' and s->>'review_id'=e->>'review_id' and s->>'quote'=e->>'quote' and s->>'quote_sha256'=e->>'quote_sha256' and s->>'theme_key'=e->>'theme_key' and s->>'polarity'=e->>'polarity' and s->>'axis'=e->>'axis' and s->>'analysis_text_sha256'=e->>'analysis_text_sha256' and (s->>'context'=e->>'context' or e->'context'='null'::jsonb and s->>'context'=s->>'quote'))) then raise exception 'JLS_SOL_QUOTE_BINDING_CHANGED';end if;
 if jsonb_array_length(p_body->'packet'->'evidence')<>(g->>'accepted')::int or
 (select count(distinct e->>'evidence_id') from jsonb_array_elements(p_body->'packet'->'evidence') e)<>(g->>'accepted')::int or
 exists(select 1 from jsonb_array_elements(p_body->'packet'->'evidence') e where not exists(select 1 from public.analysis_jev_luna_sol_verdicts v join public.analysis_jev_luna_sol_tasks t on t.id=v.task_id where t.run_id=r.id and v.evidence_id=e->>'evidence_id' and v.status='ACCEPTED' and v.body->>'quote_sha256'=e->>'quote_sha256')) then raise exception 'JLS_NONACCEPTED_SOL_EVIDENCE';end if;
 if p_body->'estimates'->>'high_estimated_cost_usd' is null or (p_body->'estimates'->>'high_estimated_cost_usd')::numeric>(r.consent_record->'approved_estimates'->'sol'->>'high_estimated_cost_usd')::numeric+0.000000000001 or (p_body->'estimates'->>'estimated_input_tokens')::int>20000 then perform public.jls_stop_delegated(r.id,'cost_review_required','JLS_SOL_ESTIMATE_REQUIRES_NEW_APPROVAL');return false;end if;
 select sha256 into known from public.analysis_jev_luna_sol_dossiers where run_id=r.id;
 if found then if known<>p_sha then raise exception 'JLS_SOL_DOSSIER_IMMUTABLE';end if;return true;end if;
 insert into public.analysis_jev_luna_sol_dossiers(organization_id,run_id,body,sha256)values(r.organization_id,r.id,p_body,p_sha);
 insert into public.analysis_jev_luna_sol_tasks(organization_id,run_id,phase,task_key,status,request,request_sha256,requested_model)values(r.organization_id,r.id,'sol','report','queued',p_body->'request',encode(extensions.digest(public.jev_economy_canonical(p_body->'request'),'sha256'),'hex'),'gpt-6.1-sol');
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload)values(r.organization_id,r.plan_id,'sol_dossier_frozen_after_luna',jsonb_build_object('run_id',r.id,'gate',g,'dossier_sha256',p_body->>'dossier_sha256','estimates',p_body->'estimates'));return true;
end $$;
create function public.jls_complete_delegated(p_run uuid,p_body jsonb,p_sha text,p_status text) returns void language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run and status='running' for update;if r.id is null then return;end if;
 if p_status not in('completed','needs_review') or p_sha<>encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or
 not exists(select 1 from public.analysis_jev_luna_sol_tasks where run_id=r.id and phase='sol' and status='completed' and request_count=1 and parsed=p_body->'sol_result') or
 p_body->'statistics' is distinct from (select body->'statistics' from public.analysis_jev_luna_sol_plans where id=r.plan_id) then raise exception 'JLS_RESULT_CHANGED';end if;
 insert into public.analysis_jev_luna_sol_results(organization_id,run_id,body,result_sha256)values(r.organization_id,r.id,p_body,p_sha);
 update public.analysis_jev_luna_sol_runs set status=p_status,completed_at=now() where id=r.id;
end $$;
create function public.jls_wake_delegated(p_run uuid) returns bigint language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_luna_sol_runs;request bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_luna_sol_runs where id=p_run and status in('queued','running');if r.id is null then return null;end if;
 if not public.jls_delegation_valid(r.id) then perform public.jls_stop_delegated(r.id,'authorization_expired','JLS_AUTHORIZATION_EXPIRED');return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jev-luna-sol-hybrid',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:=jsonb_build_object('run_id',r.id),timeout_milliseconds:=1000) into request;return request;
end $$;
-- Durable wake-up controller sees no jobs in this delivery. It can only wake valid future delegated runs.
create function private.dispatch_jls_delegated() returns void language plpgsql security invoker set search_path='' as $$declare r record;begin
 for r in select id from public.analysis_jev_luna_sol_runs where status in('queued','running') loop perform public.jls_wake_delegated(r.id);end loop;
end $$;
do $$declare fn text;begin foreach fn in array array['jls_delegated_scope_check(uuid,boolean)','save_jls_delegated_protocol(jsonb,text)','jls_delegation_valid(uuid)','jls_delegated_state_guard()','jls_authorize_delegated(uuid,text,jsonb)','jls_stop_delegated(uuid,text,text)','claim_jls_task(uuid,text,text)','jls_finish_delegated(uuid,text,text,jsonb)','jls_evidence_gate(uuid)','jls_freeze_sol(uuid,jsonb,text)','jls_complete_delegated(uuid,jsonb,text,text)','jls_wake_delegated(uuid)'] loop
 execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;
revoke all on function private.dispatch_jls_delegated() from public,anon,authenticated;grant execute on function private.dispatch_jls_delegated() to service_role;
grant usage on schema private to service_role;
-- The scheduler itself is non-billable; no run exists, hence no HTTP wake or paid attempt.
select cron.schedule('jls-delegated-durable-wake','* * * * *','set local role service_role; select private.dispatch_jls_delegated();');
