-- Separate experiment. This migration creates NO consent, run, task or HTTP call.
create table public.analysis_jls_prioritized_protocols(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 source_plan_id uuid not null,preparation_event_id bigint not null references public.analysis_jev_luna_sol_events(id),
 version text not null check(version='jls-prioritized-vi-delegated-execution-v1'),language text not null check(language='vi'),
 body jsonb not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 unique(id,organization_id),unique(source_plan_id,version,language),
 foreign key(source_plan_id,organization_id) references public.analysis_jev_luna_sol_plans(id,organization_id));
create index jls_pri_protocol_scope on public.analysis_jls_prioritized_protocols(source_plan_id,organization_id);
create index jls_pri_protocol_event on public.analysis_jls_prioritized_protocols(preparation_event_id);
create table public.analysis_jls_prioritized_runs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 protocol_id uuid not null unique,protocol_sha256 text not null,
 status text not null check(status in('queued','running','completed','needs_review','invalid_output','billing_uncertain','authorization_expired','blocked_incompatible','failed')),
 consent_source text not null check(consent_source='user_directive_codex_delegation'),consent_record jsonb not null,
 consent_sha256 text not null,consent_signature text not null,operator_identity jsonb not null,
 organization_authority_user_id uuid not null references auth.users(id),authorization_recorded_by_role text not null,
 expires_at timestamptz not null,error_code text,created_at timestamptz not null default now(),completed_at timestamptz,
 unique(id,organization_id),foreign key(protocol_id,organization_id) references public.analysis_jls_prioritized_protocols(id,organization_id));
create index jls_pri_run_scope on public.analysis_jls_prioritized_runs(protocol_id,organization_id);
create index jls_pri_run_authority on public.analysis_jls_prioritized_runs(organization_authority_user_id);
create table public.analysis_jls_prioritized_tasks(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),run_id uuid not null unique,
 request jsonb not null,request_sha256 text not null,requested_model text not null check(requested_model='gpt-6.1-sol'),
 status text not null check(status in('queued','running','completed','needs_review','invalid_output','billing_uncertain','authorization_expired','blocked_incompatible','failed')),
 request_count integer not null default 0 check(request_count in(0,1)),lease_owner text,lease_until timestamptz,
 dispatched_at timestamptz,completed_at timestamptz,error_code text,created_at timestamptz not null default now(),
 foreign key(run_id,organization_id) references public.analysis_jls_prioritized_runs(id,organization_id));
create index jls_pri_task_scope on public.analysis_jls_prioritized_tasks(run_id,organization_id);
create table public.analysis_jls_prioritized_results(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),run_id uuid not null unique,
 body jsonb not null,sha256 text not null,created_at timestamptz not null default now(),
 foreign key(run_id,organization_id) references public.analysis_jls_prioritized_runs(id,organization_id));
create index jls_pri_result_scope on public.analysis_jls_prioritized_results(run_id,organization_id);
create table public.analysis_jls_prioritized_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id),protocol_id uuid not null,
 run_id uuid,action text not null,payload jsonb not null,created_at timestamptz not null default now(),
 foreign key(protocol_id,organization_id) references public.analysis_jls_prioritized_protocols(id,organization_id),
 foreign key(run_id,organization_id) references public.analysis_jls_prioritized_runs(id,organization_id));
