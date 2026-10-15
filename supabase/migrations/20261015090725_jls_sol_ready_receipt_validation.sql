-- Sol-only immutable preparation and a shared durable state machine for paid
-- operations and explicitly isolated technical mocks. No run/consent is seeded.
create table public.analysis_jls_sol_ready_artifacts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 source_protocol_id uuid not null references public.analysis_jls_restaurant_protocols(id),
 source_run_id uuid not null references public.analysis_jls_restaurant_runs(id),
 body jsonb not null,sha256 text not null unique,created_at timestamptz not null default now());
create index on public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id);
create table public.analysis_jls_sol_ready_operations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 artifact_id uuid not null references public.analysis_jls_sol_ready_artifacts(id),mode text not null check(mode in('mock','paid')),
 protocol_id uuid references public.analysis_jls_restaurant_protocols(id),protocol_body jsonb,protocol_sha256 text not null,
 run_id uuid unique references public.analysis_jls_restaurant_runs(id),task_id uuid unique references public.analysis_jls_restaurant_tasks(id),
 nonce text unique,phase text not null default 'sol' check(phase in('sol','validate_sol')),
 status text not null default 'queued' check(status in('queued','dispatched','received','validating','completed','needs_review','invalid_output','blocked','billing_uncertain','authorization_expired')),
 request_count int not null default 0 check(request_count in(0,1)),worker text,lease_until timestamptz,
 receipt jsonb,receipt_sha256 text,result jsonb,result_sha256 text,error_code text,metrics jsonb not null default '[]',
 created_at timestamptz not null default now(),completed_at timestamptz,
 check(mode='mock' and run_id is null and task_id is null and protocol_id is null and protocol_body is not null and nonce is not null
 or mode='paid' and run_id is not null and task_id is not null and protocol_id is not null and protocol_body is null));
