-- Preparation creates no run, consent, attempt or wake.
create table public.analysis_jls_restaurant_protocols(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),authority_user_id uuid not null,
 body jsonb not null,sha256 text not null unique check(sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),unique(id,organization_id),
 check(establishment_id='d40d3438-79d8-4c28-8b09-eba640598201'));
create table public.analysis_jls_restaurant_runs(
 id uuid primary key default gen_random_uuid(),protocol_id uuid not null unique,organization_id uuid not null,
 consent jsonb not null,consent_sha256 text not null,expires_at timestamptz not null,
 stage text not null default 'jev' check(stage in('jev','luna','sol')),
 status text not null default 'queued' check(status in('queued','running','completed','needs_review','blocked','billing_uncertain','authorization_expired')),
 error_code text,worker text,lease_until timestamptz,created_at timestamptz not null default now(),
 unique(id,organization_id),foreign key(protocol_id,organization_id) references public.analysis_jls_restaurant_protocols(id,organization_id));
create table public.analysis_jls_restaurant_tasks(
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,
 phase text not null check(phase in('jev','luna','sol')),task_key text not null,review_id uuid,
 request jsonb not null,request_sha256 text not null,identity jsonb,cache_id uuid references public.analysis_jev_review_cache(id),
 status text not null default 'pending' check(status in('pending','running','completed','reused','needs_review','invalid_output','billing_uncertain','blocked')),
 request_count integer not null default 0 check(request_count in(0,1)),
 worker text,dispatched_at timestamptz,completed_at timestamptz,error_code text,
 unique(run_id,phase,task_key),foreign key(run_id,organization_id) references public.analysis_jls_restaurant_runs(id,organization_id),
 check((phase='sol' and task_key='sol' and review_id is null) or (phase<>'sol' and task_key=review_id::text)));
create table public.analysis_jls_restaurant_artifacts(
 id uuid primary key default gen_random_uuid(),run_id uuid not null,organization_id uuid not null,
 kind text not null,body jsonb not null,sha256 text not null,created_at timestamptz not null default now(),
 unique(run_id,kind),foreign key(run_id,organization_id) references public.analysis_jls_restaurant_runs(id,organization_id));
create index jls_restaurant_protocol_org on public.analysis_jls_restaurant_protocols(organization_id,establishment_id);
create index jls_restaurant_run_scope on public.analysis_jls_restaurant_runs(protocol_id,organization_id);
create index jls_restaurant_task_scope on public.analysis_jls_restaurant_tasks(run_id,organization_id);
create index jls_restaurant_task_cache on public.analysis_jls_restaurant_tasks(cache_id);
create index jls_restaurant_artifact_scope on public.analysis_jls_restaurant_artifacts(run_id,organization_id);
do $$declare t text;begin
 foreach t in array array['analysis_jls_restaurant_protocols','analysis_jls_restaurant_runs','analysis_jls_restaurant_tasks','analysis_jls_restaurant_artifacts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy restaurant_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
  if t in('analysis_jls_restaurant_protocols','analysis_jls_restaurant_artifacts') then
   execute format('create trigger immutable before update or delete on public.%I for each row execute function public.pilot_evidence_immutable()',t);
  end if;
 end loop;
end $$;
create function public.jls_restaurant_hash(p jsonb) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(public.jev_economy_canonical(p),'sha256'),'hex') $$;
create function public.jls_restaurant_state_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'JLS_HISTORY_IMMUTABLE';end if;
 if tg_table_name='analysis_jls_restaurant_runs' then
  if old.status not in('queued','running') then
   if (to_jsonb(new)-array['worker','lease_until']) is distinct from (to_jsonb(old)-array['worker','lease_until']) then raise exception 'JLS_RUN_IMMUTABLE';end if;
  elsif (to_jsonb(new)-array['status','stage','error_code','worker','lease_until']) is distinct from (to_jsonb(old)-array['status','stage','error_code','worker','lease_until']) then raise exception 'JLS_RUN_IMMUTABLE';end if;
 else
  if old.status not in('pending','running') or new.request_count<old.request_count
  or (to_jsonb(new)-array['status','request_count','worker','dispatched_at','completed_at','error_code','cache_id']) is distinct from (to_jsonb(old)-array['status','request_count','worker','dispatched_at','completed_at','error_code','cache_id'])
  or old.request_count=1 and new.request_count<>1 then raise exception 'JLS_NO_RETRY';end if;
 end if;return new;end $$;
