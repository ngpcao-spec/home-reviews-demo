-- Manual-only sealed multirest launch; migration creates no plans, runs, tasks or spending consent.
create table public.analysis_luna_multirest_plans(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),set_id uuid not null,seal_id uuid not null,
 version text not null check(version='luna-multirest-manual-run-v1'),manifest jsonb not null,manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(set_id,organization_id) references public.analysis_luna_multirest_sets(id,organization_id),foreign key(seal_id,set_id,organization_id) references public.analysis_luna_multirest_reference_seals(id,set_id,organization_id),unique(set_id,seal_id),unique(id,organization_id)
);
create table public.analysis_luna_multirest_runs (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null unique, organization_id uuid not null references public.organizations(id),
 status text not null default 'queued' check(status in('queued','running','completed','failed','billing_uncertain')),
 confirmed_by uuid not null references auth.users(id), confirmed_at timestamptz not null default now(), consent_version text not null check(consent_version='luna-multirest-cost-confirmation-v1'),
 manifest_sha256 text not null, estimated_cost_usd numeric not null check(estimated_cost_usd>=0), max_calls int not null default 39 check(max_calls=39),
 automatic_retry boolean not null default false check(not automatic_retry), result jsonb, result_sha256 text, completed_at timestamptz,
 foreign key(plan_id,organization_id) references public.analysis_luna_multirest_plans(id,organization_id),unique(id,organization_id)
);
create table public.analysis_luna_multirest_tasks (
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,position int not null check(position between 1 and 40 and position<>32), review_id uuid not null references public.reviews(id),
 payload jsonb not null,request_sha256 text not null,analysis_text_sha256 text not null,
 status text not null default 'queued' check(status in('queued','dispatched','completed','failed','billing_uncertain','cancelled')), request_count int not null default 0 check(request_count in(0,1)),
 worker_id uuid,dispatched_at timestamptz,completed_at timestamptz,response jsonb,response_sha256 text,parsed jsonb,served_model text,answer_type text,response_id text,provider_request_id text,
 input_tokens bigint check(input_tokens>=0),output_tokens bigint check(output_tokens>=0),usage_details jsonb,cost_usd numeric check(cost_usd>=0),duration_ms bigint check(duration_ms>=0),error_code text,
 foreign key(run_id,organization_id) references public.analysis_luna_multirest_runs(id,organization_id),unique(run_id,position),unique(run_id,review_id),
 check((status in('queued','cancelled') and request_count=0 and worker_id is null) or (status not in('queued','cancelled') and request_count=1 and worker_id is not null))
);
create table public.analysis_luna_multirest_events (
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,event text not null,body jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(run_id,organization_id) references public.analysis_luna_multirest_runs(id,organization_id)
);
do $$declare t text;begin foreach t in array array['analysis_luna_multirest_plans','analysis_luna_multirest_runs','analysis_luna_multirest_tasks','analysis_luna_multirest_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy luna_multi_org_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
 execute format('create index %I on public.%I(organization_id)',t||'_org',t);
end loop;end $$;
create index luna_multi_task_queue on public.analysis_luna_multirest_tasks(status,dispatched_at);
create index luna_multi_task_review on public.analysis_luna_multirest_tasks(review_id);
create index luna_multi_plan_actor on public.analysis_luna_multirest_plans(created_by);
create index luna_multi_plan_seal on public.analysis_luna_multirest_plans(seal_id,set_id,organization_id);
create index luna_multi_run_actor on public.analysis_luna_multirest_runs(confirmed_by);
create index luna_multi_event_run on public.analysis_luna_multirest_events(run_id);
create trigger luna_multi_plan_immutable before update or delete on public.analysis_luna_multirest_plans for each row execute function public.pilot_evidence_immutable();
create trigger luna_multi_event_immutable before update or delete on public.analysis_luna_multirest_events for each row execute function public.pilot_evidence_immutable();
create function public.luna_multi_state_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'MULTIREST_IMMUTABLE';end if;
 if tg_table_name='analysis_luna_multirest_runs' then
  if old.status in('completed','failed','billing_uncertain') or (to_jsonb(new)-array['status','result','result_sha256','completed_at']) is distinct from (to_jsonb(old)-array['status','result','result_sha256','completed_at']) or not (old.status='queued' and new.status in('running','failed') or old.status='running' and new.status in('running','completed','failed','billing_uncertain')) then raise exception 'MULTIREST_RUN_TRANSITION';end if;
 else
  if (to_jsonb(new)-array['status','request_count','worker_id','dispatched_at','completed_at','response','response_sha256','parsed','served_model','answer_type','response_id','provider_request_id','input_tokens','output_tokens','usage_details','cost_usd','duration_ms','error_code']) is distinct from (to_jsonb(old)-array['status','request_count','worker_id','dispatched_at','completed_at','response','response_sha256','parsed','served_model','answer_type','response_id','provider_request_id','input_tokens','output_tokens','usage_details','cost_usd','duration_ms','error_code']) or not (old.status='queued' and new.status='dispatched' and old.request_count=0 and new.request_count=1 or old.status='queued' and new.status='cancelled' and new.request_count=0 or old.status='dispatched' and new.status in('completed','failed','billing_uncertain') and new.request_count=1 and new.worker_id=old.worker_id and new.dispatched_at=old.dispatched_at) then raise exception 'MULTIREST_NO_RETRY_OR_MUTATION';end if;
 end if;return new;
end $$;
create trigger luna_multi_run_state before update or delete on public.analysis_luna_multirest_runs for each row execute function public.luna_multi_state_guard();
create trigger luna_multi_task_state before update or delete on public.analysis_luna_multirest_tasks for each row execute function public.luna_multi_state_guard();
create function public.luna_multi_task_insert_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare x jsonb;
begin
 select value into x from public.analysis_luna_multirest_runs r join public.analysis_luna_multirest_plans p on p.id=r.plan_id cross join lateral jsonb_array_elements(p.manifest->'cases') where r.id=new.run_id and r.organization_id=new.organization_id and r.status='queued' and value->>'position'=new.position::text;
 if x is null or new.status<>'queued' or new.request_count<>0 or x->>'review_id' is distinct from new.review_id::text or x->'payload' is distinct from new.payload or x->>'request_sha256' is distinct from new.request_sha256 or x->>'analysis_text_sha256' is distinct from new.analysis_text_sha256 or not exists(select 1 from public.reviews where id=new.review_id and organization_id=new.organization_id) then raise exception 'MULTIREST_TASK_OUT_OF_SCOPE';end if;return new;
end $$;
create trigger luna_multi_task_insert before insert on public.analysis_luna_multirest_tasks for each row execute function public.luna_multi_task_insert_guard();

create function public.luna_multi_launch_check(p_set uuid,p_seal uuid) returns void language plpgsql security invoker set search_path='' as $$
declare s public.analysis_luna_multirest_sets;r public.analysis_luna_multirest_reference_seals;x jsonb;origin jsonb;begin
 select * into s from public.analysis_luna_multirest_sets where id=p_set;
 select * into r from public.analysis_luna_multirest_reference_seals where id=p_seal and set_id=p_set;
 if s.id is null or r.id is null or s.id<>'929bef2d-e841-43e0-a055-3d924d5f88b2' or r.id<>'44f489ae-6f7f-4e9d-8c2f-ae6cfc955d7a' or s.organization_id<>'93228bbb-6397-41e3-b8be-21ee7060eda7' or r.organization_id<>s.organization_id then raise exception 'MULTIREST_LAUNCH_SCOPE_CHANGED';end if;
 if s.body_sha256<>encode(extensions.digest(public.jev_economy_canonical(s.body),'sha256'),'hex') or r.reference_sha256<>encode(extensions.digest(public.jev_economy_canonical(r.body),'sha256'),'hex') or r.dataset_sha256<>s.body_sha256 or r.body->>'dataset_sha256'<>s.body_sha256 or s.config_sha256<>encode(extensions.digest(public.jev_economy_canonical(s.body->'config'),'sha256'),'hex') or s.cases_sha256<>encode(extensions.digest(public.jev_economy_canonical(s.body->'cases'),'sha256'),'hex') then raise exception 'MULTIREST_LAUNCH_HASH_CHANGED';end if;
 if not exists(select 1 from public.analysis_jev_hybrid_controls c where c.id=s.source_control_id and c.organization_id=s.organization_id and c.result_sha256=s.body->>'source_sha256' and c.result_sha256=encode(extensions.digest(public.jev_economy_canonical(c.body),'sha256'),'hex')) or jsonb_array_length(s.body->'cases')<>40 or jsonb_array_length(r.body->'items')<>40 or (select count(*) from public.analysis_luna_multirest_cases where set_id=s.id)<>40 or (select count(*) from public.analysis_luna_multirest_references where set_id=s.id and seal_id=r.id)<>40 then raise exception 'MULTIREST_SOURCE_CHANGED';end if;
 if (select count(*) from jsonb_array_elements(s.body->'cases') c where c->>'evaluation_eligible'='true')<>39 or not exists(select 1 from jsonb_array_elements(s.body->'cases') c where c->>'position'='32' and c->>'evaluation_eligible'='false' and jsonb_array_length(c->'translation_flags')>0) then raise exception 'MULTIREST_ELIGIBLE_COUNT_CHANGED';end if;
 for x in select value from jsonb_array_elements(s.body->'cases') loop
  select value into origin from public.analysis_jev_hybrid_controls c cross join lateral jsonb_array_elements(c.body->'items') where c.id=s.source_control_id and value->>'review_id'=x->>'review_id';
  if origin is null or origin->>'analysis_text' is distinct from x->>'analysis_text' or origin->>'original_text' is distinct from x->>'original_text' or origin->>'position' is distinct from x->>'position' or origin->>'establishment_id' is distinct from x->>'establishment_id' or x->>'analysis_text_sha256' is distinct from encode(extensions.digest(x->>'analysis_text','sha256'),'hex') or x->>'original_text_sha256' is distinct from encode(extensions.digest(x->>'original_text','sha256'),'hex') or x->>'case_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(x-'case_sha256'),'sha256'),'hex') or x->>'request_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(x->'payload'),'sha256'),'hex') or not exists(select 1 from public.analysis_luna_multirest_cases c where c.set_id=s.id and c.review_id=(x->>'review_id')::uuid and c.body=x and c.organization_id=s.organization_id) or not exists(select 1 from public.reviews q join public.establishments e on e.id=q.establishment_id where q.id=(x->>'review_id')::uuid and q.organization_id=s.organization_id and e.organization_id=s.organization_id and q.establishment_id=(x->>'establishment_id')::uuid) then raise exception 'MULTIREST_CASE_CHANGED';end if;
 end loop;
 for x in select value from jsonb_array_elements(r.body->'items') loop
  if not exists(select 1 from public.analysis_luna_multirest_references a where a.set_id=s.id and a.seal_id=r.id and a.organization_id=s.organization_id and a.review_id=(x->>'review_id')::uuid and a.theme_key=x->>'theme_key' and a.analysis_text_sha256=x->>'analysis_text_sha256' and a.choice=x->>'choice' and a.justification=x->>'justification') then raise exception 'MULTIREST_REFERENCE_CHANGED';end if;
 end loop;