create index on public.analysis_jls_sol_ready_operations(organization_id,artifact_id);
create index on public.analysis_jls_sol_ready_operations(protocol_id);
create table public.analysis_jls_sol_ready_checks(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 artifact_id uuid not null unique references public.analysis_jls_sol_ready_artifacts(id),body jsonb not null,sha256 text not null,created_at timestamptz default now());
create index on public.analysis_jls_sol_ready_checks(organization_id);
do $$declare t text;begin foreach t in array array['analysis_jls_sol_ready_artifacts','analysis_jls_sol_ready_operations','analysis_jls_sol_ready_checks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy ready_org_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
end loop;end $$;
create trigger ready_artifact_immutable before update or delete on public.analysis_jls_sol_ready_artifacts for each row execute function public.pilot_evidence_immutable();
create trigger ready_check_immutable before update or delete on public.analysis_jls_sol_ready_checks for each row execute function public.pilot_evidence_immutable();
create function public.jls_ready_operation_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'JLS_READY_IMMUTABLE';end if;
 if (to_jsonb(new)-array['phase','status','request_count','worker','lease_until','receipt','receipt_sha256','result','result_sha256','error_code','metrics','completed_at'])
 is distinct from (to_jsonb(old)-array['phase','status','request_count','worker','lease_until','receipt','receipt_sha256','result','result_sha256','error_code','metrics','completed_at'])
 or new.request_count<old.request_count or old.receipt is not null and (new.receipt is distinct from old.receipt or new.receipt_sha256 is distinct from old.receipt_sha256)
 or old.result is not null and (new.result is distinct from old.result or new.result_sha256 is distinct from old.result_sha256)
 or old.status in('completed','needs_review','invalid_output','blocked','billing_uncertain','authorization_expired') and new.status<>old.status
 then raise exception 'JLS_READY_IMMUTABLE';end if;return new;end $$;
create trigger ready_operation_guard before update or delete on public.analysis_jls_sol_ready_operations for each row execute function public.jls_ready_operation_guard();
alter table public.analysis_jls_restaurant_runs drop constraint analysis_jls_restaurant_runs_stage_check;
alter table public.analysis_jls_restaurant_runs add check(stage in('jev','luna','prepare_sol','sol','validate_sol'));
alter table public.analysis_jls_restaurant_tasks drop constraint analysis_jls_restaurant_tasks_status_check;
alter table public.analysis_jls_restaurant_tasks add check(status in('pending','running','received','completed','reused','needs_review','invalid_output','billing_uncertain','blocked'));
create function public.check_jls_sol_ready_sources(p_body jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;x jsonb;t public.analysis_jls_restaurant_tasks;a public.analysis_jls_restaurant_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid;
 if p.id is null or r.protocol_id<>p.id or r.status<>'blocked' or p.sha256<>p_body->>'source_protocol_sha256'
 or p.sha256<>public.jls_restaurant_hash(p.body) or jsonb_array_length(p_body->'source_tasks')<>28
 or jsonb_array_length(p_body->'decisions')<>32 or p_body->>'decisions_sha256'<>public.jls_restaurant_hash(p_body->'decisions')
 or not public.check_jls_restaurant_prepared_cache(p.id)
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='sol')
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts d where d.run_id=r.id and d.kind='luna_decisions'
 and d.sha256=p_body->>'source_decisions_artifact_sha256' and d.sha256=public.jls_restaurant_hash(d.body)
 and d.body->>'decisions_sha256'=p_body->>'decisions_sha256') then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'source_tasks') loop
 select * into t from public.analysis_jls_restaurant_tasks where id=(x->>'task_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.id is null or t.run_id<>r.id or t.organization_id<>r.organization_id or t.phase<>'luna' or t.status<>'completed' or t.request_count<>1
 or t.review_id::text<>x->>'review_id' or t.request_sha256<>x->>'request_sha256' or t.request_sha256<>public.jls_restaurant_hash(t.request)
 or a.sha256 is distinct from x->>'artifact_sha256' or a.sha256<>public.jls_restaurant_hash(a.body)
 or a.body->>'response_sha256' is distinct from x->>'response_sha256'
 or a.body->>'response_sha256'<>public.jls_restaurant_hash(a.body->'response') then return false;end if;
 end loop;return true;end $$;
create function public.save_jls_sol_ready_artifact(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 if p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version'<>'jls-sol-final-request-v1' or not public.check_jls_sol_ready_sources(p_body)
 or p_body->>'plan_sha256'<>public.jls_restaurant_hash(p_body->'plan') or p_body->'plan'->>'source_sha256'<>p.body->'snapshot'->>'source_sha256'
 or p_body->'sol'->'gate'->>'passed' is distinct from 'true'
 or p_body->>'token_certificate_sha256'<>public.jls_restaurant_hash(p_body->'token_certificate')
 or p_body->>'request_raw_sha256'<>encode(extensions.digest(p_body->>'request_json','sha256'),'hex')
 or p_body->>'request_sha256'<>public.jls_restaurant_hash((p_body->>'request_json')::jsonb)
 or p_body->'sol'->'draft'->>'request_sha256'<>p_body->>'request_sha256'
 or p_body->'measurement'->>'input_budget_tokens' is distinct from '32768'
 or (p_body->'measurement'->>'guarded_input_tokens')::int not between 1 and 32768
 or p_body->'measurement'->>'output_reserved_tokens' is distinct from '9500'
 or octet_length(p_body->>'request_json')>1048576 then raise exception 'JLS_SOL_READY_ARTIFACT_INVALID';end if;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256)
 values(p.organization_id,p.id,(p_body->>'source_run_id')::uuid,p_body,p_sha) on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_sol_ready_artifacts where sha256=p_sha;end if;return rid;end $$;
create function public.create_jls_sol_ready_probe(p_body jsonb,p_sha text,p_nonce text) returns uuid language plpgsql set search_path='' as $$
declare a public.analysis_jls_sol_ready_artifacts;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where sha256=p_body->'sol_ready'->>'artifact_sha256';
 if a.id is null or p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version'<>'jls-restaurant-sol-ready-vi-v1'
 or (p_body->>'organization_id')::uuid<>a.organization_id or p_body->>'max_jev_calls'<>'0' or p_body->>'max_luna_calls'<>'0'
 or p_body->>'max_sol_calls'<>'1' or not public.check_jls_sol_ready_sources(a.body) then raise exception 'JLS_READY_PROBE_INVALID';end if;
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_body,protocol_sha256,nonce)
 values(a.organization_id,a.id,'mock',p_body,p_sha,p_nonce) on conflict(nonce) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_sol_ready_operations where nonce=p_nonce and mode='mock' and protocol_sha256=p_sha;end if;
 if rid is null then raise exception 'JLS_READY_PROBE_CHANGED';end if;return rid;end $$;
