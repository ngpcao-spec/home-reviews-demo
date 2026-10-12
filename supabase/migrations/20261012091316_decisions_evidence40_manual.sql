-- Dedicated manual evidence40 authorization. No jobs, authorizations or provider calls are created here.
create table public.analysis_decisions_evidence40_plans (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 experiment_id uuid not null, version text not null check(version='openai-decisions-evidence40-run-v1'),
 manifest jsonb not null, manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(experiment_id,organization_id) references public.analysis_decisions_experiments(id,organization_id), unique(experiment_id,version), unique(id,organization_id)
);
create table public.analysis_decisions_evidence40_runs (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null unique, organization_id uuid not null references public.organizations(id),
 status text not null default 'queued' check(status in('queued','running','completed','failed','billing_uncertain')),
 confirmed_by uuid not null references auth.users(id), confirmed_at timestamptz not null default now(), consent_version text not null check(consent_version='evidence40-cost-confirmation-v1'),
 manifest_sha256 text not null, estimated_cost_usd numeric not null check(estimated_cost_usd>=0), max_calls int not null default 40 check(max_calls=40),
 automatic_retry boolean not null default false check(not automatic_retry), result jsonb, result_sha256 text, completed_at timestamptz,
 foreign key(plan_id,organization_id) references public.analysis_decisions_evidence40_plans(id,organization_id),unique(id,organization_id)
);
create table public.analysis_decisions_evidence40_tasks (
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,position int not null check(position between 1 and 40), review_id uuid not null references public.reviews(id),
 payload jsonb not null,request_sha256 text not null,analysis_text_sha256 text not null,
 status text not null default 'queued' check(status in('queued','dispatched','completed','failed','billing_uncertain','cancelled')), request_count int not null default 0 check(request_count in(0,1)),
 worker_id uuid,dispatched_at timestamptz,completed_at timestamptz,response jsonb,response_sha256 text,parsed jsonb,served_model text,answer_type text,response_id text,provider_request_id text,
 input_tokens bigint check(input_tokens>=0),output_tokens bigint check(output_tokens>=0),usage_details jsonb,cost_usd numeric check(cost_usd>=0),duration_ms bigint check(duration_ms>=0),error_code text,
 foreign key(run_id,organization_id) references public.analysis_decisions_evidence40_runs(id,organization_id),unique(run_id,position),unique(run_id,review_id),
 check((status in('queued','cancelled') and request_count=0 and worker_id is null) or (status not in('queued','cancelled') and request_count=1 and worker_id is not null))
);
create table public.analysis_decisions_evidence40_events (
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,event text not null,body jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(run_id,organization_id) references public.analysis_decisions_evidence40_runs(id,organization_id)
);
do $$declare t text;begin foreach t in array array['analysis_decisions_evidence40_plans','analysis_decisions_evidence40_runs','analysis_decisions_evidence40_tasks','analysis_decisions_evidence40_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy evidence40_org_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
 execute format('create index %I on public.%I(organization_id)',t||'_org',t);
end loop;end $$;
create index evidence40_task_queue on public.analysis_decisions_evidence40_tasks(status,dispatched_at);
create index evidence40_task_review on public.analysis_decisions_evidence40_tasks(review_id);
create index evidence40_plan_actor on public.analysis_decisions_evidence40_plans(created_by);
create index evidence40_run_actor on public.analysis_decisions_evidence40_runs(confirmed_by);
create index evidence40_event_run on public.analysis_decisions_evidence40_events(run_id);
create trigger evidence40_plan_immutable before update or delete on public.analysis_decisions_evidence40_plans for each row execute function public.pilot_evidence_immutable();
create trigger evidence40_event_immutable before update or delete on public.analysis_decisions_evidence40_events for each row execute function public.pilot_evidence_immutable();
create function public.evidence40_state_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'EVIDENCE40_IMMUTABLE';end if;
 if tg_table_name='analysis_decisions_evidence40_runs' then
  if old.status in('completed','failed','billing_uncertain') or (to_jsonb(new)-array['status','result','result_sha256','completed_at']) is distinct from (to_jsonb(old)-array['status','result','result_sha256','completed_at']) or not (old.status='queued' and new.status in('running','failed') or old.status='running' and new.status in('running','completed','failed','billing_uncertain')) then raise exception 'EVIDENCE40_RUN_TRANSITION';end if;
 else
  if (to_jsonb(new)-array['status','request_count','worker_id','dispatched_at','completed_at','response','response_sha256','parsed','served_model','answer_type','response_id','provider_request_id','input_tokens','output_tokens','usage_details','cost_usd','duration_ms','error_code']) is distinct from (to_jsonb(old)-array['status','request_count','worker_id','dispatched_at','completed_at','response','response_sha256','parsed','served_model','answer_type','response_id','provider_request_id','input_tokens','output_tokens','usage_details','cost_usd','duration_ms','error_code']) or not (old.status='queued' and new.status='dispatched' and old.request_count=0 and new.request_count=1 or old.status='queued' and new.status='cancelled' and new.request_count=0 or old.status='dispatched' and new.status in('completed','failed','billing_uncertain') and new.request_count=1 and new.worker_id=old.worker_id and new.dispatched_at=old.dispatched_at) then raise exception 'EVIDENCE40_NO_RETRY_OR_MUTATION';end if;
 end if;return new;
end $$;
create trigger evidence40_run_state before update or delete on public.analysis_decisions_evidence40_runs for each row execute function public.evidence40_state_guard();
create trigger evidence40_task_state before update or delete on public.analysis_decisions_evidence40_tasks for each row execute function public.evidence40_state_guard();
create function public.evidence40_task_insert_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare x jsonb;
begin
 select value into x from public.analysis_decisions_evidence40_runs r join public.analysis_decisions_evidence40_plans p on p.id=r.plan_id cross join lateral jsonb_array_elements(p.manifest->'cases') where r.id=new.run_id and r.organization_id=new.organization_id and r.status='queued' and value->>'position'=new.position::text;
 if x is null or new.status<>'queued' or new.request_count<>0 or x->>'review_id' is distinct from new.review_id::text or x->'payload' is distinct from new.payload or x->>'request_sha256' is distinct from new.request_sha256 or x->>'analysis_text_sha256' is distinct from new.analysis_text_sha256 or not exists(select 1 from public.reviews where id=new.review_id and organization_id=new.organization_id) then raise exception 'EVIDENCE40_TASK_OUT_OF_SCOPE';end if;return new;
end $$;
create trigger evidence40_task_insert before insert on public.analysis_decisions_evidence40_tasks for each row execute function public.evidence40_task_insert_guard();
create function public.evidence40_save_plan(p_user uuid,p_manifest jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare e public.analysis_decisions_experiments; c public.analysis_decisions_configurations; x jsonb; src jsonb; pid uuid;
begin
 select * into e from public.analysis_decisions_experiments where id='73a7bfe9-c618-4e2f-aa82-3b0fae8eb989';
 if e.id is null or not exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id where m.user_id=p_user and m.organization_id=e.organization_id and m.role in('owner','admin','manager') and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())) then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_decisions_configurations where organization_id=e.organization_id and configuration_id='luna-decisions-evidence-choice-v1';
 if e.result_sha256 is distinct from p_manifest->'hashes'->>'preparation' or c.config_sha256 is distinct from p_manifest->'hashes'->>'configuration' or p_manifest->>'experiment_id' is distinct from e.id::text or p_manifest->>'organization_id' is distinct from e.organization_id::text or p_manifest->>'version' is distinct from 'openai-decisions-evidence40-run-v1' or p_manifest->>'control_id' is distinct from '3988aa10-0c5c-4a52-b1ff-1b576b488c52' or p_manifest->>'configuration_id' is distinct from c.configuration_id or p_manifest->>'model' is distinct from 'gpt-6-luna' or p_manifest->>'max_calls' is distinct from '40' or p_manifest->>'repeat_count' is distinct from '1' or p_manifest->>'automatic_retry' is distinct from 'false' or p_manifest->>'production_enabled' is distinct from 'false' or jsonb_array_length(p_manifest->'cases')<>40 or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_manifest),'sha256'),'hex') then raise exception 'EVIDENCE40_PLAN_INVALID';end if;
 if (select count(distinct x->>'review_id') from jsonb_array_elements(p_manifest->'cases') x)<>40 or (select count(distinct x->>'position') from jsonb_array_elements(p_manifest->'cases') x)<>40 then raise exception 'EVIDENCE40_COUNT_CHANGED';end if;
 for x in select value from jsonb_array_elements(p_manifest->'cases') loop
  select value into src from jsonb_array_elements(e.body->'evidence_verification'->'items') where value->>'review_id'=x->>'review_id' and value->>'theme_key'=x->>'theme_key';
  if src is null or x->>'position' is distinct from src->>'position' or x->>'polarity' is distinct from src->>'polarity' or x->>'analysis_text_sha256' is distinct from src->>'analysis_text_sha256' or x->>'analysis_text' is distinct from src->>'analysis_text' or x->>'request_sha256' is distinct from src->>'request_sha256' or x->>'request_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(x->'payload'),'sha256'),'hex') or x->'payload'->>'model' is distinct from 'gpt-6-luna' or jsonb_array_length(x->'payload'->'questions')<>1 or not exists(select 1 from public.reviews r where r.id=(x->>'review_id')::uuid and r.organization_id=e.organization_id) then raise exception 'EVIDENCE40_CASE_CHANGED';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':evidence40',0));
 select id into pid from public.analysis_decisions_evidence40_plans where experiment_id=e.id;
 if found then if not exists(select 1 from public.analysis_decisions_evidence40_plans where id=pid and manifest_sha256=p_sha) then raise exception 'EVIDENCE40_PLAN_CHANGED';end if;return pid;end if;
 insert into public.analysis_decisions_evidence40_plans(organization_id,experiment_id,version,manifest,manifest_sha256,created_by) values(e.organization_id,e.id,p_manifest->>'version',p_manifest,p_sha,p_user) returning id into pid;return pid;
