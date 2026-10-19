-- Scoped comparison adapter. Existing queues, reservations and RLS are reused.
-- No consent, execution, task, provider dispatch or historical update in this migration.
create function public.check_jls_direct4_comparison_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare a public.analysis_jls_snapshot_preparations;e jsonb;v jsonb;r jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id=(b->>'source_archive_id')::uuid;
 if not coalesce(a.id='16f110ba-78ad-4eab-8568-33d476dd4641'::uuid and a.sha256=b->>'source_archive_sha256'
 and a.sha256=public.jls_restaurant_hash(a.body) and b->>'version'='jls-direct4-synthesis-comparison-v1'
 and b->>'organization_id'=a.organization_id::text and b->>'establishment_id'=a.body->'report_preparation'->'body'->>'establishment_id'
 and b->>'source_protocol_id'=a.body->>'protocol_id' and b->>'source_run_id'=a.body->'run'->>'id'
 and b->>'source_dataset_sha256'=a.body->'jev_dataset'->>'sha256'
 and b->>'source_snapshot_sha256'=a.body->'report_preparation'->'body'->'source_snapshot'->>'sha256'
 and b->>'statistics_sha256'=a.body->'report_preparation'->'body'->>'statistics_sha256'
 and b->>'source_report_sha256'=public.jls_restaurant_hash(a.body->'sol_result')
 and b->'preparation'->'body'->'statistics'=a.body->'report_preparation'->'body'->'statistics'
 and b->'preparation'->>'sha256'=public.jls_restaurant_hash(b->'preparation'->'body')
 and b->>'preparation_sha256'=b->'preparation'->>'sha256'
 and b->'preparation'->'body'->'synthesis'->>'version'='jls-direct4-balanced-synthesis-v1.1'
 and b->>'reused_results_sha256'=public.jls_restaurant_hash(b->'reused_results')
 and b->>'pending_groups_sha256'=public.jls_restaurant_hash(b->'pending_groups')
 and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b->>'max_jev_calls'='0' and b->>'max_luna_calls'='4' and b->>'new_luna_questions'='6'
 and b->>'max_sol_calls'='1' and b->>'max_apify_calls'='0' and b->>'automatic_retry'='false'
 and b->>'production_enabled'='false' and b->>'language'='vi' and b->'pending'='[]'::jsonb
 and b->'spending_authorization'='null'::jsonb and b->'run_id'='null'::jsonb
 and b->'configuration'->'policy'->>'provider_client_retries'='0'
 and jsonb_array_length(b->'reused_evidence_ids')=26 and jsonb_array_length(b->'pending_groups')=4
 and (select count(distinct value->>'review_id') from jsonb_array_elements(b->'pending_groups'))=4
 and (select sum(jsonb_array_length(value->'evidence_ids')) from jsonb_array_elements(b->'pending_groups'))=6
 and jsonb_array_length(b->'preparation'->'body'->'selection'->'selected')=32
 and b->'sol_size_policy'->>'input_budget_tokens'='32768' and b->'sol_size_policy'->>'max_output_tokens'='9500'
 and exists(select 1 from public.organization_members m where m.organization_id=a.organization_id and m.user_id=(b->>'authority_user_id')::uuid and m.role in('owner','admin','manager'))
 and exists(select 1 from public.establishments x where x.id=(b->>'establishment_id')::uuid and x.organization_id=a.organization_id and x.active),false) then return false;end if;
 for v in select value from jsonb_array_elements(b->'reused_results') loop
 if not exists(select 1 from jsonb_array_elements(a.body->'luna_results') x where x=v)
 or exists(select 1 from jsonb_array_elements(v->'decisions') d where d->>'status'<>'ACCEPTED') then return false;end if;end loop;
 if (select sum(jsonb_array_length(value->'decisions')) from jsonb_array_elements(b->'reused_results'))<>26 then return false;end if;
 for e in select value from jsonb_array_elements(b->'preparation'->'body'->'selection'->'selected') loop
 select value into r from jsonb_array_elements(a.body->'source_snapshot'->'reviews') where value->>'id'=e->>'review_id';
 if r is null or e->>'quote'<>r->>'analysis_text' or e->>'context'<>r->>'analysis_text'
 or e->>'analysis_text_sha256'<>r->>'analysis_text_sha256' or e->>'quote_sha256'<>r->>'analysis_text_sha256'
 or not exists(select 1 from jsonb_array_elements(a.body->'report_preparation'->'body'->'selection'->'candidates') x where x->>'evidence_id'=e->>'evidence_id' and x->>'category'=e->>'category' and x->>'polarity'=e->>'polarity') then return false;end if;end loop;
 for v in select value from jsonb_array_elements(b->'pending_groups') loop
 if v->>'request_sha256'<>public.jls_restaurant_hash(v->'payload') or v->'payload'->>'model'<>'gpt-6-luna'
 or v->>'questions_sha256'<>public.jls_restaurant_hash(v->'payload'->'questions') then return false;end if;
 for e in select value from jsonb_array_elements(v->'evidence_ids') loop
 if not exists(select 1 from jsonb_array_elements(a.body->'report_preparation'->'body'->'selection'->'candidates') x where x->'evidence_id'=e and x->>'polarity'='negative')
 or exists(select 1 from jsonb_array_elements(a.body->'report_preparation'->'body'->'selection'->'selected') x where x->'evidence_id'=e)
 then return false;end if;end loop;end loop;
 for r in select value from jsonb_array_elements(b->'preparation'->'body'->'synthesis'->'originals') loop
 if not exists(select 1 from jsonb_array_elements(a.body->'source_snapshot'->'reviews') x where x->>'id'=r->>'review_id'
 and x->>'original_text'=r->>'original_text' and x->>'original_text_sha256'=r->>'original_text_sha256') then return false;end if;end loop;
 return true;