create index jls_pri_event_protocol on public.analysis_jls_prioritized_events(protocol_id,organization_id);
create index jls_pri_event_run on public.analysis_jls_prioritized_events(run_id,organization_id);
do $$ declare t text; begin
 foreach t in array array['analysis_jls_prioritized_protocols','analysis_jls_prioritized_runs','analysis_jls_prioritized_tasks','analysis_jls_prioritized_results','analysis_jls_prioritized_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy jls_pri_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
  if t in('analysis_jls_prioritized_protocols','analysis_jls_prioritized_results','analysis_jls_prioritized_events') then
   execute format('create trigger immutable before update or delete on public.%I for each row execute function public.pilot_evidence_immutable()',t);
  end if;
 end loop;
end $$;
grant usage,select on sequence public.analysis_jls_prioritized_events_id_seq to service_role;

create function public.jls_pri_source_check(p_preparation bigint,p_verify_cache boolean default true) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.analysis_jev_luna_sol_events;p public.analysis_jev_luna_sol_plans;r public.analysis_jev_luna_sol_results;t record; begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into e from public.analysis_jev_luna_sol_events where id=p_preparation;
 select * into p from public.analysis_jev_luna_sol_plans where id=e.plan_id and organization_id=e.organization_id;
 select * into r from public.analysis_jev_luna_sol_results where run_id='489d42ae-c44c-40c1-8435-16f304c71a9e' and organization_id=e.organization_id;
 if e.id is distinct from 232 or e.action is distinct from 'prioritized_report_format_prepared_v1' or
  e.payload->>'sha256' is distinct from '681f0a58fb2189bc583064042031abc1d5d73aa626b83710dc68250c35b97df0' or
  e.payload->>'sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(e.payload->'body'),'sha256'),'hex') or
  e.payload->'body'->>'language' is distinct from 'vi' or e.payload->'body'->>'source_run_id' is distinct from r.run_id::text or
  r.result_sha256 is distinct from e.payload->'body'->>'source_result_sha256' or r.result_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(r.body),'sha256'),'hex') or
  p.result_sha256 is distinct from e.payload->'body'->>'source_plan_sha256' or p.id is distinct from '5295245f-b2c1-4f5d-80ad-ca9f821ae3da'::uuid or
  not exists(select 1 from public.analysis_jev_luna_sol_runs where id=r.run_id and plan_id=p.id and status in('completed','needs_review')) then raise exception 'JLS_PRI_SOURCE_CHANGED';end if;
 perform public.jls_delegated_scope_check(p.id,p_verify_cache);
 if jsonb_array_length(r.body->'luna_decisions') is distinct from 25 or
  (select count(distinct d->>'evidence_id') from jsonb_array_elements(r.body->'luna_decisions')d)<>25 or
  (select count(*) from public.analysis_jev_luna_sol_tasks where run_id=r.run_id and phase='luna' and status='completed' and request_count=1)<>24 then raise exception 'JLS_PRI_LUNA_HISTORY_INCOMPATIBLE';end if;
 for t in select * from public.analysis_jev_luna_sol_tasks where run_id=r.run_id and phase='luna' loop
  if t.served_model is distinct from 'gpt-6-luna' or t.response_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(t.response),'sha256'),'hex') or
   t.request_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(t.request),'sha256'),'hex') or
   not exists(select 1 from jsonb_array_elements(p.body->'luna_groups')g where g->>'review_id'=t.review_id::text and g->>'request_sha256'=t.request_sha256 and g->'payload'=t.request) or
   exists(select 1 from jsonb_array_elements(t.parsed->'decisions')d where not exists(select 1 from jsonb_array_elements(r.body->'luna_decisions')h where h=d)) then raise exception 'JLS_PRI_LUNA_HISTORY_INCOMPATIBLE';end if;
 end loop;
 return e.payload;