end $$;
create function public.evidence40_confirm(p_user uuid,p_plan uuid,p_sha text,p_cost numeric,p_consent text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_decisions_evidence40_plans; rid uuid; x jsonb;
begin
 select * into p from public.analysis_decisions_evidence40_plans where id=p_plan;
 if p.id is null or not exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id where m.user_id=p_user and m.organization_id=p.organization_id and m.role in('owner','admin','manager') and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())) then raise exception 'FORBIDDEN';end if;
 if p_consent is distinct from 'evidence40-cost-confirmation-v1' or p_sha is distinct from p.manifest_sha256 or p_cost is distinct from (p.manifest->>'estimated_cost_usd')::numeric then raise exception 'EVIDENCE40_CONFIRMATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':confirm',0));
 select id into rid from public.analysis_decisions_evidence40_runs where plan_id=p.id;if found then return rid;end if;
 insert into public.analysis_decisions_evidence40_runs(plan_id,organization_id,confirmed_by,consent_version,manifest_sha256,estimated_cost_usd) values(p.id,p.organization_id,p_user,p_consent,p_sha,p_cost) returning id into rid;
 for x in select value from jsonb_array_elements(p.manifest->'cases') loop
  insert into public.analysis_decisions_evidence40_tasks(run_id,organization_id,position,review_id,payload,request_sha256,analysis_text_sha256) values(rid,p.organization_id,(x->>'position')::int,(x->>'review_id')::uuid,x->'payload',x->>'request_sha256',x->>'analysis_text_sha256');
 end loop;
 insert into public.analysis_decisions_evidence40_events(run_id,organization_id,event,body) values(rid,p.organization_id,'manual_cost_confirmed',jsonb_build_object('user_id',p_user,'max_calls',40,'estimated_cost_usd',p_cost,'manifest_sha256',p_sha));return rid;
