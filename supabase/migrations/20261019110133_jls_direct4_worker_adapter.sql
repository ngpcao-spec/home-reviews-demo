-- Versioned adapters only. Reuse existing protocols/runs/tasks/artifacts, leases,
-- receipt reservation and RLS. No table, consent, run, task or wake is created here.
create or replace function public.check_jls_direct4_sources(p_body jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare a public.analysis_jls_snapshot_preparations;s public.analysis_jls_snapshot_preparations;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id='bace8577-e302-42fe-8625-ff9951c1c788';
 select * into s from public.analysis_jls_snapshot_preparations where id='087f0b5b-716b-4b94-8a1d-ee2040e22f99';
 return coalesce(p_body->>'version'='jls-direct4-execution-v1'
 and p_body->>'preparation_id'=a.id::text and p_body->>'preparation_sha256'=a.sha256
 and a.sha256='4752a9a1e214633052a1138faa3b6ef45e487a8cbc040048c6ceaea3c6e0a813'
 and s.sha256='d65660a32ffb736637a0d594e6fa3a6413c017ac8a4eb27fdd5021a14ad662e9'
 and a.sha256=public.jls_restaurant_hash(a.body) and s.sha256=public.jls_restaurant_hash(s.body)
 and a.body->'source_archive'->>'sha256'=s.sha256 and a.organization_id::text=p_body->>'organization_id'
 and p_body->>'establishment_id'=a.body->>'establishment_id'
 and p_body->>'language'='vi' and p_body->>'max_jev_calls'='0' and p_body->>'max_luna_calls'='32' and p_body->>'max_sol_calls'='1'
 and p_body->'pending'='[]'::jsonb and p_body->>'production_enabled'='false'
 and p_body->'configuration'->'policy'->>'automatic_retry'='false'
 and p_body->'configuration'->'policy'->>'provider_client_retries'='0'
 and p_body->'configuration'->>'preparation_configuration_sha256'=a.body->>'configuration_sha256'
 and p_body->>'configuration_sha256'=public.jls_restaurant_hash(p_body->'configuration')
 and p_body->'sol_size_policy'->>'version'='jls-sol-envelope-32k-v1'
 and exists(select 1 from public.analysis_jls_restaurant_protocols old where old.id=a.protocol_id
 and old.authority_user_id::text=p_body->>'authority_user_id' and old.organization_id=a.organization_id)
 and exists(select 1 from public.organization_members m where m.organization_id=a.organization_id
 and m.user_id::text=p_body->>'authority_user_id' and m.role in('owner','admin','manager')),false);
end $$;
create or replace function public.save_jls_direct4_protocol(p_body jsonb,p_sha text) returns uuid
language plpgsql set search_path='' as $$ declare rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_jls_direct4_sources(p_body)
 then raise exception 'DIRECT4_PROTOCOL_INVALID';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;end $$;

create or replace function public.authorize_jls_direct4(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid
language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;a public.analysis_jls_snapshot_preparations;rid uuid;g jsonb;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p.id is null or not public.check_jls_direct4_sources(p.body) then raise exception 'DIRECT4_SOURCE_CHANGED';end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id;if rid is not null then return rid;end if;
 if not exists(select 1 from public.analysis_jls_snapshot_preparations q where q.kind='direct4_worker_deployed_qualification_v1'
 and q.body->>'protocol_sha256'=p.sha256 and q.body->>'passed'='true' and q.body->>'provider_calls'='0'
 and q.body->>'worker_version'='jls-direct4-worker-v1') then raise exception 'DIRECT4_DEPLOYED_QUALIFICATION_REQUIRED';end if;
 if p_consent->>'preparation_id' is distinct from 'bace8577-e302-42fe-8625-ff9951c1c788'
 or p_consent->>'preparation_sha256' is distinct from p.body->>'preparation_sha256'
 or position('bace8577-e302-42fe-8625-ff9951c1c788' in coalesce(p_consent->>'user_directive',''))=0
 then raise exception 'DIRECT4_GO_SCOPE_CHANGED';end if;
 -- Existing delegated authorization checks role, membership, exact scope, hashes,
 -- fresh recording timestamp and a maximum 24h operational expiry.
 rid=public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);
 select * into a from public.analysis_jls_snapshot_preparations where id='bace8577-e302-42fe-8625-ff9951c1c788';
 v=jsonb_build_object('luna_groups',a.body->'luna_groups','question_count',32,'source_sha256',a.body->'source_snapshot'->>'sha256');
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256)
 values(rid,p.organization_id,'evidence_plan',v,public.jls_restaurant_hash(v));
 for g in select value from jsonb_array_elements(a.body->'luna_groups') loop
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(rid,p.organization_id,'luna',g->>'review_id',(g->>'review_id')::uuid,g->'payload',g->>'request_sha256');end loop;
 update public.analysis_jls_restaurant_runs set stage='luna' where id=rid;return rid;end $$;