create trigger restaurant_run_guard before update or delete on public.analysis_jls_restaurant_runs for each row execute function public.jls_restaurant_state_guard();
create trigger restaurant_task_guard before update or delete on public.analysis_jls_restaurant_tasks for each row execute function public.jls_restaurant_state_guard();
create function public.jls_restaurant_valid(p_run uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id
 join public.organization_members m on m.organization_id=r.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager')
 where r.id=p_run and r.status in('queued','running') and r.expires_at>now()
 and r.organization_id=p.organization_id and p.sha256=public.jls_restaurant_hash(p.body)
 and r.consent_sha256=public.jls_restaurant_hash(r.consent) and r.consent->>'protocol_sha256'=p.sha256
 and r.consent->>'consent_source'='user_directive_codex_delegation') $$;
create function public.save_jls_restaurant_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare id uuid;org uuid=(p_body->>'organization_id')::uuid;est uuid=(p_body->>'establishment_id')::uuid;u uuid=(p_body->>'authority_user_id')::uuid;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version'<>'jls-restaurant-delegated-vi-v1'
 or est<>'d40d3438-79d8-4c28-8b09-eba640598201'::uuid or not exists(select 1 from public.establishments e where e.id=est and e.organization_id=org and e.active)
 or not exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=u and m.role in('owner','admin','manager'))
 or (p_body->>'max_sol_calls')::int<>1 or (p_body->>'max_luna_calls')::int<>32
 or (p_body->>'max_jev_calls')::int<>jsonb_array_length(p_body->'pending')
 or p_body->>'preparation_is_not_spending_authorization'<>'true'
 or p_body->'configuration'->'policy'->>'no_monetary_estimate'<>'true'
 or p_body->'configuration'->'policy'->>'automatic_retry'<>'false'
 or p_body->'configuration'->'policy'->>'language'<>'vi' then raise exception 'JLS_PROTOCOL_INVALID';end if;
 for v in select value from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews') loop
  if not exists(select 1 from public.reviews r where r.id=(v->>'id')::uuid and r.establishment_id=est and r.organization_id=org
   and encode(extensions.digest(coalesce(r.original_text,''),'sha256'),'hex')=v->>'original_text_sha256')
  then raise exception 'JLS_SOURCE_CHANGED';end if;
 end loop;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256) values(org,est,u,p_body,p_sha)
 on conflict(sha256) do nothing returning analysis_jls_restaurant_protocols.id into id;
 if id is null then select p.id into id from public.analysis_jls_restaurant_protocols p where p.sha256=p_sha;end if;
 return id;end $$;
create function public.authorize_jls_restaurant(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
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
 'max_luna_calls',32,'max_sol_calls',1,'automatic_retry',false,'provider_client_retries',0,'apify_calls',0)
 or not exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'))
 then raise exception 'JLS_NEW_GO_REQUIRED';end if;
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at)
 values(p.id,p.organization_id,p_consent,p_sha,(p_consent->>'expires_at')::timestamptz) returning * into r;
 for v in select value from jsonb_array_elements(p.body->'pending') loop
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
  values(r.id,r.organization_id,'jev',v->>'review_id',(v->>'review_id')::uuid,(v->'payload')||jsonb_build_object('questions',p.body->'configuration'->'jev_request_template'->'questions'),v->>'request_sha256',v->'identity');
 end loop;return r.id;end $$;
create function public.claim_jls_restaurant_tick(p_run uuid,p_worker text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if r.status not in('queued','running') then return false;end if;
 if not public.jls_restaurant_valid(r.id) then update public.analysis_jls_restaurant_runs set status='authorization_expired',error_code='JLS_AUTHORIZATION_EXPIRED' where id=r.id;return false;end if;
 if r.lease_until>now() then return false;end if;
 if exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=r.id and t.status='running') then
  update public.analysis_jls_restaurant_runs set status='billing_uncertain',error_code='JLS_LOST_ATTEMPT_NO_RETRY' where id=r.id;return false;end if;
 update public.analysis_jls_restaurant_runs set status='running',worker=p_worker,lease_until=now()+interval '5 minutes' where id=r.id;
 return true;end $$;
create function public.jls_restaurant_cache_dispatch_allowed(p_cache uuid,p_org uuid,p_config text) returns boolean language sql stable set search_path='' as $$
 select p_config='v12_economy_1pass_v1' and exists(select 1 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_runs r on r.id=t.run_id
 where t.cache_id=p_cache and t.organization_id=p_org and t.phase='jev' and t.status='running' and t.request_count=1
 and r.status='running' and r.lease_until>now() and public.jls_restaurant_valid(r.id)) $$;
