-- Authenticated service administration adapter, scoped to one user-delegated V2 execution.
-- No plan, run, task, consent or provider request is created by this migration.
alter table public.analysis_luna_negative_v2_plans alter column created_by drop not null;
alter table public.analysis_luna_negative_v2_plans add column actor_kind text not null default 'user' check(actor_kind in('user','codex_admin'));
alter table public.analysis_luna_negative_v2_plans add column organization_authority_user_id uuid references auth.users(id);
alter table public.analysis_luna_negative_v2_plans add constraint nv2_plan_actor_check check(
 (actor_kind='user' and created_by is not null and organization_authority_user_id is null) or
 (actor_kind='codex_admin' and created_by is null and organization_authority_user_id is not null));
alter table public.analysis_luna_negative_v2_runs alter column confirmed_by drop not null;
alter table public.analysis_luna_negative_v2_runs drop constraint analysis_luna_negative_v2_runs_consent_version_check;
alter table public.analysis_luna_negative_v2_runs add constraint nv2_consent_version_check check(consent_version in('luna-negative-v2-cost-confirmation-v1','luna-negative-v2-codex-delegation-v1'));
alter table public.analysis_luna_negative_v2_runs add column consent_source text not null default 'manual_ui' check(consent_source in('manual_ui','user_directive_codex_delegation'));
alter table public.analysis_luna_negative_v2_runs add column organization_authority_user_id uuid references auth.users(id);
alter table public.analysis_luna_negative_v2_runs add column operator_identity jsonb;
alter table public.analysis_luna_negative_v2_runs add column authorization_record jsonb;
alter table public.analysis_luna_negative_v2_runs add column authorization_sha256 text;
alter table public.analysis_luna_negative_v2_runs add column authorization_recorded_by_role text;
alter table public.analysis_luna_negative_v2_runs add constraint nv2_run_actor_check check(
 (consent_source='manual_ui' and consent_version='luna-negative-v2-cost-confirmation-v1' and confirmed_by is not null and organization_authority_user_id is null and operator_identity is null and authorization_record is null and authorization_sha256 is null and authorization_recorded_by_role is null) or
 (consent_source='user_directive_codex_delegation' and consent_version='luna-negative-v2-codex-delegation-v1' and confirmed_by is null and organization_authority_user_id is not null and operator_identity is not null and operator_identity='{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb and authorization_record is not null and authorization_sha256 is not null and authorization_sha256~'^[a-f0-9]{64}$' and authorization_recorded_by_role is not null and authorization_recorded_by_role='service_role'));
create index luna_nv2_plan_authority on public.analysis_luna_negative_v2_plans(organization_authority_user_id);
create index luna_nv2_run_authority on public.analysis_luna_negative_v2_runs(organization_authority_user_id);
create function public.luna_nv2_save_admin_plan(p_manifest jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p_user uuid;s public.analysis_luna_negative_v2_sets;seal public.analysis_luna_negative_v2_reference_seals;pid uuid;x jsonb;src jsonb;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 perform public.luna_nv2_launch_check((p_manifest->>'set_id')::uuid,(p_manifest->>'seal_id')::uuid);
 select * into s from public.analysis_luna_negative_v2_sets where id=(p_manifest->>'set_id')::uuid;
 select * into seal from public.analysis_luna_negative_v2_reference_seals where id=(p_manifest->>'seal_id')::uuid;
 p_user:=s.created_by;
 if not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_manifest),'sha256'),'hex') or p_manifest->>'version' is distinct from 'luna-negative-v2-manual-run-v1' or p_manifest->>'model' is distinct from 'gpt-6-luna' or p_manifest->>'endpoint' is distinct from '/v1/decisions' or p_manifest->>'configuration_id' is distinct from 'luna-negative-focused-v2-choice-v1' or p_manifest->>'organization_id' is distinct from s.organization_id::text or p_manifest->>'dataset_sha256' is distinct from s.body_sha256 or p_manifest->>'reference_sha256' is distinct from seal.reference_sha256 or p_manifest->>'config_sha256' is distinct from s.config_sha256 or p_manifest->>'max_calls' is distinct from '28' or p_manifest->>'question_count' is distinct from '32' or p_manifest->>'repeat_count' is distinct from '1' or p_manifest->>'automatic_retry' is distinct from 'false' or p_manifest->>'production_enabled' is distinct from 'false' or p_manifest->>'input_rate_per_million' is distinct from '0.1' or (p_manifest->>'estimated_cost_usd')::numeric<>(p_manifest->>'estimated_input_tokens')::numeric*0.1/1000000 then raise exception 'NEGATIVE_V2_PLAN_INVALID';end if;
 if jsonb_array_length(p_manifest->'cases')<>28 or (select count(distinct it->>'review_id') from jsonb_array_elements(p_manifest->'cases') it)<>28 or (select count(distinct it->>'position') from jsonb_array_elements(p_manifest->'cases') it)<>28 or (select sum(jsonb_array_length(it->'associations')) from jsonb_array_elements(p_manifest->'cases') it)<>32 or (select sum((it->>'estimated_input_tokens')::bigint) from jsonb_array_elements(p_manifest->'cases') it)<>(p_manifest->>'estimated_input_tokens')::bigint then raise exception 'NEGATIVE_V2_COUNT_CHANGED';end if;
 for x in select value from jsonb_array_elements(p_manifest->'cases') loop
  select value into src from jsonb_array_elements(s.body->'reviews') where value->>'review_id'=x->>'review_id';
  if src is null or x->>'position' is distinct from src->>'position' or x->'payload' is distinct from src->'payload' or x->>'request_sha256' is distinct from src->>'request_sha256' or x->>'analysis_text_sha256' is distinct from src->>'analysis_text_sha256' or x->>'review_sha256' is distinct from src->>'review_sha256' or x->>'establishment_id' is distinct from src->>'establishment_id' or x->'associations' is distinct from (select jsonb_agg(jsonb_build_object('association_id',q->>'association_id','theme_key',q->>'theme_key','polarity',q->>'polarity')) from jsonb_array_elements(src->'associations')q) then raise exception 'NEGATIVE_V2_CASE_CHANGED';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(s.id::text||':negative-v2-plan',0));
 select id into pid from public.analysis_luna_negative_v2_plans where set_id=s.id and seal_id=seal.id;
 if found then if not exists(select 1 from public.analysis_luna_negative_v2_plans where id=pid and manifest_sha256=p_sha) then raise exception 'NEGATIVE_V2_PLAN_CHANGED';end if;return pid;end if;
 insert into public.analysis_luna_negative_v2_plans(organization_id,set_id,seal_id,version,manifest,manifest_sha256,created_by,actor_kind,organization_authority_user_id)values(s.organization_id,s.id,seal.id,p_manifest->>'version',p_manifest,p_sha,null,'codex_admin',p_user)returning id into pid;return pid;