create function public.claim_jls_sol_ready(p_operation uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare o public.analysis_jls_sol_ready_operations;a public.analysis_jls_sol_ready_artifacts;t jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for update;
 if o.id is null or o.status in('completed','needs_review','invalid_output','blocked','billing_uncertain','authorization_expired') or o.lease_until>now() then return null;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 if not public.check_jls_sol_ready_sources(a.body) then raise exception 'JLS_REUSED_SOURCES_CHANGED';end if;
 if o.phase='sol' and o.request_count=1 then
 update public.analysis_jls_sol_ready_operations set status='billing_uncertain',error_code='JLS_LOST_ATTEMPT_NO_RETRY' where id=o.id;
 if o.mode='paid' then update public.analysis_jls_restaurant_runs set status='billing_uncertain',error_code='JLS_LOST_ATTEMPT_NO_RETRY' where id=o.run_id and status in('queued','running');end if;return null;end if;
 if o.mode='paid' then
 if not public.claim_jls_restaurant_tick(o.run_id,p_worker) then return null;end if;
 if o.phase='sol' then
 t=public.claim_jls_restaurant_task(o.run_id,p_worker);
 if t is null or t->>'id'<>o.task_id::text or t->>'request_sha256'<>a.body->>'request_sha256' then raise exception 'JLS_READY_TASK_CHANGED';end if;
 end if;end if;
 update public.analysis_jls_sol_ready_operations set worker=p_worker,lease_until=now()+interval '5 minutes',
 request_count=case when phase='sol' then 1 else request_count end,status=case when phase='sol' then 'dispatched' else 'validating' end
 where id=o.id returning * into o;return to_jsonb(o);end $$;
create function public.receive_jls_sol_ready(p_operation uuid,p_worker text,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare o public.analysis_jls_sol_ready_operations;a public.analysis_jls_sol_ready_artifacts;uncertain boolean;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for update;
 if o.receipt is not null then return o.receipt_sha256=p_sha;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 if o.worker<>p_worker or o.status<>'dispatched' or o.request_count<>1 or p_sha<>public.jls_restaurant_hash(p_body)
 or p_body->>'request_sha256'<>a.body->>'request_sha256' or p_body->>'request_raw_sha256'<>a.body->>'request_raw_sha256'
 or (p_body->>'mock')::boolean is distinct from (o.mode='mock')
 or p_body->>'raw_response_text' is not null and p_body->>'raw_response_sha256' is distinct from encode(extensions.digest(p_body->>'raw_response_text','sha256'),'hex')
 then return false;end if;
 uncertain=p_body->>'raw_response_text' is null;
 if o.mode='paid' then
 if not public.save_jls_restaurant_artifact(o.run_id,p_worker,'sol_receipt',p_body,p_sha) then return false;end if;
 update public.analysis_jls_restaurant_tasks set status=case when uncertain then 'billing_uncertain' else 'received' end,error_code=p_body->>'error_code' where id=o.task_id;
 update public.analysis_jls_restaurant_runs set stage='validate_sol',status=case when uncertain then 'billing_uncertain' else status end,error_code=p_body->>'error_code',worker=null,lease_until=null where id=o.run_id;
 end if;
 update public.analysis_jls_sol_ready_operations set receipt=p_body,receipt_sha256=p_sha,phase='validate_sol',
 status=case when uncertain then 'billing_uncertain' else 'received' end,worker=null,lease_until=null,error_code=p_body->>'error_code' where id=o.id;return true;end $$;
create function public.finish_jls_sol_ready(p_operation uuid,p_worker text,p_status text,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare o public.analysis_jls_sol_ready_operations;run_status text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for update;
 if o.result is not null then return o.result_sha256=p_sha;end if;
 if o.worker<>p_worker or o.status<>'validating' or o.request_count<>1 or o.receipt is null
 or p_status not in('completed','needs_review','invalid_output','billing_uncertain') or p_sha<>public.jls_restaurant_hash(p_body)
 or p_body->>'receipt_sha256'<>o.receipt_sha256 or p_body->>'raw_response_sha256'<>o.receipt->>'raw_response_sha256'
 then return false;end if;
 if o.mode='paid' then
 if not public.save_jls_restaurant_artifact(o.run_id,p_worker,'task:'||o.task_id,p_body,p_sha) then return false;end if;
 update public.analysis_jls_restaurant_tasks set status=p_status,error_code=p_body->>'error_code',completed_at=now() where id=o.task_id;
 run_status=case when p_status='invalid_output' then 'blocked' else p_status end;
 update public.analysis_jls_restaurant_runs set status=run_status,error_code=p_body->>'error_code',worker=null,lease_until=null where id=o.run_id;
 end if;
 update public.analysis_jls_sol_ready_operations set result=p_body,result_sha256=p_sha,status=p_status,
 worker=null,lease_until=null,completed_at=now(),error_code=p_body->>'error_code' where id=o.id;return true;end $$;
create function public.abort_jls_sol_ready(p_operation uuid,p_worker text,p_error text) returns void language plpgsql set search_path='' as $$
declare o public.analysis_jls_sol_ready_operations;s text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for update;
 if o.id is null or o.status in('completed','needs_review','invalid_output','blocked','billing_uncertain','authorization_expired') then return;end if;
 if o.worker is not null and o.worker<>p_worker then return;end if;
 s=case when o.request_count=1 and o.phase='sol' then 'billing_uncertain' else 'blocked' end;
 update public.analysis_jls_sol_ready_operations set status=s,error_code=p_error,worker=null,lease_until=null where id=o.id;
 if o.mode='paid' then update public.analysis_jls_restaurant_runs set status=s,error_code=p_error,worker=null,lease_until=null where id=o.run_id and status in('queued','running');end if;end $$;
create function public.record_jls_sol_ready_metric(p_operation uuid,p_metric jsonb) returns void language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 update public.analysis_jls_sol_ready_operations set metrics=metrics||jsonb_build_array(p_metric) where id=p_operation and mode='mock';end $$;
create function public.qualify_jls_sol_ready(p_sha text,p_body jsonb,p_hash text) returns uuid language plpgsql set search_path='' as $$
declare a public.analysis_jls_sol_ready_artifacts;rid uuid;m jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where sha256=p_sha;
 if a.id is null or p_hash<>public.jls_restaurant_hash(p_body) or p_body->>'provider_calls' is distinct from '0'
 or p_body->>'full_worker_path' is distinct from 'true' or jsonb_array_length(p_body->'measurements')<2 then raise exception 'JLS_READY_QUALIFICATION_INVALID';end if;
 for m in select value from jsonb_array_elements(p_body->'measurements') loop
 if (m->>'cpu_ms')::int not between 1 and 1500 or (m->>'memory_bytes')::bigint not between 1 and 268435455
 or m->>'source'<>'supabase_native_Shutdown' or not exists(select 1 from public.analysis_jls_sol_ready_operations o
 where o.id=(m->>'operation_id')::uuid and o.artifact_id=a.id and o.mode='mock' and o.request_count=1 and o.receipt is not null
 and o.result is not null and o.status in('completed','needs_review')) then raise exception 'JLS_READY_MARGIN_INSUFFICIENT';end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(p_body->'measurements') m where m->>'phase'='sol')
 or not exists(select 1 from jsonb_array_elements(p_body->'measurements') m where m->>'phase'='validate_sol') then raise exception 'JLS_READY_PHASE_NOT_MEASURED';end if;
 insert into public.analysis_jls_sol_ready_checks(organization_id,artifact_id,body,sha256) values(a.organization_id,a.id,p_body,p_hash)
 on conflict(artifact_id) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_sol_ready_checks where artifact_id=a.id and sha256=p_hash;end if;
 if rid is null then raise exception 'JLS_READY_QUALIFICATION_IMMUTABLE';end if;return rid;end $$;
create function public.save_jls_sol_ready_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare a public.analysis_jls_sol_ready_artifacts;p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where sha256=p_body->'sol_ready'->>'artifact_sha256';
 select * into p from public.analysis_jls_restaurant_protocols where id=a.source_protocol_id;
 if a.id is null or p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version'<>'jls-restaurant-sol-ready-vi-v1'
 or p_body->>'organization_id'<>a.organization_id::text or p_body->>'establishment_id'<>p.establishment_id::text
 or p_body->>'authority_user_id'<>p.authority_user_id::text or p_body->'snapshot' is distinct from p.body->'snapshot'
 or p_body->'cache' is distinct from p.body->'cache' or p_body->>'max_jev_calls'<>'0' or p_body->>'max_luna_calls'<>'0'
 or p_body->>'max_sol_calls'<>'1' or p_body->'configuration'->'policy'->>'automatic_retry' is distinct from 'false'
 or p_body->'sol_ready'->>'request_sha256'<>a.body->>'request_sha256'
 or p_body->>'configuration_sha256'<>public.jls_restaurant_hash(p_body->'configuration')
 or not exists(select 1 from public.analysis_jls_sol_ready_checks where artifact_id=a.id)
 or not public.check_jls_sol_ready_sources(a.body)
 or not exists(select 1 from public.organization_members m where m.organization_id=a.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'))
 then raise exception 'JLS_SOL_READY_PROTOCOL_INVALID';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values(p.organization_id,p.establishment_id,p.authority_user_id,p_body,p_sha) on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;end $$;
alter function public.authorize_jls_restaurant(uuid,jsonb,text) rename to authorize_jls_restaurant_pre_ready;
create function public.authorize_jls_restaurant(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;a public.analysis_jls_sol_ready_artifacts;rid uuid;tid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p.body->>'version'<>'jls-restaurant-sol-ready-vi-v1' then return public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id;if rid is not null then return rid;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where sha256=p.body->'sol_ready'->>'artifact_sha256';
 if a.id is null or not public.check_jls_sol_ready_sources(a.body) or not exists(select 1 from public.analysis_jls_sol_ready_checks where artifact_id=a.id)
 then raise exception 'JLS_READY_NOT_QUALIFIED';end if;
 rid=public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);
 update public.analysis_jls_restaurant_runs set stage='sol' where id=rid and status='queued';
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256)
 values(rid,p.organization_id,'sol','sol',(a.body->>'request_json')::jsonb,a.body->>'request_sha256') returning id into tid;
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_id,protocol_sha256,run_id,task_id)
 values(p.organization_id,a.id,'paid',p.id,p.sha256,rid,tid);return rid;end $$;
create function public.wake_jls_sol_ready_probe(p_operation uuid,p_variant text default 'normal') returns bigint language plpgsql set search_path='' as $$
declare req bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_variant not in('normal','large_response') or not exists(select 1 from public.analysis_jls_sol_ready_operations where id=p_operation and mode='mock') then raise exception 'JLS_READY_PROBE_ONLY';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode','sol_ready_probe','operation_id',p_operation,'variant',p_variant),timeout_milliseconds:=1000) into req;return req;end $$;
do $$declare f record;begin for f in select oid::regprocedure p from pg_proc where pronamespace='public'::regnamespace and
(proname like '%jls_sol_ready%' or proname in('jls_ready_operation_guard','authorize_jls_restaurant','authorize_jls_restaurant_pre_ready')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.p);execute format('grant execute on function %s to service_role',f.p);end loop;end $$;