end $$;
create function public.luna_multi_save_plan(p_user uuid,p_manifest jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.analysis_luna_multirest_sets;r public.analysis_luna_multirest_reference_seals;x jsonb;src jsonb;pid uuid;begin
 perform public.luna_multi_launch_check((p_manifest->>'set_id')::uuid,(p_manifest->>'seal_id')::uuid);
 select * into s from public.analysis_luna_multirest_sets where id=(p_manifest->>'set_id')::uuid;
 select * into r from public.analysis_luna_multirest_reference_seals where id=(p_manifest->>'seal_id')::uuid;
 if not exists(select 1 from public.organization_members where user_id=p_user and organization_id=s.organization_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_manifest->>'version' is distinct from 'luna-multirest-manual-run-v1' or p_manifest->>'organization_id' is distinct from s.organization_id::text or p_manifest->>'dataset_sha256' is distinct from s.body_sha256 or p_manifest->>'reference_sha256' is distinct from r.reference_sha256 or p_manifest->>'config_sha256' is distinct from s.config_sha256 or p_manifest->>'configuration_id' is distinct from 'luna-multirest-evidence-choice-v1' or p_manifest->>'model' is distinct from 'gpt-6-luna' or p_manifest->>'endpoint' is distinct from '/v1/decisions' or p_manifest->>'repeat_count' is distinct from '1' or p_manifest->>'max_calls' is distinct from '39' or p_manifest->>'automatic_retry' is distinct from 'false' or p_manifest->>'production_enabled' is distinct from 'false' or p_manifest->'estimated_cost_usd' is distinct from s.body->'estimated_cost_usd' or p_manifest->'estimated_input_tokens' is distinct from s.body->'estimated_input_tokens' or p_manifest->>'input_rate_per_million' is distinct from '0.1' or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_manifest),'sha256'),'hex') then raise exception 'MULTIREST_PLAN_INVALID';end if;
 if jsonb_array_length(p_manifest->'cases')<>39 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_manifest->'cases') x)<>39 or (select count(distinct x->>'position') from jsonb_array_elements(p_manifest->'cases') x)<>39 or jsonb_array_length(p_manifest->'excluded')<>1 or p_manifest->'excluded'->0->>'position' is distinct from '32' then raise exception 'MULTIREST_COUNT_CHANGED';end if;
 for x in select value from jsonb_array_elements(p_manifest->'cases') loop
  select value into src from jsonb_array_elements(s.body->'cases') where value->>'review_id'=x->>'review_id';
  if src is null or src->>'evaluation_eligible'<>'true' or jsonb_array_length(src->'translation_flags')<>0 or x->>'position'='32' or x->>'position' is distinct from src->>'position' or x->>'theme_key' is distinct from src->'candidate'->>'theme_key' or x->>'polarity' is distinct from src->'candidate'->>'polarity' or x->'payload' is distinct from src->'payload' or x->>'request_sha256' is distinct from src->>'request_sha256' or x->>'analysis_text_sha256' is distinct from src->>'analysis_text_sha256' or x->>'case_sha256' is distinct from src->>'case_sha256' or x->>'establishment_id' is distinct from src->>'establishment_id' then raise exception 'MULTIREST_CASE_CHANGED';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(s.id::text||':luna-multi-launch',0));
 select id into pid from public.analysis_luna_multirest_plans where set_id=s.id and seal_id=r.id;if found then if not exists(select 1 from public.analysis_luna_multirest_plans where id=pid and manifest_sha256=p_sha) then raise exception 'MULTIREST_PLAN_CHANGED';end if;return pid;end if;
 insert into public.analysis_luna_multirest_plans(organization_id,set_id,seal_id,version,manifest,manifest_sha256,created_by) values(s.organization_id,s.id,r.id,p_manifest->>'version',p_manifest,p_sha,p_user) returning id into pid;return pid;