create or replace function public.stage_jls_direct4(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean
language plpgsql set search_path='' as $$ declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.jls_restaurant_valid(r.id) or not public.check_jls_direct4_sources(p.body)
 or r.worker is distinct from p_worker or r.lease_until<=now() or r.stage<>'luna' or p_stage<>'prepare_sol'
 or p_tasks<>'[]'::jsonb or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='luna' and status='completed' and request_count=1)<>32
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts a where a.run_id=r.id and a.kind='luna_decisions'
 and a.sha256=public.jls_restaurant_hash(a.body) and jsonb_array_length(a.body->'results')=32)
 then return false;end if;
 update public.analysis_jls_restaurant_runs set stage='prepare_sol' where id=r.id;return true;end $$;

create or replace function public.check_jls_direct4_ready_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;a public.analysis_jls_restaurant_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(b->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(b->>'source_run_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='luna_decisions';
 return coalesce(public.check_jls_direct4_sources(p.body) and p.sha256=b->>'source_protocol_sha256' and r.protocol_id=p.id
 and r.organization_id=p.organization_id and b->'preparation'->>'sha256'=p.body->>'preparation_sha256'
 and b->'preparation'->>'sha256'=public.jls_restaurant_hash(b->'preparation'->'body')
 and a.sha256=public.jls_restaurant_hash(a.body) and a.body->'results'=b->'results'
 and b->>'results_sha256'=public.jls_restaurant_hash(b->'results') and jsonb_array_length(b->'source_tasks')=32
 and not exists(select 1 from jsonb_array_elements(b->'source_tasks') x
 left join public.analysis_jls_restaurant_tasks t on t.id=(x->>'task_id')::uuid
 left join public.analysis_jls_restaurant_artifacts z on z.run_id=r.id and z.kind='task:'||t.id
 where t.id is null or t.run_id<>r.id or t.status<>'completed' or t.request_count<>1 or t.phase<>'luna'
 or t.request_sha256 is distinct from x->>'request_sha256' or z.sha256 is distinct from x->>'artifact_sha256'
 or z.sha256<>public.jls_restaurant_hash(z.body))
 and b->'sol'->'gate'->>'passed'='true' and b->>'request_sha256'=public.jls_restaurant_hash((b->>'request_json')::jsonb)
 and b->>'request_raw_sha256'=encode(extensions.digest(b->>'request_json','sha256'),'hex')
 and b->>'token_certificate_sha256'=public.jls_restaurant_hash(b->'token_certificate')
 and b->'measurement'->>'input_budget_tokens'='32768' and (b->'measurement'->>'guarded_input_tokens')::int between 1 and 32768
 and b->'measurement'->>'output_reserved_tokens'='9500',false);end $$;

create or replace function public.save_jls_direct4_ready(p_body jsonb,p_sha text) returns uuid
language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;a uuid;t uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid for update;
 if p_sha<>public.jls_restaurant_hash(p_body) or not public.check_jls_direct4_ready_sources(p_body)
 or not public.jls_restaurant_valid(r.id) then raise exception 'DIRECT4_READY_SOURCE_CHANGED';end if;
 select id into a from public.analysis_jls_sol_ready_artifacts where sha256=p_sha;
 if a is not null then return a;end if;
 if r.stage<>'prepare_sol' or r.lease_until>now() or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='sol')
 then raise exception 'DIRECT4_SOL_ALREADY_RESERVED';end if;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256)
 values(r.organization_id,r.protocol_id,r.id,p_body,p_sha) returning id into a;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256)
 values(r.id,r.organization_id,'sol','sol',(p_body->>'request_json')::jsonb,p_body->>'request_sha256') returning id into t;
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_id,protocol_sha256,run_id,task_id)
 values(r.organization_id,a,'paid',r.protocol_id,p_body->>'source_protocol_sha256',r.id,t);
 update public.analysis_jls_restaurant_runs set stage='sol' where id=r.id;return a;end $$;