end $$;
create function public.evidence40_claim(p_worker uuid,p_run uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.analysis_decisions_evidence40_tasks; r public.analysis_decisions_evidence40_runs;
begin
 -- A lost response is terminal. Never put it back in the queue.
 update public.analysis_decisions_evidence40_tasks set status='billing_uncertain',completed_at=now(),error_code='WORKER_RESPONSE_LOST' where status='dispatched' and dispatched_at<now()-interval '5 minutes';
 select q.* into t from public.analysis_decisions_evidence40_tasks q join public.analysis_decisions_evidence40_runs j on j.id=q.run_id where q.status='queued' and j.status in('queued','running') and (p_run is null or j.id=p_run) and exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id where m.user_id=j.confirmed_by and m.organization_id=j.organization_id and m.role in('owner','admin','manager') and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())) order by j.confirmed_at,q.position for update of q skip locked limit 1;
 if t.id is null then return null;end if;
 select * into r from public.analysis_decisions_evidence40_runs where id=t.run_id for update;
 if r.status not in('queued','running') or (select coalesce(sum(request_count),0) from public.analysis_decisions_evidence40_tasks where run_id=r.id)>=40 then return null;end if;
 if r.status='queued' then update public.analysis_decisions_evidence40_runs set status='running' where id=r.id;end if;
 update public.analysis_decisions_evidence40_tasks set status='dispatched',request_count=1,worker_id=p_worker,dispatched_at=now() where id=t.id returning * into t;
 insert into public.analysis_decisions_evidence40_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'attempt_reserved',jsonb_build_object('task_id',t.id,'position',t.position));return to_jsonb(t);