end $$;
create or replace function public.luna_nv2_claim(p_worker uuid,p_run uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.analysis_luna_negative_v2_tasks; r public.analysis_luna_negative_v2_runs; expired public.analysis_luna_negative_v2_tasks;
begin
 -- A lost response is terminal. Never put it back in the queue.
 select * into r from public.analysis_luna_negative_v2_runs where id=p_run and status in('queued','running') for update;
 if r.id is null then return null;end if;
 for expired in select * from public.analysis_luna_negative_v2_tasks where run_id=r.id and status='dispatched' and dispatched_at<now()-interval '5 minutes' loop perform public.luna_nv2_finish(expired.id,expired.worker_id,'billing_uncertain','{"error_code":"WORKER_RESPONSE_LOST"}'::jsonb);end loop;
 perform public.luna_nv2_launch_check('c8b3eee7-2554-43d9-a16b-5e12413af793','c4031dc6-e0a3-4992-bb35-f790ecccd034');
 if r.consent_source='user_directive_codex_delegation' then
  if r.authorization_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(r.authorization_record),'sha256'),'hex') or r.authorization_record->>'directive_sha256' is distinct from '52e4a73b9aef57569e9db17e8c6bb232cf9a668ce5e428c929f793fbe8bdd1a2' or r.authorization_record->'scope'->>'set_id' is distinct from 'c8b3eee7-2554-43d9-a16b-5e12413af793' or r.authorization_record->'scope'->>'max_calls' is distinct from '28' then raise exception 'NEGATIVE_V2_DELEGATION_CHANGED';end if;
  if now()>(r.authorization_record->>'expires_at')::timestamptz then perform public.luna_nv2_stop_unsent(r.id,'NEGATIVE_V2_DELEGATION_EXPIRED');return null;end if;
 end if;
 if not exists(select 1 from public.organization_members m where m.user_id=coalesce(r.confirmed_by,r.organization_authority_user_id) and m.organization_id=r.organization_id and m.role in('owner','admin','manager')) then perform public.luna_nv2_stop_unsent(r.id,'NEGATIVE_V2_AUTHORIZATION_UNAVAILABLE');return null;end if;
 select q.* into t from public.analysis_luna_negative_v2_tasks q where q.run_id=r.id and q.status='queued' order by q.position for update skip locked limit 1;
 if t.id is null then return null;end if;
 if r.status not in('queued','running') or (select coalesce(sum(request_count),0) from public.analysis_luna_negative_v2_tasks where run_id=r.id)>=28 then return null;end if;
 if r.status='queued' then update public.analysis_luna_negative_v2_runs set status='running' where id=r.id;end if;
 update public.analysis_luna_negative_v2_tasks set status='dispatched',request_count=1,worker_id=p_worker,dispatched_at=now() where id=t.id returning * into t;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'attempt_reserved',jsonb_build_object('task_id',t.id,'position',t.position));return to_jsonb(t);
end $$;