-- Insert opt-in dispatch branches in existing APIs. Original bodies, grants and
-- other protocol paths remain intact. The guards make reapplication idempotent.
do $adapt$ declare d text;begin
 d=pg_get_functiondef('public.save_jls_restaurant_protocol(jsonb,text)'::regprocedure);
 if position('save_jls_direct4_protocol' in d)=0 then execute regexp_replace(d,'begin',
 'begin if p_body->>''version''=''jls-direct4-execution-v1'' then return public.save_jls_direct4_protocol(p_body,p_sha);end if;');end if;
 d=pg_get_functiondef('public.authorize_jls_restaurant(uuid,jsonb,text)'::regprocedure);
 if position('authorize_jls_direct4' in d)=0 then execute regexp_replace(d,'begin',
 'begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=p_protocol and body->>''version''=''jls-direct4-execution-v1'') then return public.authorize_jls_direct4(p_protocol,p_consent,p_sha);end if;');end if;
 d=pg_get_functiondef('public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure);
 if position('stage_jls_direct4' in d)=0 then execute regexp_replace(d,'begin',
 'begin if exists(select 1 from public.analysis_jls_restaurant_runs rr join public.analysis_jls_restaurant_protocols pp on pp.id=rr.protocol_id where rr.id=p_run and pp.body->>''version''=''jls-direct4-execution-v1'') then return public.stage_jls_direct4(p_run,p_worker,p_stage,p_tasks);end if;');end if;
 d=pg_get_functiondef('public.check_jls_sol_ready_sources(jsonb)'::regprocedure);
 if position('check_jls_direct4_ready_sources' in d)=0 then execute regexp_replace(d,'begin',
 'begin if p_body->>''version''=''jls-direct4-sol-ready-v1'' then return public.check_jls_direct4_ready_sources(p_body);end if;');end if;
 d=pg_get_functiondef('public.save_jls_sol_ready_artifact(jsonb,text)'::regprocedure);
 if position('save_jls_direct4_ready' in d)=0 then execute regexp_replace(d,'begin',
 'begin if p_body->>''version''=''jls-direct4-sol-ready-v1'' then return public.save_jls_direct4_ready(p_body,p_sha);end if;');end if;
end $adapt$;
revoke all on function public.check_jls_direct4_sources(jsonb),public.save_jls_direct4_protocol(jsonb,text),
 public.authorize_jls_direct4(uuid,jsonb,text),public.stage_jls_direct4(uuid,text,text,jsonb),public.check_jls_direct4_ready_sources(jsonb),public.save_jls_direct4_ready(jsonb,text) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_sources(jsonb),public.save_jls_direct4_protocol(jsonb,text),
 public.authorize_jls_direct4(uuid,jsonb,text),public.stage_jls_direct4(uuid,text,text,jsonb),public.check_jls_direct4_ready_sources(jsonb),public.save_jls_direct4_ready(jsonb,text) to service_role;
