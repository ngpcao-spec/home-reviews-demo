-- Same manual-only durable Luna architecture, scoped to grouped V2 questions; migration creates no plans, runs, tasks or spending consent.
create table public.analysis_luna_negative_v2_plans(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),set_id uuid not null,seal_id uuid not null,
 version text not null check(version='luna-negative-v2-manual-run-v1'),manifest jsonb not null,manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(set_id,organization_id) references public.analysis_luna_negative_v2_sets(id,organization_id),foreign key(seal_id,set_id,organization_id) references public.analysis_luna_negative_v2_reference_seals(id,set_id,organization_id),unique(set_id,seal_id),unique(id,organization_id)
);
create table public.analysis_luna_negative_v2_runs (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null unique, organization_id uuid not null references public.organizations(id),
 status text not null default 'queued' check(status in('queued','running','completed','failed','billing_uncertain')),
 confirmed_by uuid not null references auth.users(id), confirmed_at timestamptz not null default now(), consent_version text not null check(consent_version='luna-negative-v2-cost-confirmation-v1'),
 manifest_sha256 text not null, estimated_cost_usd numeric not null check(estimated_cost_usd>=0), max_calls int not null default 28 check(max_calls=28),
 automatic_retry boolean not null default false check(not automatic_retry), result jsonb, result_sha256 text, completed_at timestamptz,
 foreign key(plan_id,organization_id) references public.analysis_luna_negative_v2_plans(id,organization_id),unique(id,organization_id)
);
create table public.analysis_luna_negative_v2_tasks (
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,position int not null check(position between 1 and 28), review_id uuid not null references public.reviews(id),
 payload jsonb not null,request_sha256 text not null,analysis_text_sha256 text not null,
 status text not null default 'queued' check(status in('queued','dispatched','completed','failed','billing_uncertain','cancelled')), request_count int not null default 0 check(request_count in(0,1)),
 worker_id uuid,dispatched_at timestamptz,completed_at timestamptz,response jsonb,response_sha256 text,parsed jsonb,served_model text,answer_type text,response_id text,provider_request_id text,
 input_tokens bigint check(input_tokens>=0),output_tokens bigint check(output_tokens>=0),usage_details jsonb,cost_usd numeric check(cost_usd>=0),duration_ms bigint check(duration_ms>=0),error_code text,
 foreign key(run_id,organization_id) references public.analysis_luna_negative_v2_runs(id,organization_id),unique(run_id,position),unique(run_id,review_id),
 check((status in('queued','cancelled') and request_count=0 and worker_id is null) or (status not in('queued','cancelled') and request_count=1 and worker_id is not null))
);
create table public.analysis_luna_negative_v2_events (
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,event text not null,body jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(run_id,organization_id) references public.analysis_luna_negative_v2_runs(id,organization_id)
);
create table public.analysis_luna_negative_v2_results(
 run_id uuid not null,task_id uuid not null references public.analysis_luna_negative_v2_tasks(id),organization_id uuid not null,set_id uuid not null,seal_id uuid not null,review_id uuid not null,question_id text not null,theme_key text not null,polarity text not null check(polarity in('positive','negative')),
 status text not null check(status in('completed','failed','billing_uncertain')),native_choice text check(native_choice in('supported','unsupported','uncertain')),choice text check(choice in('supported','unsupported','uncertain')),probabilities jsonb,confidence numeric check(confidence between 0 and 1),refused boolean,served_model text,analysis_text_sha256 text not null,request_sha256 text not null,response_sha256 text,native_answer jsonb,error_code text,created_at timestamptz not null default now(),
 primary key(run_id,question_id),unique(run_id,review_id,theme_key),foreign key(run_id,organization_id)references public.analysis_luna_negative_v2_runs(id,organization_id),foreign key(set_id,review_id,theme_key)references public.analysis_luna_negative_v2_associations(set_id,review_id,theme_key),foreign key(seal_id,set_id,organization_id)references public.analysis_luna_negative_v2_reference_seals(id,set_id,organization_id)
);
create index luna_nv2_result_task on public.analysis_luna_negative_v2_results(task_id);
create index luna_nv2_result_assoc on public.analysis_luna_negative_v2_results(set_id,review_id,theme_key);
create index luna_nv2_result_seal on public.analysis_luna_negative_v2_results(seal_id,set_id,organization_id);
create trigger luna_nv2_result_immutable before update or delete on public.analysis_luna_negative_v2_results for each row execute function public.pilot_evidence_immutable();
-- Tokens, duration and calculated cost live on ONE task per request, never summed from question rows.
do $$declare t text;begin foreach t in array array['analysis_luna_negative_v2_plans','analysis_luna_negative_v2_runs','analysis_luna_negative_v2_tasks','analysis_luna_negative_v2_events','analysis_luna_negative_v2_results'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy luna_nv2_org_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
 execute format('create index %I on public.%I(organization_id)',t||'_org',t);
end loop;end $$;
create index luna_nv2_task_queue on public.analysis_luna_negative_v2_tasks(status,dispatched_at);
create index luna_nv2_task_review on public.analysis_luna_negative_v2_tasks(review_id);
create index luna_nv2_plan_actor on public.analysis_luna_negative_v2_plans(created_by);
create index luna_nv2_plan_seal on public.analysis_luna_negative_v2_plans(seal_id,set_id,organization_id);
create index luna_nv2_run_actor on public.analysis_luna_negative_v2_runs(confirmed_by);
create index luna_nv2_event_run on public.analysis_luna_negative_v2_events(run_id);
create trigger luna_nv2_plan_immutable before update or delete on public.analysis_luna_negative_v2_plans for each row execute function public.pilot_evidence_immutable();
create trigger luna_nv2_event_immutable before update or delete on public.analysis_luna_negative_v2_events for each row execute function public.pilot_evidence_immutable();
create function public.luna_nv2_state_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'NEGATIVE_V2_IMMUTABLE';end if;
 if tg_table_name='analysis_luna_negative_v2_runs' then
  if old.status in('completed','failed','billing_uncertain') or (to_jsonb(new)-array['status','result','result_sha256','completed_at']) is distinct from (to_jsonb(old)-array['status','result','result_sha256','completed_at']) or not (old.status='queued' and new.status in('running','failed') or old.status='running' and new.status in('running','completed','failed','billing_uncertain')) then raise exception 'NEGATIVE_V2_RUN_TRANSITION';end if;
 else
  if (to_jsonb(new)-array['status','request_count','worker_id','dispatched_at','completed_at','response','response_sha256','parsed','served_model','answer_type','response_id','provider_request_id','input_tokens','output_tokens','usage_details','cost_usd','duration_ms','error_code']) is distinct from (to_jsonb(old)-array['status','request_count','worker_id','dispatched_at','completed_at','response','response_sha256','parsed','served_model','answer_type','response_id','provider_request_id','input_tokens','output_tokens','usage_details','cost_usd','duration_ms','error_code']) or not (old.status='queued' and new.status='dispatched' and old.request_count=0 and new.request_count=1 or old.status='queued' and new.status='cancelled' and new.request_count=0 or old.status='dispatched' and new.status in('completed','failed','billing_uncertain') and new.request_count=1 and new.worker_id=old.worker_id and new.dispatched_at=old.dispatched_at) then raise exception 'NEGATIVE_V2_NO_RETRY_OR_MUTATION';end if;
 end if;return new;
end $$;
create trigger luna_nv2_run_state before update or delete on public.analysis_luna_negative_v2_runs for each row execute function public.luna_nv2_state_guard();
create trigger luna_nv2_task_state before update or delete on public.analysis_luna_negative_v2_tasks for each row execute function public.luna_nv2_state_guard();
create function public.luna_nv2_task_insert_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare x jsonb;
begin
 select value into x from public.analysis_luna_negative_v2_runs r join public.analysis_luna_negative_v2_plans p on p.id=r.plan_id cross join lateral jsonb_array_elements(p.manifest->'cases') where r.id=new.run_id and r.organization_id=new.organization_id and r.status='queued' and value->>'position'=new.position::text;
 if x is null or new.status<>'queued' or new.request_count<>0 or x->>'review_id' is distinct from new.review_id::text or x->'payload' is distinct from new.payload or x->>'request_sha256' is distinct from new.request_sha256 or x->>'analysis_text_sha256' is distinct from new.analysis_text_sha256 or not exists(select 1 from public.reviews where id=new.review_id and organization_id=new.organization_id) then raise exception 'NEGATIVE_V2_TASK_OUT_OF_SCOPE';end if;return new;
end $$;
create trigger luna_nv2_task_insert before insert on public.analysis_luna_negative_v2_tasks for each row execute function public.luna_nv2_task_insert_guard();

create function public.luna_nv2_launch_check(p_set uuid,p_seal uuid) returns void language plpgsql security invoker set search_path='' as $$
declare s public.analysis_luna_negative_v2_sets;seal public.analysis_luna_negative_v2_reference_seals;x jsonb;a jsonb;
begin
 select * into s from public.analysis_luna_negative_v2_sets where id=p_set;
 select * into seal from public.analysis_luna_negative_v2_reference_seals where id=p_seal and set_id=p_set;
 if s.id is distinct from 'c8b3eee7-2554-43d9-a16b-5e12413af793'::uuid or seal.id is distinct from 'c4031dc6-e0a3-4992-bb35-f790ecccd034'::uuid or s.organization_id is distinct from '93228bbb-6397-41e3-b8be-21ee7060eda7'::uuid or seal.organization_id is distinct from s.organization_id then raise exception 'NEGATIVE_V2_LAUNCH_SCOPE_CHANGED';end if;
 if s.body_sha256 is distinct from '6e464e2f0fa13ae1f83168b65a04e3de3e396fc0c1150d08ba71e8e30b008189' or seal.reference_sha256 is distinct from '048df28c19e95a25e426ebb08fbb58665634027f85906712072b94e788818592' or s.body_sha256<>encode(extensions.digest(public.jev_economy_canonical(s.body),'sha256'),'hex') or seal.reference_sha256<>encode(extensions.digest(public.jev_economy_canonical(seal.body),'sha256'),'hex') or seal.dataset_sha256<>s.body_sha256 or seal.body->>'dataset_sha256' is distinct from s.body_sha256 or s.config_sha256 is distinct from 'beb203a8c28cd68be8e556807d9b51cd096083d69734ed0692732440398bef4f' or s.config_sha256<>encode(extensions.digest(public.jev_economy_canonical(s.body->'config'),'sha256'),'hex') or s.body->>'reviews_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(s.body->'reviews'),'sha256'),'hex') then raise exception 'NEGATIVE_V2_LAUNCH_HASH_CHANGED';end if;
 if s.review_count<>28 or s.question_count<>32 or jsonb_array_length(s.body->'reviews')<>28 or jsonb_array_length(seal.body->'items')<>32 or (select count(*) from public.analysis_luna_negative_v2_reviews where set_id=s.id)<>28 or (select count(*) from public.analysis_luna_negative_v2_associations where set_id=s.id)<>32 or (select count(*) from public.analysis_luna_negative_v2_references where set_id=s.id and seal_id=seal.id)<>32 or (select count(distinct establishment_id) from public.analysis_luna_negative_v2_reviews where set_id=s.id)<>13 then raise exception 'NEGATIVE_V2_LAUNCH_COUNT_CHANGED';end if;
 if exists(select 1 from public.analysis_luna_negative_v2_reviews fr join public.reviews r on r.id=fr.review_id join public.establishments e on e.id=r.establishment_id where fr.set_id=s.id and (r.organization_id<>s.organization_id or e.organization_id<>s.organization_id or r.establishment_id<>fr.establishment_id or fr.organization_id<>s.organization_id)) then raise exception 'FORBIDDEN';end if;
 for x in select value from jsonb_array_elements(s.body->'reviews') loop
  if not exists(select 1 from public.analysis_luna_negative_v2_reviews fr where fr.set_id=s.id and fr.review_id=(x->>'review_id')::uuid and fr.body=x and fr.analysis_text_sha256=x->>'analysis_text_sha256' and fr.review_sha256=x->>'review_sha256') or x->>'analysis_text_sha256' is distinct from encode(extensions.digest(x->>'analysis_text','sha256'),'hex') or x->>'original_text_sha256' is distinct from encode(extensions.digest(x->>'original_text','sha256'),'hex') or x->>'review_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(x-'review_sha256'),'sha256'),'hex') or x->>'request_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(x->'payload'),'sha256'),'hex') or x->'payload'->>'model' is distinct from 'gpt-6-luna' or jsonb_array_length(x->'payload'->'questions')<>jsonb_array_length(x->'associations') then raise exception 'NEGATIVE_V2_LAUNCH_REVIEW_CHANGED';end if;
  for a in select value from jsonb_array_elements(x->'associations') loop
   if not exists(select 1 from public.analysis_luna_negative_v2_associations fr where fr.set_id=s.id and fr.review_id=(x->>'review_id')::uuid and fr.body=a and fr.association_id=a->>'association_id' and fr.theme_key=a->>'theme_key' and fr.polarity=a->>'polarity') then raise exception 'NEGATIVE_V2_LAUNCH_ASSOCIATION_CHANGED';end if;
  end loop;
 end loop;
 for x in select value from jsonb_array_elements(seal.body->'items') loop
  if not exists(select 1 from public.analysis_luna_negative_v2_references fr join public.analysis_luna_negative_v2_reviews rv using(set_id,review_id) where fr.set_id=s.id and fr.seal_id=seal.id and fr.review_id=(x->>'review_id')::uuid and fr.theme_key=x->>'theme_key' and fr.choice=x->>'choice' and fr.justification=x->>'justification' and fr.analysis_text_sha256=x->>'analysis_text_sha256' and fr.analysis_text_sha256=rv.analysis_text_sha256 and fr.organization_id=s.organization_id) then raise exception 'NEGATIVE_V2_LAUNCH_REFERENCE_CHANGED';end if;
 end loop;