create function public.luna_nv2_authorize_delegated(p_plan uuid,p_sha text,p_cost numeric,p_authorization jsonb) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_luna_negative_v2_plans;s public.analysis_luna_negative_v2_sets;rid uuid;it jsonb;scope jsonb;authority uuid;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_luna_negative_v2_plans where id=p_plan;
 if p.id is null then raise exception 'NEGATIVE_V2_PLAN_REQUIRED';end if;
 perform public.luna_nv2_launch_check(p.set_id,p.seal_id);
 select * into s from public.analysis_luna_negative_v2_sets where id=p.set_id;authority:=s.created_by;
 if not exists(select 1 from public.organization_members m where m.user_id=authority and m.organization_id=p.organization_id and m.role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 scope:=p_authorization->'scope';
 if p_sha is distinct from p.manifest_sha256 or p_cost is distinct from (p.manifest->>'estimated_cost_usd')::numeric or p_authorization->>'consent_source' is distinct from 'user_directive_codex_delegation' or p_authorization->>'directive_sha256' is distinct from '52e4a73b9aef57569e9db17e8c6bb232cf9a668ce5e428c929f793fbe8bdd1a2' or p_authorization->>'directive_sha256' is distinct from encode(extensions.digest(p_authorization->>'user_directive','sha256'),'hex') or p_authorization->'operator_identity' is distinct from '{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb or scope is distinct from jsonb_build_object('set_id',p.set_id,'seal_id',p.seal_id,'protocol_version','luna-negative-v2-manual-run-v1','configuration_id','luna-negative-focused-v2-choice-v1','model','gpt-6-luna','endpoint','/v1/decisions','max_calls',28,'question_count',32,'attempts_per_review',1,'automatic_retry',false) then raise exception 'NEGATIVE_V2_DELEGATION_CHANGED';end if;
 if p_authorization->>'requested_at' is null or p_authorization->>'expires_at' is null or (p_authorization->>'requested_at')::timestamptz>now() or (p_authorization->>'requested_at')::timestamptz<now()-interval '24 hours' or (p_authorization->>'expires_at')::timestamptz<>((p_authorization->>'requested_at')::timestamptz+interval '24 hours') or (p_authorization->>'expires_at')::timestamptz<=now() then raise exception 'NEGATIVE_V2_DELEGATION_EXPIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':confirm',0));
 select id into rid from public.analysis_luna_negative_v2_runs where plan_id=p.id;if found then return rid;end if;
 insert into public.analysis_luna_negative_v2_runs(plan_id,organization_id,confirmed_by,consent_version,manifest_sha256,estimated_cost_usd,consent_source,organization_authority_user_id,operator_identity,authorization_record,authorization_sha256,authorization_recorded_by_role)
 values(p.id,p.organization_id,null,'luna-negative-v2-codex-delegation-v1',p_sha,p_cost,'user_directive_codex_delegation',authority,p_authorization->'operator_identity',p_authorization,encode(extensions.digest(public.jev_economy_canonical(p_authorization),'sha256'),'hex'),current_user)returning id into rid;
 for it in select value from jsonb_array_elements(p.manifest->'cases')loop
  insert into public.analysis_luna_negative_v2_tasks(run_id,organization_id,position,review_id,payload,request_sha256,analysis_text_sha256)values(rid,p.organization_id,(it->>'position')::int,(it->>'review_id')::uuid,it->'payload',it->>'request_sha256',it->>'analysis_text_sha256');
 end loop;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body)values(rid,p.organization_id,'user_directive_codex_delegation',jsonb_build_object('operator_identity',p_authorization->'operator_identity','scope',scope,'directive_sha256',p_authorization->>'directive_sha256','authorization_sha256',encode(extensions.digest(public.jev_economy_canonical(p_authorization),'sha256'),'hex'),'recorded_by_role',current_user,'estimated_cost_usd',p_cost));
 return rid;
end $fn$;
create function public.luna_nv2_wake_delegated(p_run uuid) returns bigint language plpgsql security invoker set search_path='' as $fn$
declare r public.analysis_luna_negative_v2_runs;request bigint;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_luna_negative_v2_runs where id=p_run and status in('queued','running');if r.id is null then return null;end if;
 if r.consent_source<>'user_directive_codex_delegation' or r.authorization_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(r.authorization_record),'sha256'),'hex') then raise exception 'NEGATIVE_V2_DELEGATION_REQUIRED';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-luna-negative-v2',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000) into request;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body)values(r.id,r.organization_id,'authorized_delegated_worker_wake',jsonb_build_object('database_role',current_user,'request_id',request));
 return request;
end $fn$;
revoke all on function public.luna_nv2_save_admin_plan(jsonb,text),public.luna_nv2_authorize_delegated(uuid,text,numeric,jsonb),public.luna_nv2_wake_delegated(uuid) from public,anon,authenticated;
grant execute on function public.luna_nv2_save_admin_plan(jsonb,text),public.luna_nv2_authorize_delegated(uuid,text,numeric,jsonb),public.luna_nv2_wake_delegated(uuid) to service_role;