end $$;
create function public.save_jls_pri_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare e jsonb;d jsonb;p public.analysis_jev_luna_sol_plans;pid uuid;manifest jsonb;begin
 e=public.jls_pri_source_check((p_body->>'preparation_event_id')::bigint,true);d=e->'body'->'draft';
 select * into p from public.analysis_jev_luna_sol_plans where id=(e->'body'->>'source_plan_id')::uuid;
 select jsonb_agg(jsonb_build_object('task_id',id::text,'review_id',review_id::text,'request_sha256',request_sha256,'response_sha256',response_sha256,'served_model',served_model,'request_count',request_count) order by review_id::text) into manifest
  from public.analysis_jev_luna_sol_tasks where run_id=(e->'body'->>'source_run_id')::uuid and phase='luna';
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or
  p_body->>'version' is distinct from 'jls-prioritized-vi-delegated-execution-v1' or p_body->>'format_version' is distinct from 'jls-prioritized-recommendations-v1' or
  p_body->>'organization_id' is distinct from p.organization_id::text or p_body->>'establishment_id' is distinct from p.establishment_id::text or
  p_body->>'source_plan_id' is distinct from p.id::text or p_body->>'source_plan_sha256' is distinct from p.result_sha256 or
  p_body->>'source_run_id' is distinct from e->'body'->>'source_run_id' or p_body->>'source_result_sha256' is distinct from e->'body'->>'source_result_sha256' or
  p_body->>'source_snapshot_id' is distinct from p.source_snapshot_id::text or p_body->>'source_sha256' is distinct from p.body->>'source_sha256' or
  p_body->>'cache_fingerprints_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p.body->'cache_fingerprints'),'sha256'),'hex') or
  p_body->>'preparation_sha256' is distinct from e->>'sha256' or p_body->>'decisions_sha256' is distinct from d->>'decisions_sha256' or
  p_body->>'reused_luna_manifest_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(manifest),'sha256'),'hex') or
  p_body->>'dossier_sha256' is distinct from d->>'dossier_sha256' or p_body->>'prompt_sha256' is distinct from d->>'prompt_sha256' or
  p_body->>'schema_sha256' is distinct from d->>'schema_sha256' or p_body->>'request_sha256' is distinct from d->>'request_sha256' or
  p_body->>'configuration_sha256' is distinct from d->>'config_sha256' or p_body->>'statistics_sha256' is distinct from p.statistics_sha256 or
  p_body->>'language' is distinct from 'vi' or p_body->>'requested_model' is distinct from 'gpt-6.1-sol' or p_body->>'endpoint' is distinct from '/v1/responses' or p_body->>'reasoning' is distinct from 'low' or
  p_body->>'max_sol_calls' is distinct from '1' or p_body->>'jev_new_calls' is distinct from '0' or p_body->>'luna_new_calls' is distinct from '0' or p_body->>'apify_new_calls' is distinct from '0' or
  p_body->>'automatic_retry' is distinct from 'false' or p_body->>'provider_client_retries' is distinct from '0' or
  p_body->>'authorization_ttl_hours' is distinct from '24' or p_body->>'reservation_lease_seconds' is distinct from '300' or p_body->>'provider_timeout_ms' is distinct from '110000' or
  p_body->>'future_explicit_execution_consent_required' is distinct from 'true' or p_body->>'preparation_is_not_spending_authorization' is distinct from 'true' or
  p_body->>'production_enabled' is distinct from 'false' or p_body->>'human_validated' is distinct from 'false' or p_body->'estimates' is distinct from d->'estimates' or
  p_body->>'consent_source' is distinct from 'user_directive_codex_delegation' or p_body->'operator_identity' is distinct from '{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb or p_body->'gate'->>'passed' is distinct from 'true' then raise exception 'JLS_PRI_PROTOCOL_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':prioritized-protocol',0));
 select id into pid from public.analysis_jls_prioritized_protocols where source_plan_id=p.id;
 if found then if not exists(select 1 from public.analysis_jls_prioritized_protocols where id=pid and sha256=p_sha) then raise exception 'JLS_PRI_PROTOCOL_IMMUTABLE';end if;return pid;end if;
 insert into public.analysis_jls_prioritized_protocols(organization_id,source_plan_id,preparation_event_id,version,language,body,sha256)
 values(p.organization_id,p.id,(p_body->>'preparation_event_id')::bigint,p_body->>'version','vi',p_body,p_sha)returning id into pid;return pid;