end $$;
create function public.luna_nv2_save_plan(p_user uuid,p_manifest jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.analysis_luna_negative_v2_sets;seal public.analysis_luna_negative_v2_reference_seals;pid uuid;x jsonb;src jsonb;
begin
 perform public.luna_nv2_launch_check((p_manifest->>'set_id')::uuid,(p_manifest->>'seal_id')::uuid);
 select * into s from public.analysis_luna_negative_v2_sets where id=(p_manifest->>'set_id')::uuid;
 select * into seal from public.analysis_luna_negative_v2_reference_seals where id=(p_manifest->>'seal_id')::uuid;
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
 insert into public.analysis_luna_negative_v2_plans(organization_id,set_id,seal_id,version,manifest,manifest_sha256,created_by)values(s.organization_id,s.id,seal.id,p_manifest->>'version',p_manifest,p_sha,p_user)returning id into pid;return pid;
end $$;
create function public.luna_nv2_confirm(p_user uuid,p_plan uuid,p_sha text,p_cost numeric,p_consent text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_luna_negative_v2_plans; rid uuid; x jsonb;
begin
 select * into p from public.analysis_luna_negative_v2_plans where id=p_plan;
 if p.id is null or not exists(select 1 from public.organization_members m where m.user_id=p_user and m.organization_id=p.organization_id and m.role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform public.luna_nv2_launch_check(p.set_id,p.seal_id);
 if p_consent is distinct from 'luna-negative-v2-cost-confirmation-v1' or p_sha is distinct from p.manifest_sha256 or p_cost is distinct from (p.manifest->>'estimated_cost_usd')::numeric then raise exception 'NEGATIVE_V2_CONFIRMATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':confirm',0));
 select id into rid from public.analysis_luna_negative_v2_runs where plan_id=p.id;if found then return rid;end if;
 insert into public.analysis_luna_negative_v2_runs(plan_id,organization_id,confirmed_by,consent_version,manifest_sha256,estimated_cost_usd) values(p.id,p.organization_id,p_user,p_consent,p_sha,p_cost) returning id into rid;
 for x in select value from jsonb_array_elements(p.manifest->'cases') loop
  insert into public.analysis_luna_negative_v2_tasks(run_id,organization_id,position,review_id,payload,request_sha256,analysis_text_sha256) values(rid,p.organization_id,(x->>'position')::int,(x->>'review_id')::uuid,x->'payload',x->>'request_sha256',x->>'analysis_text_sha256');
 end loop;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body) values(rid,p.organization_id,'manual_cost_confirmed',jsonb_build_object('user_id',p_user,'max_calls',28,'estimated_cost_usd',p_cost,'manifest_sha256',p_sha));return rid;
end $$;
create function public.luna_nv2_claim(p_worker uuid,p_run uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.analysis_luna_negative_v2_tasks; r public.analysis_luna_negative_v2_runs; expired public.analysis_luna_negative_v2_tasks;
begin
 -- A lost response is terminal. Never put it back in the queue.
 select * into r from public.analysis_luna_negative_v2_runs where id=p_run and status in('queued','running') for update;
 if r.id is null then return null;end if;
 for expired in select * from public.analysis_luna_negative_v2_tasks where run_id=r.id and status='dispatched' and dispatched_at<now()-interval '5 minutes' loop perform public.luna_nv2_finish(expired.id,expired.worker_id,'billing_uncertain','{"error_code":"WORKER_RESPONSE_LOST"}'::jsonb);end loop;
 perform public.luna_nv2_launch_check('c8b3eee7-2554-43d9-a16b-5e12413af793','c4031dc6-e0a3-4992-bb35-f790ecccd034');
 if not exists(select 1 from public.organization_members m where m.user_id=r.confirmed_by and m.organization_id=r.organization_id and m.role in('owner','admin','manager')) then perform public.luna_nv2_stop_unsent(r.id,'NEGATIVE_V2_AUTHORIZATION_UNAVAILABLE');return null;end if;
 select q.* into t from public.analysis_luna_negative_v2_tasks q where q.run_id=r.id and q.status='queued' order by q.position for update skip locked limit 1;
 if t.id is null then return null;end if;
 if r.status not in('queued','running') or (select coalesce(sum(request_count),0) from public.analysis_luna_negative_v2_tasks where run_id=r.id)>=28 then return null;end if;
 if r.status='queued' then update public.analysis_luna_negative_v2_runs set status='running' where id=r.id;end if;
 update public.analysis_luna_negative_v2_tasks set status='dispatched',request_count=1,worker_id=p_worker,dispatched_at=now() where id=t.id returning * into t;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'attempt_reserved',jsonb_build_object('task_id',t.id,'position',t.position));return to_jsonb(t);
end $$;
create function public.luna_nv2_finish(p_task uuid,p_worker uuid,p_status text,p_output jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.analysis_luna_negative_v2_tasks;p public.analysis_luna_negative_v2_plans;a jsonb;obs jsonb;native jsonb;
begin
 select * into t from public.analysis_luna_negative_v2_tasks where id=p_task for update;
 if t.id is null or t.worker_id is distinct from p_worker or t.status<>'dispatched' or p_status not in('completed','failed','billing_uncertain') then return false;end if;
 select plan.* into p from public.analysis_luna_negative_v2_runs r join public.analysis_luna_negative_v2_plans plan on plan.id=r.plan_id where r.id=t.run_id;
 if p_output->'response' is not null and p_output->>'response_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_output->'response'),'sha256'),'hex') then raise exception 'NEGATIVE_V2_RESPONSE_CHANGED';end if;
 if p_status='completed' then
  if coalesce(jsonb_array_length(p_output->'parsed'->'observations'),0)<>jsonb_array_length(t.payload->'questions') or coalesce(jsonb_array_length(p_output->'response'->'answers'),0)<>jsonb_array_length(t.payload->'questions') or coalesce(p_output->>'served_model','')!~'^gpt-6-luna(-[0-9]{4}-[0-9]{2}-[0-9]{2})?$' then raise exception 'NEGATIVE_V2_PARSED_RESPONSE_INVALID';end if;
  if p_output->>'input_tokens' is null or p_output->>'output_tokens' is null or (p_output->>'cost_usd')::numeric is distinct from (p_output->>'input_tokens')::numeric*0.1/1000000 then raise exception 'NEGATIVE_V2_USAGE_INVALID';end if;
 end if;
 update public.analysis_luna_negative_v2_tasks set status=p_status,completed_at=now(),response=p_output->'response',response_sha256=p_output->>'response_sha256',parsed=p_output->'parsed',served_model=p_output->>'served_model',answer_type=p_output->>'answer_type',response_id=p_output->>'response_id',provider_request_id=p_output->>'provider_request_id',input_tokens=(p_output->>'input_tokens')::bigint,output_tokens=(p_output->>'output_tokens')::bigint,usage_details=p_output->'usage_details',cost_usd=(p_output->>'cost_usd')::numeric,duration_ms=(p_output->>'duration_ms')::bigint,error_code=p_output->>'error_code' where id=t.id;
 for a in select value from jsonb_array_elements((select it->'associations' from jsonb_array_elements(p.manifest->'cases')it where it->>'review_id'=t.review_id::text))loop
  obs:=null;native:=null;
  select value into obs from jsonb_array_elements(coalesce(p_output->'parsed'->'observations','[]')) where value->>'theme_key'=a->>'theme_key' and value->>'review_id'=t.review_id::text;
  select value into native from jsonb_array_elements(case when jsonb_typeof(p_output->'response'->'answers')='array' then p_output->'response'->'answers' else '[]'::jsonb end) where value->>'name'=a->>'association_id';
  if p_status='completed' then
   if obs is null or native is null or obs->>'choice' not in('supported','unsupported','uncertain') then raise exception 'NEGATIVE_V2_QUESTION_BINDING_CHANGED';end if;
   if native->>'type'='refusal' then
    if obs->>'choice' is distinct from 'uncertain' or obs->>'refused' is distinct from 'true' then raise exception 'NEGATIVE_V2_REFUSAL_CHANGED';end if;
   elsif native->>'type'='choice' then
    if obs->>'refused' is distinct from 'false' or obs->'confidence' is distinct from native->'confidence' or obs->'probabilities' is distinct from (select jsonb_object_agg(q->>'value',q->'probability') from jsonb_array_elements(native->'probabilities')q) or obs->>'choice' is distinct from (case when (native->>'confidence')::numeric<0.60 then 'uncertain' else native->>'choice' end) or p_output->>'served_model' is distinct from p_output->'response'->>'model' then raise exception 'NEGATIVE_V2_NATIVE_CHOICE_CHANGED';end if;
   else raise exception 'NEGATIVE_V2_WRONG_ANSWER_TYPE';end if;
  end if;
  insert into public.analysis_luna_negative_v2_results(run_id,task_id,organization_id,set_id,seal_id,review_id,question_id,theme_key,polarity,status,native_choice,choice,probabilities,confidence,refused,served_model,analysis_text_sha256,request_sha256,response_sha256,native_answer,error_code)
  values(t.run_id,t.id,t.organization_id,p.set_id,p.seal_id,t.review_id,a->>'association_id',a->>'theme_key',a->>'polarity',p_status,case when native->>'choice' in('supported','unsupported','uncertain') then native->>'choice' else null end,case when p_status='completed' then obs->>'choice' else null end,obs->'probabilities',(obs->>'confidence')::numeric,(obs->>'refused')::boolean,p_output->>'served_model',t.analysis_text_sha256,t.request_sha256,p_output->>'response_sha256',native,p_output->>'error_code');
 end loop;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body)values(t.run_id,t.organization_id,p_status,jsonb_build_object('task_id',t.id,'error_code',p_output->>'error_code'));return true;
end $$;
create function public.luna_nv2_complete(p_run uuid,p_result jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_luna_negative_v2_runs; state text;
begin
 select * into r from public.analysis_luna_negative_v2_runs where id=p_run for update;
 if r.id is null or r.status not in('queued','running') or exists(select 1 from public.analysis_luna_negative_v2_tasks where run_id=r.id and status in('queued','dispatched')) then return false;end if;
 if (select count(*) from public.analysis_luna_negative_v2_tasks where run_id=r.id)<>28 or p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_result),'sha256'),'hex') then raise exception 'NEGATIVE_V2_RESULT_INVALID';end if;
 state:=case when exists(select 1 from public.analysis_luna_negative_v2_tasks where run_id=r.id and status='billing_uncertain') then 'billing_uncertain' when exists(select 1 from public.analysis_luna_negative_v2_tasks where run_id=r.id and status in('failed','cancelled')) then 'failed' else 'completed' end;
 update public.analysis_luna_negative_v2_runs set status=state,result=p_result,result_sha256=p_sha,completed_at=now() where id=r.id;
 insert into public.analysis_luna_negative_v2_events(run_id,organization_id,event,body) values(r.id,r.organization_id,'run_stopped',jsonb_build_object('status',state,'result_sha256',p_sha));return true;
end $$;
create function public.luna_nv2_stop_unsent(p_run uuid,p_error text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.analysis_luna_negative_v2_runs set status='running' where id=p_run and status='queued';
 update public.analysis_luna_negative_v2_tasks set status='cancelled',completed_at=now(),error_code=p_error where run_id=p_run and status='queued';
end $$;
do $$declare fn text;begin foreach fn in array array['luna_nv2_launch_check(uuid,uuid)','luna_nv2_state_guard()','luna_nv2_task_insert_guard()','luna_nv2_save_plan(uuid,jsonb,text)','luna_nv2_confirm(uuid,uuid,text,numeric,text)','luna_nv2_claim(uuid,uuid)','luna_nv2_finish(uuid,uuid,text,jsonb)','luna_nv2_complete(uuid,jsonb,text)','luna_nv2_stop_unsent(uuid,text)'] loop
 execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;
-- Empty queue at deployment; scheduler can only process explicitly confirmed V2 jobs.
select cron.schedule('home-reviews-luna-negative-v2','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-luna-negative-v2',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_luna_negative_v2_runs where status in('queued','running'))
$cron$);