end $$;
create function public.save_jls_direct4_comparison(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_jls_direct4_comparison_sources(p_body) then raise exception 'DIRECT_COMPARISON_SOURCE_CHANGED';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;
end $$;
create function public.authorize_jls_direct4_comparison(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;rid uuid;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if not public.check_jls_direct4_comparison_sources(p.body) then raise exception 'DIRECT_COMPARISON_SOURCE_CHANGED';end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id;if rid is not null then return rid;end if;
 if position(p.id::text in coalesce(p_consent->>'user_directive',''))=0 then raise exception 'DIRECT_COMPARISON_NEW_GO_REQUIRED';end if;
 if (select count(*) from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind like 'direct4_comparison_deployed_%'
 and body->>'passed'='true' and body->>'provider_calls'='0' and body->>'protocol_sha256'=p.sha256)<>3 then raise exception 'DIRECT_COMPARISON_DEPLOYED_QUALIFICATION_REQUIRED';end if;
 rid=public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256)values
 (rid,p.organization_id,'direct4_report_preparation',p.body->'preparation',public.jls_restaurant_hash(p.body->'preparation')),
 (rid,p.organization_id,'evidence_plan',jsonb_build_object('luna_groups',p.body->'pending_groups'),public.jls_restaurant_hash(jsonb_build_object('luna_groups',p.body->'pending_groups')));
 for v in select value from jsonb_array_elements(p.body->'pending_groups') loop
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(rid,p.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,v->'payload',v->>'request_sha256');end loop;
 update public.analysis_jls_restaurant_runs set stage='luna' where id=rid;return rid;
end $$;
create function public.claim_jls_direct4_comparison_task(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() or r.stage not in('luna','sol') then return null;end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.check_jls_direct4_comparison_sources(p.body) then raise exception 'DIRECT_COMPARISON_SOURCE_CHANGED';end if;
 select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if t.request_sha256<>public.jls_restaurant_hash(t.request) then raise exception 'JLS_REQUEST_CHANGED';end if;
 if t.phase='luna' and not exists(select 1 from jsonb_array_elements(p.body->'pending_groups') g where g->>'review_id'=t.review_id::text and g->>'request_sha256'=t.request_sha256) then raise exception 'DIRECT_COMPARISON_LUNA_MANIFEST_CHANGED';end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=t.phase and request_count=1)>=(case t.phase when 'luna' then 4 else 1 end) then raise exception 'JLS_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now() where id=t.id returning * into t;return to_jsonb(t);
end $$;
create function public.stage_jls_direct4_comparison(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() or r.stage<>'luna' or p_stage<>'prepare_sol' or p_tasks<>'[]'::jsonb
 or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='luna' and status='completed' and request_count=1)<>4 then return false;end if;
 update public.analysis_jls_restaurant_runs set stage='prepare_sol' where id=r.id;return true;
end $$;
create function public.check_jls_direct4_comparison_ready(b jsonb) returns boolean language plpgsql stable set search_path='' set jit='off' as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;x jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(b->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(b->>'source_run_id')::uuid;
 if not coalesce(public.check_jls_direct4_comparison_sources(p.body) and r.protocol_id=p.id and r.organization_id=p.organization_id
 and p.sha256=b->>'source_protocol_sha256' and b->'preparation'=p.body->'preparation'
 and b->>'preparation_artifact_sha256'=public.jls_restaurant_hash(p.body->'preparation')
 and b->>'results_sha256'=public.jls_restaurant_hash(b->'results') and jsonb_array_length(b->'results')=30
 and exists(select 1 from public.analysis_jls_restaurant_artifacts a where a.run_id=r.id and a.kind='luna_decisions' and a.body->'results'=b->'results' and a.sha256=public.jls_restaurant_hash(a.body))
 and b->>'request_sha256'=public.jls_restaurant_hash((b->>'request_json')::jsonb)
 and b->>'request_raw_sha256'=encode(extensions.digest(b->>'request_json','sha256'),'hex')
 and (b->>'request_json')::jsonb->>'model'='gpt-6.1-sol' and b->'sol'->'gate'->>'passed'='true'
 and b->>'token_certificate_sha256'=public.jls_restaurant_hash(b->'token_certificate')
 and b->'measurement'->>'input_budget_tokens'='32768' and (b->'measurement'->>'guarded_input_tokens')::int between 1 and 32768
 and b->'measurement'->>'output_reserved_tokens'='9500' and jsonb_array_length(b->'source_tasks')=4,false) then return false;end if;
 for x in select value from jsonb_array_elements(p.body->'reused_results') loop
 if not exists(select 1 from jsonb_array_elements(b->'results') y where y=x) then return false;end if;end loop;
 for x in select value from jsonb_array_elements(b->'source_tasks') loop
 if not exists(select 1 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
 where t.id=(x->>'task_id')::uuid and t.run_id=r.id and t.phase='luna' and t.status='completed' and t.request_count=1
 and t.request_sha256=x->>'request_sha256' and a.sha256=x->>'artifact_sha256' and a.sha256=public.jls_restaurant_hash(a.body)
 and exists(select 1 from jsonb_array_elements(b->'results') z where z=a.body->'direct4_result')) then return false;end if;end loop;return true;
end $$;
do $adapt$ declare d text;expr text;cond text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check check (('||expr||') or (establishment_id=''6a53577a-c816-4548-845e-870995fbaed9''::uuid and body->>''version''=''jls-direct4-synthesis-comparison-v1''))';
 d=pg_get_functiondef('public.save_jls_restaurant_protocol(jsonb,text)'::regprocedure);
 execute regexp_replace(d,'begin','begin if p_body->>''version''=''jls-direct4-synthesis-comparison-v1'' then return public.save_jls_direct4_comparison(p_body,p_sha);end if;');
 d=pg_get_functiondef('public.authorize_jls_restaurant(uuid,jsonb,text)'::regprocedure);
 execute regexp_replace(d,'begin','begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=p_protocol and body->>''version''=''jls-direct4-synthesis-comparison-v1'') then return public.authorize_jls_direct4_comparison(p_protocol,p_consent,p_sha);end if;');
 cond='exists(select 1 from public.analysis_jls_restaurant_runs scope_run_cmp join public.analysis_jls_restaurant_protocols scope_protocol_cmp on scope_protocol_cmp.id=scope_run_cmp.protocol_id where scope_run_cmp.id=p_run and scope_protocol_cmp.body->>''version''=''jls-direct4-synthesis-comparison-v1'')';
 d=pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure);execute regexp_replace(d,'begin','begin if '||cond||' then return public.claim_jls_direct4_comparison_task(p_run,p_worker);end if;');
 d=pg_get_functiondef('public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure);execute regexp_replace(d,'begin','begin if '||cond||' then return public.stage_jls_direct4_comparison(p_run,p_worker,p_stage,p_tasks);end if;');
 d=pg_get_functiondef('public.check_jls_direct4_ready_sources(jsonb)'::regprocedure);execute regexp_replace(d,'begin','begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=(b->>''source_protocol_id'')::uuid and body->>''version''=''jls-direct4-synthesis-comparison-v1'') then return public.check_jls_direct4_comparison_ready(b);end if;');
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);execute replace(d,'''jls-direct4-historical-v1'')','''jls-direct4-historical-v1'',''jls-direct4-synthesis-comparison-v1'')');
 d=pg_get_functiondef('public.jls_restaurant_state_guard()'::regprocedure);execute replace(d,'''jls-direct4-historical-v1'')','''jls-direct4-historical-v1'',''jls-direct4-synthesis-comparison-v1'')');
end $adapt$;
do $$declare f record;begin for f in select oid::regprocedure p from pg_proc where pronamespace='public'::regnamespace and proname like '%jls_direct4_comparison%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.p);execute format('grant execute on function %s to service_role',f.p);end loop;end $$;