end $$;
create function public.evidence40_finish(p_task uuid,p_worker uuid,p_status text,p_output jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.analysis_decisions_evidence40_tasks;
begin
 select * into t from public.analysis_decisions_evidence40_tasks where id=p_task for update;
 if t.id is null or t.worker_id is distinct from p_worker or t.status<>'dispatched' or p_status not in('completed','failed','billing_uncertain') then return false;end if;
 update public.analysis_decisions_evidence40_tasks set status=p_status,completed_at=now(),response=p_output->'response',response_sha256=p_output->>'response_sha256',parsed=p_output->'parsed',served_model=p_output->>'served_model',answer_type=p_output->>'answer_type',response_id=p_output->>'response_id',provider_request_id=p_output->>'provider_request_id',input_tokens=(p_output->>'input_tokens')::bigint,output_tokens=(p_output->>'output_tokens')::bigint,usage_details=p_output->'usage_details',cost_usd=(p_output->>'cost_usd')::numeric,duration_ms=(p_output->>'duration_ms')::bigint,error_code=p_output->>'error_code' where id=t.id;
 insert into public.analysis_decisions_evidence40_events(run_id,organization_id,event,body) values(t.run_id,t.organization_id,p_status,jsonb_build_object('task_id',t.id,'error_code',p_output->>'error_code'));return true;
end $$;
create function public.evidence40_complete(p_run uuid,p_result jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_decisions_evidence40_runs; state text;
begin
 select * into r from public.analysis_decisions_evidence40_runs where id=p_run for update;
 if r.id is null or r.status not in('queued','running') or exists(select 1 from public.analysis_decisions_evidence40_tasks where run_id=r.id and status in('queued','dispatched')) then return false;end if;
 if (select count(*) from public.analysis_decisions_evidence40_tasks where run_id=r.id)<>40 or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_result),'sha256'),'hex') then raise exception 'EVIDENCE40_RESULT_INVALID';end if;
 state:=case when exists(select 1 from public.analysis_decisions_evidence40_tasks where run_id=r.id and status='billing_uncertain') then 'billing_uncertain' when exists(select 1 from public.analysis_decisions_evidence40_tasks where run_id=r.id and status in('failed','cancelled')) then 'failed' else 'completed' end;
 update public.analysis_decisions_evidence40_runs set status=state,result=p_result,result_sha256=p_sha,completed_at=now() where id=r.id;
 insert into public.analysis_decisions_evidence40_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'run_stopped',jsonb_build_object('status',state,'result_sha256',p_sha));return true;
end $$;
create function public.evidence40_stop_unsent(p_run uuid,p_error text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.analysis_decisions_evidence40_runs set status='running' where id=p_run and status='queued';
 update public.analysis_decisions_evidence40_tasks set status='cancelled',completed_at=now(),error_code=p_error where run_id=p_run and status='queued';
end $$;
do $$declare fn text;begin foreach fn in array array['evidence40_state_guard()','evidence40_task_insert_guard()','evidence40_save_plan(uuid,jsonb,text)','evidence40_confirm(uuid,uuid,text,numeric,text)','evidence40_claim(uuid,uuid)','evidence40_finish(uuid,uuid,text,jsonb)','evidence40_complete(uuid,jsonb,text)','evidence40_stop_unsent(uuid,text)'] loop
 execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;
-- Empty queue at deployment; scheduler can only process explicitly confirmed evidence40 jobs.
select cron.schedule('home-reviews-decisions-evidence40-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-decisions-evidence40',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_decisions_evidence40_runs where status in('queued','running'))
$cron$);