end $$;
create function public.luna_multi_confirm(p_user uuid,p_plan uuid,p_sha text,p_cost numeric,p_consent text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_luna_multirest_plans; rid uuid; x jsonb;
begin
 select * into p from public.analysis_luna_multirest_plans where id=p_plan;
 if p.id is null or not exists(select 1 from public.organization_members m where m.user_id=p_user and m.organization_id=p.organization_id and m.role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform public.luna_multi_launch_check(p.set_id,p.seal_id);
 if p_consent is distinct from 'luna-multirest-cost-confirmation-v1' or p_sha is distinct from p.manifest_sha256 or p_cost is distinct from (p.manifest->>'estimated_cost_usd')::numeric then raise exception 'MULTIREST_CONFIRMATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':confirm',0));
 select id into rid from public.analysis_luna_multirest_runs where plan_id=p.id;if found then return rid;end if;
 insert into public.analysis_luna_multirest_runs(plan_id,organization_id,confirmed_by,consent_version,manifest_sha256,estimated_cost_usd) values(p.id,p.organization_id,p_user,p_consent,p_sha,p_cost) returning id into rid;
 for x in select value from jsonb_array_elements(p.manifest->'cases') loop
  insert into public.analysis_luna_multirest_tasks(run_id,organization_id,position,review_id,payload,request_sha256,analysis_text_sha256) values(rid,p.organization_id,(x->>'position')::int,(x->>'review_id')::uuid,x->'payload',x->>'request_sha256',x->>'analysis_text_sha256');
 end loop;
 insert into public.analysis_luna_multirest_events(run_id,organization_id,event,body) values(rid,p.organization_id,'manual_cost_confirmed',jsonb_build_object('user_id',p_user,'max_calls',39,'estimated_cost_usd',p_cost,'manifest_sha256',p_sha));return rid;
end $$;
create function public.luna_multi_claim(p_worker uuid,p_run uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.analysis_luna_multirest_tasks; r public.analysis_luna_multirest_runs;
begin
 -- A lost response is terminal. Never put it back in the queue.
 select * into r from public.analysis_luna_multirest_runs where id=p_run and status in('queued','running') for update;
 if r.id is null then return null;end if;
 update public.analysis_luna_multirest_tasks set status='billing_uncertain',completed_at=now(),error_code='WORKER_RESPONSE_LOST' where run_id=r.id and status='dispatched' and dispatched_at<now()-interval '5 minutes';
 perform public.luna_multi_launch_check('929bef2d-e841-43e0-a055-3d924d5f88b2','44f489ae-6f7f-4e9d-8c2f-ae6cfc955d7a');
 if not exists(select 1 from public.organization_members m where m.user_id=r.confirmed_by and m.organization_id=r.organization_id and m.role in('owner','admin','manager')) then perform public.luna_multi_stop_unsent(r.id,'MULTIREST_AUTHORIZATION_UNAVAILABLE');return null;end if;
 select q.* into t from public.analysis_luna_multirest_tasks q where q.run_id=r.id and q.status='queued' order by q.position for update skip locked limit 1;
 if t.id is null then return null;end if;
 if r.status not in('queued','running') or (select coalesce(sum(request_count),0) from public.analysis_luna_multirest_tasks where run_id=r.id)>=39 then return null;end if;
 if r.status='queued' then update public.analysis_luna_multirest_runs set status='running' where id=r.id;end if;
 update public.analysis_luna_multirest_tasks set status='dispatched',request_count=1,worker_id=p_worker,dispatched_at=now() where id=t.id returning * into t;
 insert into public.analysis_luna_multirest_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'attempt_reserved',jsonb_build_object('task_id',t.id,'position',t.position));return to_jsonb(t);
end $$;
create function public.luna_multi_finish(p_task uuid,p_worker uuid,p_status text,p_output jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.analysis_luna_multirest_tasks;
begin
 select * into t from public.analysis_luna_multirest_tasks where id=p_task for update;
 if t.id is null or t.worker_id is distinct from p_worker or t.status<>'dispatched' or p_status not in('completed','failed','billing_uncertain') then return false;end if;
 if p_output->'response' is not null and p_output->>'response_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_output->'response'),'sha256'),'hex') then raise exception 'MULTIREST_RESPONSE_CHANGED';end if;
 update public.analysis_luna_multirest_tasks set status=p_status,completed_at=now(),response=p_output->'response',response_sha256=p_output->>'response_sha256',parsed=p_output->'parsed',served_model=p_output->>'served_model',answer_type=p_output->>'answer_type',response_id=p_output->>'response_id',provider_request_id=p_output->>'provider_request_id',input_tokens=(p_output->>'input_tokens')::bigint,output_tokens=(p_output->>'output_tokens')::bigint,usage_details=p_output->'usage_details',cost_usd=(p_output->>'cost_usd')::numeric,duration_ms=(p_output->>'duration_ms')::bigint,error_code=p_output->>'error_code' where id=t.id;
 insert into public.analysis_luna_multirest_results(set_id,organization_id,seal_id,review_id,request_count,status,request_sha256,analysis_text_sha256,served_model,response,response_sha256,parsed,input_tokens,output_tokens,cost_usd,duration_ms,error_code)
 select p.set_id,t.organization_id,p.seal_id,t.review_id,1,p_status,t.request_sha256,t.analysis_text_sha256,p_output->>'served_model',p_output->'response',p_output->>'response_sha256',p_output->'parsed',(p_output->>'input_tokens')::bigint,(p_output->>'output_tokens')::bigint,(p_output->>'cost_usd')::numeric,(p_output->>'duration_ms')::bigint,p_output->>'error_code' from public.analysis_luna_multirest_runs r join public.analysis_luna_multirest_plans p on p.id=r.plan_id where r.id=t.run_id;
 insert into public.analysis_luna_multirest_events(run_id,organization_id,event,body) values(t.run_id,t.organization_id,p_status,jsonb_build_object('task_id',t.id,'error_code',p_output->>'error_code'));return true;
end $$;
create function public.luna_multi_complete(p_run uuid,p_result jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_luna_multirest_runs; state text;
begin
 select * into r from public.analysis_luna_multirest_runs where id=p_run for update;
 if r.id is null or r.status not in('queued','running') or exists(select 1 from public.analysis_luna_multirest_tasks where run_id=r.id and status in('queued','dispatched')) then return false;end if;
 if (select count(*) from public.analysis_luna_multirest_tasks where run_id=r.id)<>39 or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_result),'sha256'),'hex') then raise exception 'MULTIREST_RESULT_INVALID';end if;
 state:=case when exists(select 1 from public.analysis_luna_multirest_tasks where run_id=r.id and status='billing_uncertain') then 'billing_uncertain' when exists(select 1 from public.analysis_luna_multirest_tasks where run_id=r.id and status in('failed','cancelled')) then 'failed' else 'completed' end;
 update public.analysis_luna_multirest_runs set status=state,result=p_result,result_sha256=p_sha,completed_at=now() where id=r.id;
 insert into public.analysis_luna_multirest_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'run_stopped',jsonb_build_object('status',state,'result_sha256',p_sha));return true;
end $$;
create function public.luna_multi_stop_unsent(p_run uuid,p_error text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.analysis_luna_multirest_runs set status='running' where id=p_run and status='queued';
 update public.analysis_luna_multirest_tasks set status='cancelled',completed_at=now(),error_code=p_error where run_id=p_run and status='queued';
end $$;
do $$declare fn text;begin foreach fn in array array['luna_multi_launch_check(uuid,uuid)','luna_multi_state_guard()','luna_multi_task_insert_guard()','luna_multi_save_plan(uuid,jsonb,text)','luna_multi_confirm(uuid,uuid,text,numeric,text)','luna_multi_claim(uuid,uuid)','luna_multi_finish(uuid,uuid,text,jsonb)','luna_multi_complete(uuid,jsonb,text)','luna_multi_stop_unsent(uuid,text)'] loop
 execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;
-- Empty queue at deployment; scheduler can only process explicitly confirmed luna_multi jobs.
select cron.schedule('home-reviews-luna-multirest-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-luna-multirest',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_luna_multirest_runs where status in('queued','running'))
$cron$);