end $$;
create function public.jls_pri_consent_valid(p_run uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jls_prioritized_runs;p public.analysis_jls_prioritized_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_prioritized_runs where id=p_run;
 select * into p from public.analysis_jls_prioritized_protocols where id=r.protocol_id and organization_id=r.organization_id;
 return coalesce(r.id is not null and p.id is not null and r.protocol_sha256=p.sha256 and p.sha256=encode(extensions.digest(public.jev_economy_canonical(p.body),'sha256'),'hex') and
 r.consent_source='user_directive_codex_delegation' and r.operator_identity=p.body->'operator_identity' and r.authorization_recorded_by_role='service_role' and
 r.consent_record->>'version'=p.version and r.consent_record->>'action'='execute_prioritized_vi_sol_once' and r.consent_record->>'execution_authorized'='true' and
 r.consent_record->>'protocol_sha256'=p.sha256 and r.consent_sha256=encode(extensions.digest(public.jev_economy_canonical(r.consent_record),'sha256'),'hex') and
 r.consent_signature=encode(extensions.hmac(public.jev_economy_canonical(r.consent_record),(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token'),'sha256'),'hex') and
 r.expires_at>now() and exists(select 1 from public.organization_members m where m.organization_id=r.organization_id and m.user_id=r.organization_authority_user_id and m.role in('owner','admin','manager')),false);
end $$;
create function public.jls_pri_state_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jls_prioritized_protocols;r public.analysis_jls_prioritized_runs;draft jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if tg_op='DELETE' then raise exception 'JLS_PRI_HISTORY_IMMUTABLE';end if;
 if tg_table_name='analysis_jls_prioritized_runs' then
  if tg_op='UPDATE' then
   if old.status not in('queued','running') or row(new.protocol_id,new.organization_id,new.protocol_sha256,new.consent_source,new.consent_record,new.consent_sha256,new.consent_signature,new.operator_identity,new.organization_authority_user_id,new.authorization_recorded_by_role,new.expires_at)
    is distinct from row(old.protocol_id,old.organization_id,old.protocol_sha256,old.consent_source,old.consent_record,old.consent_sha256,old.consent_signature,old.operator_identity,old.organization_authority_user_id,old.authorization_recorded_by_role,old.expires_at) then raise exception 'JLS_PRI_AUTHORIZATION_IMMUTABLE';end if;
  else
   select * into p from public.analysis_jls_prioritized_protocols where id=new.protocol_id and organization_id=new.organization_id;
   if p.id is null or new.status<>'queued' or new.protocol_sha256<>p.sha256 or new.operator_identity is distinct from p.body->'operator_identity' or new.authorization_recorded_by_role<>'service_role' or
    new.consent_record->>'action' is distinct from 'execute_prioritized_vi_sol_once' or new.consent_record->>'execution_authorized' is distinct from 'true' or
    new.consent_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(new.consent_record),'sha256'),'hex') or
    new.consent_signature is distinct from encode(extensions.hmac(public.jev_economy_canonical(new.consent_record),(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token'),'sha256'),'hex') then raise exception 'JLS_PRI_NEW_EXECUTION_GO_REQUIRED';end if;
  end if;
 else
  select * into r from public.analysis_jls_prioritized_runs where id=new.run_id and organization_id=new.organization_id;
  select * into p from public.analysis_jls_prioritized_protocols where id=r.protocol_id;
  select payload->'body'->'draft' into draft from public.analysis_jev_luna_sol_events where id=p.preparation_event_id;
  if r.id is null or p.id is null or new.request is distinct from draft->'request' or new.request_sha256 is distinct from p.body->>'request_sha256' or new.requested_model<>'gpt-6.1-sol' then raise exception 'JLS_PRI_REQUEST_CHANGED';end if;
  if tg_op='INSERT' then
   if new.status<>'queued' or new.request_count<>0 or not public.jls_pri_consent_valid(r.id) then raise exception 'JLS_PRI_NEW_EXECUTION_GO_REQUIRED';end if;
  elsif old.status not in('queued','running') or new.request_count<old.request_count or old.request_count=1 and new.status='queued' or
   row(new.run_id,new.organization_id,new.request,new.request_sha256,new.requested_model) is distinct from row(old.run_id,old.organization_id,old.request,old.request_sha256,old.requested_model) or
   old.request_count=1 and row(new.lease_owner,new.lease_until,new.dispatched_at) is distinct from row(old.lease_owner,old.lease_until,old.dispatched_at) then raise exception 'JLS_PRI_NO_PAID_RETRY';end if;
 end if;return new;
end $$;
create trigger jls_pri_state before insert or update or delete on public.analysis_jls_prioritized_runs for each row execute function public.jls_pri_state_guard();
create trigger jls_pri_state before insert or update or delete on public.analysis_jls_prioritized_tasks for each row execute function public.jls_pri_state_guard();
create function public.jls_pri_authorize(p_protocol uuid,p_protocol_sha text,p_authorization jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jls_prioritized_protocols;e jsonb;authority uuid;rid uuid;expected_scope jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_prioritized_protocols where id=p_protocol;
 if p.id is null or p_protocol_sha<>p.sha256 then raise exception 'JLS_PRI_PROTOCOL_CHANGED';end if;
 e=public.jls_pri_source_check(p.preparation_event_id,true);
 select created_by into authority from public.analysis_jev_pilot_snapshots where id=(p.body->>'source_snapshot_id')::uuid;
 if not exists(select 1 from public.organization_members where organization_id=p.organization_id and user_id=authority and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 expected_scope=jsonb_build_object('format_version',p.body->>'format_version','language','vi','requested_model','gpt-6.1-sol','endpoint','/v1/responses',
  'source_plan_id',p.body->>'source_plan_id','source_run_id',p.body->>'source_run_id','organization_id',p.organization_id::text,
  'request_sha256',p.body->>'request_sha256','preparation_sha256',p.body->>'preparation_sha256','decisions_sha256',p.body->>'decisions_sha256',
  'configuration_sha256',p.body->>'configuration_sha256','max_sol_calls',1,'jev_new_calls',0,'luna_new_calls',0,'apify_new_calls',0,'automatic_retry',false);
 if p_authorization->>'version' is distinct from p.version or p_authorization->>'protocol_sha256' is distinct from p.sha256 or
  p_authorization->>'action' is distinct from 'execute_prioritized_vi_sol_once' or p_authorization->>'execution_authorized' is distinct from 'true' or
  p_authorization->>'consent_source' is distinct from 'user_directive_codex_delegation' or p_authorization->'operator_identity' is distinct from p.body->'operator_identity' or
  length(coalesce(p_authorization->>'user_directive',''))<20 or p_authorization->>'directive_sha256' is distinct from encode(extensions.digest(p_authorization->>'user_directive','sha256'),'hex') or
  p_authorization->'scope' is distinct from expected_scope or p_authorization->'approved_estimates' is distinct from p.body->'estimates' then raise exception 'JLS_PRI_NEW_EXECUTION_GO_REQUIRED';end if;
 if p_authorization->>'requested_at' is null or p_authorization->>'expires_at' is null or (p_authorization->>'requested_at')::timestamptz>now() or
  (p_authorization->>'requested_at')::timestamptz<now()-interval '24 hours' or (p_authorization->>'expires_at')::timestamptz<>(p_authorization->>'requested_at')::timestamptz+interval '24 hours' or
  (p_authorization->>'expires_at')::timestamptz<=now() then raise exception 'JLS_PRI_CONSENT_EXPIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':one-execution',0));
 select id into rid from public.analysis_jls_prioritized_runs where protocol_id=p.id;if found then return rid;end if;
 insert into public.analysis_jls_prioritized_runs(organization_id,protocol_id,protocol_sha256,status,consent_source,consent_record,consent_sha256,consent_signature,operator_identity,organization_authority_user_id,authorization_recorded_by_role,expires_at)
 values(p.organization_id,p.id,p.sha256,'queued','user_directive_codex_delegation',p_authorization,encode(extensions.digest(public.jev_economy_canonical(p_authorization),'sha256'),'hex'),
  encode(extensions.hmac(public.jev_economy_canonical(p_authorization),(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token'),'sha256'),'hex'),p.body->'operator_identity',authority,current_user,(p_authorization->>'expires_at')::timestamptz)returning id into rid;
 insert into public.analysis_jls_prioritized_tasks(organization_id,run_id,request,request_sha256,requested_model,status)
 values(p.organization_id,rid,e->'body'->'draft'->'request',p.body->>'request_sha256','gpt-6.1-sol','queued');
 insert into public.analysis_jls_prioritized_events(organization_id,protocol_id,run_id,action,payload)values(p.organization_id,p.id,rid,'user_directive_codex_delegation',jsonb_build_object('consent_sha256',encode(extensions.digest(public.jev_economy_canonical(p_authorization),'sha256'),'hex'),'directive_sha256',p_authorization->>'directive_sha256','recorded_by_role',current_user));
 return rid;
end $$;
create function public.jls_pri_abort(p_run uuid,p_error text) returns void language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jls_prioritized_runs;t public.analysis_jls_prioritized_tasks;s text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_prioritized_runs where id=p_run for update;if r.id is null or r.status not in('queued','running') then return;end if;
 select * into t from public.analysis_jls_prioritized_tasks where run_id=r.id for update;
 if t.status='running' and t.lease_until>now() then return;end if;
 s=case when t.request_count=1 then 'billing_uncertain' when p_error like '%AUTHORIZATION%' or p_error like '%EXPIRED%' then 'authorization_expired' else 'blocked_incompatible' end;
 update public.analysis_jls_prioritized_tasks set status=s,error_code=p_error,completed_at=now() where id=t.id;
 update public.analysis_jls_prioritized_runs set status=s,error_code=p_error,completed_at=now() where id=r.id;
 insert into public.analysis_jls_prioritized_events(organization_id,protocol_id,run_id,action,payload)values(r.organization_id,r.protocol_id,r.id,'stopped_no_retry',jsonb_build_object('error_code',p_error,'status',s));
end $$;
create function public.claim_jls_pri_task(p_run uuid,p_worker text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jls_prioritized_runs;t public.analysis_jls_prioritized_tasks;p public.analysis_jls_prioritized_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_prioritized_runs where id=p_run and status in('queued','running') for update;if r.id is null then return null;end if;
 select * into t from public.analysis_jls_prioritized_tasks where run_id=r.id for update;
 if t.request_count=1 then
  if t.status='running' and t.lease_until<now() then perform public.jls_pri_abort(r.id,'JLS_PRI_RESPONSE_LOST_NO_RETRY');end if;
  return null;
 end if;
 if not public.jls_pri_consent_valid(r.id) then perform public.jls_pri_abort(r.id,'JLS_PRI_AUTHORIZATION_EXPIRED');return null;end if;
 select * into p from public.analysis_jls_prioritized_protocols where id=r.protocol_id;
 perform public.jls_pri_source_check(p.preparation_event_id,true);
 if t.status<>'queued' or nullif(p_worker,'') is null then return null;end if;
 update public.analysis_jls_prioritized_tasks set status='running',request_count=1,lease_owner=p_worker,lease_until=now()+interval '5 minutes',dispatched_at=now() where id=t.id returning * into t;
 update public.analysis_jls_prioritized_runs set status='running' where id=r.id;
 insert into public.analysis_jls_prioritized_events(organization_id,protocol_id,run_id,action,payload)values(r.organization_id,r.protocol_id,r.id,'sol_attempt_reserved',jsonb_build_object('task_id',t.id,'request_sha256',t.request_sha256));
 return to_jsonb(t)||jsonb_build_object('protocol_id',p.id,'protocol_sha256',p.sha256,'authorization_expires_at',r.expires_at);
end $$;
create function public.finish_jls_pri_task(p_task uuid,p_worker text,p_status text,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.analysis_jls_prioritized_tasks;r public.analysis_jls_prioritized_runs;p public.analysis_jls_prioritized_protocols;expected_cost numeric;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jls_prioritized_tasks where id=p_task;
 select * into r from public.analysis_jls_prioritized_runs where id=t.run_id and organization_id=t.organization_id for update;
 select * into t from public.analysis_jls_prioritized_tasks where id=p_task and status='running' and lease_owner=p_worker for update;if t.id is null then return false;end if;
 select * into p from public.analysis_jls_prioritized_protocols where id=r.protocol_id;
 if p_status not in('completed','needs_review','invalid_output','billing_uncertain','blocked_incompatible','failed') or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or
  p_body->>'version' is distinct from 'jls-prioritized-vi-execution-result-v1' or p_body->>'protocol_sha256' is distinct from p.sha256 or
  p_body->>'request_sha256' is distinct from t.request_sha256 or p_body->>'source_plan_sha256' is distinct from p.body->>'source_plan_sha256' or
  p_body->>'decisions_sha256' is distinct from p.body->>'decisions_sha256' or p_body->>'human_validated' is distinct from 'false' or p_body->>'production_enabled' is distinct from 'false' then raise exception 'JLS_PRI_RESULT_CHANGED';end if;
 if p_body->>'raw_response_text' is not null and p_body->>'raw_response_sha256' is distinct from encode(extensions.digest(p_body->>'raw_response_text','sha256'),'hex') or
  p_body->>'response_sha256' is not null and p_body->>'response_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'response'),'sha256'),'hex') then raise exception 'JLS_PRI_RESPONSE_CHANGED';end if;
 if p_status in('completed','needs_review') and (p_body->>'served_model' is distinct from 'gpt-6.1-sol' or p_body->'controls'->>'usage_complete' is distinct from 'true' or
  p_body->'validated_report'->>'format_version' is distinct from 'jls-prioritized-recommendations-v1' or p_body->'validated_report'->>'language' is distinct from 'vi' or
  p_body->'validated_report'->>'statistics_sha256' is distinct from p.body->>'statistics_sha256' or p_body->'validated_report'->>'human_validated' is distinct from 'false' or
  p_body->'validated_report'->>'accepted_dossier_sha256' is distinct from p.body->>'dossier_sha256' or p_body->'validated_report'->>'prompt_sha256' is distinct from p.body->>'prompt_sha256' or
  p_body->'validated_report'->>'schema_sha256' is distinct from p.body->>'schema_sha256' or
  p_body->'validated_report'->'statistics' is distinct from (select body->'statistics' from public.analysis_jev_luna_sol_plans where id=p.source_plan_id)) then raise exception 'JLS_PRI_VALIDATION_MISSING';end if;
 if p_status='completed' and p_body->'controls'->>'report_validation_passed' is distinct from 'true' then raise exception 'JLS_PRI_VALIDATION_MISSING';end if;
 if p_body->'controls'->>'usage_complete'='true' then
  if (p_body->>'input_tokens')::bigint<=0 or (p_body->>'output_tokens')::bigint<0 or p_body->'usage_details'->>'input_tokens' is distinct from p_body->>'input_tokens' or
   p_body->'usage_details'->>'output_tokens' is distinct from p_body->>'output_tokens' or (p_body->'usage_details'->>'total_tokens')::bigint<>(p_body->>'input_tokens')::bigint+(p_body->>'output_tokens')::bigint then raise exception 'JLS_PRI_USAGE_CHANGED';end if;
  if p_body->>'served_model'='gpt-6.1-sol' then expected_cost=((p_body->>'input_tokens')::numeric*(p.body->'estimates'->'rates'->>'sol_input')::numeric+(p_body->>'output_tokens')::numeric*(p.body->'estimates'->'rates'->>'sol_output')::numeric)/1000000;end if;
 end if;
 if (p_body->>'cost_usd')::numeric is distinct from expected_cost then raise exception 'JLS_PRI_COST_CHANGED';end if;
 insert into public.analysis_jls_prioritized_results(organization_id,run_id,body,sha256)values(r.organization_id,r.id,p_body,p_sha);
 update public.analysis_jls_prioritized_tasks set status=p_status,error_code=p_body->'controls'->>'error_code',completed_at=now() where id=t.id;
 update public.analysis_jls_prioritized_runs set status=p_status,error_code=p_body->'controls'->>'error_code',completed_at=now() where id=r.id;
 insert into public.analysis_jls_prioritized_events(organization_id,protocol_id,run_id,action,payload)values(r.organization_id,r.protocol_id,r.id,'sol_response_recorded_no_retry',jsonb_build_object('status',p_status,'result_sha256',p_sha));
 return true;
end $$;
create function public.jls_pri_wake(p_run uuid) returns bigint language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jls_prioritized_runs;n bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_prioritized_runs where id=p_run and status in('queued','running');if r.id is null then return null;end if;
 if not public.jls_pri_consent_valid(r.id) then perform public.jls_pri_abort(r.id,'JLS_PRI_AUTHORIZATION_EXPIRED');return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-prioritized',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:=jsonb_build_object('run_id',r.id),timeout_milliseconds:=1000) into n;return n;
end $$;
-- Reuse the existing wake controller. With zero new runs this branch cannot emit HTTP.
create or replace function private.dispatch_jls_delegated() returns void language plpgsql security invoker set search_path='' as $$declare r record;begin
 for r in select id from public.analysis_jev_luna_sol_runs where status in('queued','running') loop perform public.jls_wake_delegated(r.id);end loop;
 for r in select id from public.analysis_jls_prioritized_runs where status in('queued','running') loop perform public.jls_pri_wake(r.id);end loop;
end $$;
do $$ declare fn text;begin foreach fn in array array['jls_pri_source_check(bigint,boolean)','save_jls_pri_protocol(jsonb,text)','jls_pri_consent_valid(uuid)','jls_pri_state_guard()','jls_pri_authorize(uuid,text,jsonb)','jls_pri_abort(uuid,text)','claim_jls_pri_task(uuid,text)','finish_jls_pri_task(uuid,text,text,jsonb,text)','jls_pri_wake(uuid)'] loop
 execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;
revoke all on function private.dispatch_jls_delegated() from public,anon,authenticated;
grant execute on function private.dispatch_jls_delegated() to service_role;
