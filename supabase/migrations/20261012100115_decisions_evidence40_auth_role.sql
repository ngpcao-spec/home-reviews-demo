-- Keep RPCs SECURITY INVOKER and service-only. Active-user checks live in the Auth Admin API.
-- No auth.users read grants, no SECURITY DEFINER and no data/job writes.
create or replace function public.evidence40_save_plan(p_user uuid,p_manifest jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare e public.analysis_decisions_experiments; c public.analysis_decisions_configurations; x jsonb; src jsonb; pid uuid;
begin
 select * into e from public.analysis_decisions_experiments where id='73a7bfe9-c618-4e2f-aa82-3b0fae8eb989';
 if e.id is null or not exists(select 1 from public.organization_members m where m.user_id=p_user and m.organization_id=e.organization_id and m.role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_decisions_configurations where organization_id=e.organization_id and configuration_id='luna-decisions-evidence-choice-v1';
 if e.result_sha256 is distinct from p_manifest->'hashes'->>'preparation' or c.config_sha256 is distinct from p_manifest->'hashes'->>'configuration' or p_manifest->>'experiment_id' is distinct from e.id::text or p_manifest->>'organization_id' is distinct from e.organization_id::text or p_manifest->>'version' is distinct from 'openai-decisions-evidence40-run-v1' or p_manifest->>'control_id' is distinct from '3988aa10-0c5c-4a52-b1ff-1b576b488c52' or p_manifest->>'configuration_id' is distinct from c.configuration_id or p_manifest->>'model' is distinct from 'gpt-6-luna' or p_manifest->>'max_calls' is distinct from '40' or p_manifest->>'repeat_count' is distinct from '1' or p_manifest->>'automatic_retry' is distinct from 'false' or p_manifest->>'production_enabled' is distinct from 'false' or jsonb_array_length(p_manifest->'cases')<>40 or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_manifest),'sha256'),'hex') then raise exception 'EVIDENCE40_PLAN_INVALID';end if;
 if (select count(distinct j.value->>'review_id') from jsonb_array_elements(p_manifest->'cases') j(value))<>40 or (select count(distinct j.value->>'position') from jsonb_array_elements(p_manifest->'cases') j(value))<>40 then raise exception 'EVIDENCE40_COUNT_CHANGED';end if;
 for x in select value from jsonb_array_elements(p_manifest->'cases') loop
  select value into src from jsonb_array_elements(e.body->'evidence_verification'->'items') where value->>'review_id'=x->>'review_id' and value->>'theme_key'=x->>'theme_key';
  if src is null or x->>'position' is distinct from src->>'position' or x->>'polarity' is distinct from src->>'polarity' or x->>'analysis_text_sha256' is distinct from src->>'analysis_text_sha256' or x->>'analysis_text' is distinct from src->>'analysis_text' or x->>'request_sha256' is distinct from src->>'request_sha256' or x->>'request_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(x->'payload'),'sha256'),'hex') or x->'payload'->>'model' is distinct from 'gpt-6-luna' or jsonb_array_length(x->'payload'->'questions')<>1 or not exists(select 1 from public.reviews r where r.id=(x->>'review_id')::uuid and r.organization_id=e.organization_id) then raise exception 'EVIDENCE40_CASE_CHANGED';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':evidence40',0));
 select id into pid from public.analysis_decisions_evidence40_plans where experiment_id=e.id;
 if found then if not exists(select 1 from public.analysis_decisions_evidence40_plans where id=pid and manifest_sha256=p_sha) then raise exception 'EVIDENCE40_PLAN_CHANGED';end if;return pid;end if;
 insert into public.analysis_decisions_evidence40_plans(organization_id,experiment_id,version,manifest,manifest_sha256,created_by) values(e.organization_id,e.id,p_manifest->>'version',p_manifest,p_sha,p_user) returning id into pid;return pid;
end $$;

create or replace function public.evidence40_confirm(p_user uuid,p_plan uuid,p_sha text,p_cost numeric,p_consent text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_decisions_evidence40_plans; rid uuid; x jsonb;
begin
 select * into p from public.analysis_decisions_evidence40_plans where id=p_plan;
 if p.id is null or not exists(select 1 from public.organization_members m where m.user_id=p_user and m.organization_id=p.organization_id and m.role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_consent is distinct from 'evidence40-cost-confirmation-v1' or p_sha is distinct from p.manifest_sha256 or p_cost is distinct from (p.manifest->>'estimated_cost_usd')::numeric then raise exception 'EVIDENCE40_CONFIRMATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':confirm',0));
 select id into rid from public.analysis_decisions_evidence40_runs where plan_id=p.id;if found then return rid;end if;
 insert into public.analysis_decisions_evidence40_runs(plan_id,organization_id,confirmed_by,consent_version,manifest_sha256,estimated_cost_usd) values(p.id,p.organization_id,p_user,p_consent,p_sha,p_cost) returning id into rid;
 for x in select value from jsonb_array_elements(p.manifest->'cases') loop
  insert into public.analysis_decisions_evidence40_tasks(run_id,organization_id,position,review_id,payload,request_sha256,analysis_text_sha256) values(rid,p.organization_id,(x->>'position')::int,(x->>'review_id')::uuid,x->'payload',x->>'request_sha256',x->>'analysis_text_sha256');
 end loop;
 insert into public.analysis_decisions_evidence40_events(run_id,organization_id,event,body) values(rid,p.organization_id,'manual_cost_confirmed',jsonb_build_object('user_id',p_user,'max_calls',40,'estimated_cost_usd',p_cost,'manifest_sha256',p_sha));return rid;
end $$;
create or replace function public.evidence40_claim(p_worker uuid,p_run uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.analysis_decisions_evidence40_tasks; r public.analysis_decisions_evidence40_runs;
begin
 -- A lost response is terminal. Never put it back in the queue.
 update public.analysis_decisions_evidence40_tasks set status='billing_uncertain',completed_at=now(),error_code='WORKER_RESPONSE_LOST' where status='dispatched' and dispatched_at<now()-interval '5 minutes';
 select q.* into t from public.analysis_decisions_evidence40_tasks q join public.analysis_decisions_evidence40_runs j on j.id=q.run_id where q.status='queued' and j.status in('queued','running') and (p_run is null or j.id=p_run) and exists(select 1 from public.organization_members m where m.user_id=j.confirmed_by and m.organization_id=j.organization_id and m.role in('owner','admin','manager')) order by j.confirmed_at,q.position for update of q skip locked limit 1;
 if t.id is null then return null;end if;
 select * into r from public.analysis_decisions_evidence40_runs where id=t.run_id for update;
 if r.status not in('queued','running') or (select coalesce(sum(request_count),0) from public.analysis_decisions_evidence40_tasks where run_id=r.id)>=40 then return null;end if;
 if r.status='queued' then update public.analysis_decisions_evidence40_runs set status='running' where id=r.id;end if;
 update public.analysis_decisions_evidence40_tasks set status='dispatched',request_count=1,worker_id=p_worker,dispatched_at=now() where id=t.id returning * into t;
 insert into public.analysis_decisions_evidence40_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'attempt_reserved',jsonb_build_object('task_id',t.id,'position',t.position));return to_jsonb(t);
end $$;