create function public.claim_jls_restaurant_task(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
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
 (case t.phase when 'jev' then (p.body->>'max_jev_calls')::int when 'luna' then 32 else 1 end) then raise exception 'JLS_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now(),cache_id=c.id where id=t.id returning * into t;
 if t.phase='jev' then update public.analysis_jev_review_cache set status='dispatched',attempt_id=t.id,confirmed_by=p.authority_user_id,confirmed_at=now() where id=c.id;end if;
 return to_jsonb(t);end $$;
create function public.save_jls_restaurant_artifact(p_run uuid,p_worker text,p_kind text,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;oldsha text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if r.worker<>p_worker or r.lease_until<=now() or p_sha<>public.jls_restaurant_hash(p_body) then return false;end if;
 select sha256 into oldsha from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind=p_kind;
 if oldsha is not null then return oldsha=p_sha;end if;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values(r.id,r.organization_id,p_kind,p_body,p_sha);return true;end $$;
create function public.finish_jls_restaurant_task(p_task uuid,p_worker text,p_status text,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare t public.analysis_jls_restaurant_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jls_restaurant_tasks where id=p_task for update;
 if t.status<>'running' or t.request_count<>1 or t.worker<>p_worker or p_status not in('completed','needs_review','invalid_output','billing_uncertain','blocked')
 or not public.save_jls_restaurant_artifact(t.run_id,p_worker,'task:'||t.id,p_body,p_sha) then return false;end if;
 if t.phase='jev' then
  update public.analysis_jev_review_cache set status=case when p_status='completed' then 'completed' else 'billing_uncertain' end,
  response=p_body->'jev_response',theme_results=p_body->'theme_results',input_tokens=(p_body->>'input_tokens')::bigint,
  output_tokens=(p_body->>'output_tokens')::bigint,cost_usd=(p_body->>'cost_usd')::numeric,usage_complete=p_status='completed',
  served_model=p_body->>'served_model',processed_at=now(),error_code=p_body->>'error_code' where id=t.cache_id;
 end if;
 update public.analysis_jls_restaurant_tasks set status=p_status,error_code=p_body->>'error_code',completed_at=now() where id=t.id;
 if p_status not in('completed') then update public.analysis_jls_restaurant_runs set status=case when p_status='billing_uncertain' then p_status when p_status='needs_review' then p_status else 'blocked' end,error_code=p_body->>'error_code' where id=t.run_id and status in('queued','running');end if;
 return true;end $$;
create function public.stage_jls_restaurant(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean language plpgsql set search_path='' as $$
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
  if plan is null or jsonb_array_length(p_tasks)<>jsonb_array_length(plan->'luna_groups') or jsonb_array_length(p_tasks)>32
  or (plan->>'question_count')::int>32 or plan->>'source_sha256'<>p.body->'snapshot'->>'source_sha256' then return false;end if;
 else
  select body into draft from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='sol_dossier';
  if draft is null or draft->'gate'->>'passed'<>'true' or jsonb_array_length(p_tasks)<>1 then return false;end if;
 end if;
 for v in select value from jsonb_array_elements(p_tasks) loop
  if v->>'request_sha256'<>public.jls_restaurant_hash(v->'request') then raise exception 'JLS_REQUEST_CHANGED';end if;
  if p_stage='luna' then
   if v->'request'->>'model'<>'gpt-6-luna' or not exists(select 1 from jsonb_array_elements(plan->'luna_groups') g where g->>'review_id'=v->>'review_id'
    and g->>'request_sha256'=v->>'request_sha256') then raise exception 'JLS_LUNA_MANIFEST_CHANGED';end if;
  elsif v->'request'->>'model'<>'gpt-6.1-sol' or v->>'request_sha256'<>draft->'draft'->>'request_sha256' then raise exception 'JLS_SOL_MANIFEST_CHANGED';end if;
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
  values(r.id,r.organization_id,p_stage,coalesce(v->>'review_id','sol'),(v->>'review_id')::uuid,v->'request',v->>'request_sha256');
 end loop;
 update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;end $$;
create function public.release_jls_restaurant_tick(p_run uuid,p_worker text,p_error text default null) returns void language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 update public.analysis_jls_restaurant_runs set lease_until=null,worker=null,
 status=case when p_error is null then status when exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=p_run and t.status='running') then 'billing_uncertain' else 'blocked' end,
 error_code=coalesce(error_code,p_error) where id=p_run and worker=p_worker and status in('queued','running');
 update public.analysis_jls_restaurant_runs set lease_until=null,worker=null where id=p_run and worker=p_worker and status not in('queued','running');
end $$;
create function public.wake_jls_restaurant(p_run uuid) returns bigint language plpgsql set search_path='' as $$
declare req bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not public.jls_restaurant_valid(p_run) then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('run_id',p_run),timeout_milliseconds:=1000) into req;return req;end $$;
-- No run exists during preparation, therefore the scheduler dispatches nothing.
select cron.schedule('jls-restaurant-durable-wake','* * * * *',$job$
 set local role service_role;
 select public.wake_jls_restaurant(id) from public.analysis_jls_restaurant_runs where status in('queued','running');
 $job$);
do $$declare f record;begin
 for f in select oid::regprocedure p from pg_proc where pronamespace='public'::regnamespace
 and (proname like '%jls_restaurant%' or proname='authorize_jls_restaurant') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.p);
 execute format('grant execute on function %s to service_role',f.p);end loop;end $$;
CREATE OR REPLACE FUNCTION public.jev_economy_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.analysis_jev_economy_configurations;identity jsonb;begin
 if tg_table_name<>'analysis_jev_review_cache' then raise exception 'ECONOMY_IMMUTABLE';end if;
 if tg_op='DELETE' then raise exception 'ECONOMY_CACHE_PERMANENT';end if;
 if tg_op='UPDATE' then
 if old.status in ('completed','billing_uncertain') then raise exception 'ECONOMY_CACHE_IMMUTABLE';end if;
 if (to_jsonb(new)-array['status','response','theme_results','input_tokens','output_tokens','cost_usd','usage_complete','processed_at','attempt_id','confirmed_by','confirmed_at','served_model','error_code']) is distinct from (to_jsonb(old)-array['status','response','theme_results','input_tokens','output_tokens','cost_usd','usage_complete','processed_at','attempt_id','confirmed_by','confirmed_at','served_model','error_code']) then raise exception 'ECONOMY_IDENTITY_IMMUTABLE';end if;
 if not (old.status='reserved' and new.status in ('dispatched','failed_not_sent') or old.status='dispatched' and new.status in ('completed','billing_uncertain')) then raise exception 'ECONOMY_NO_AUTOMATIC_RETRY';end if;
 end if;
 select * into c from public.analysis_jev_economy_configurations where id=new.configuration_id;
 if not found or new.instruction_version<>c.config->>'instruction_version' or new.threshold_version<>c.config->>'threshold_version' or new.instruction_sha256<>c.instruction_sha256 or new.threshold_sha256<>c.threshold_sha256 or new.requested_model<>c.config->>'requested_model' then raise exception 'ECONOMY_CONFIGURATION_MISMATCH';end if;
 if not exists(select 1 from public.reviews r join public.establishments e on e.id=r.establishment_id where r.id=new.review_id and e.id=new.establishment_id and e.organization_id=new.organization_id) then raise exception 'ECONOMY_ORGANIZATION_MISMATCH';end if;
 identity=jsonb_build_object('organization_id',new.organization_id,'establishment_id',new.establishment_id,'review_id',new.review_id,'analysis_text_sha256',new.analysis_text_sha256,'configuration_id',new.configuration_id,'instruction_version',new.instruction_version,'instruction_sha256',new.instruction_sha256,'threshold_version',new.threshold_version,'threshold_sha256',new.threshold_sha256,'requested_model',new.requested_model,'expected_served_model',new.expected_served_model);
 if new.cache_key<>encode(extensions.digest(public.jev_economy_canonical(identity),'sha256'),'hex') then raise exception 'ECONOMY_CACHE_KEY_MISMATCH';end if;
 if new.status='completed' and (jsonb_typeof(new.response->'themes') is distinct from 'object' or (select count(*) from jsonb_object_keys(new.response->'themes'))<>25 or (select count(*) from jsonb_object_keys(new.theme_results))<>25 or exists(select 1 from jsonb_object_keys(c.config->'questions') k where not(new.response->'themes'?k) or not(new.theme_results?k))) then raise exception 'ECONOMY_RESPONSE_INVALID';end if;
 if new.status='dispatched' and not exists(select 1 from public.analysis_jev_compact_tasks t join public.analysis_jev_compact_runs r on r.id=t.run_id join public.analysis_jev_compact_authorizations a on a.set_id=r.set_id where t.cache_id=new.id and t.status='running' and t.configuration_id=new.configuration_id and r.status='running' and a.organization_id=new.organization_id and r.organization_id=new.organization_id and r.cost_confirmed_at is not null and a.dataset_sha256=r.seal->>'dataset_sha256' and a.reference_sha256=r.seal->>'reference_sha256') and not public.pilot_cache_dispatch_allowed(new.id,new.organization_id,new.configuration_id) and not public.jls_restaurant_cache_dispatch_allowed(new.id,new.organization_id,new.configuration_id) then raise exception 'ECONOMY_PAID_ENGINE_DISABLED';end if;
 return new;end $function$
;
