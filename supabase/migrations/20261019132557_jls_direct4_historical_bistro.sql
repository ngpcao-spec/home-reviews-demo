-- Extend the existing direct-four workers to one pinned historical Bistro
-- snapshot. No new execution engine, consent, run, task or provider call.
create function public.check_jls_direct4_historical_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare h public.historical_report_runs;x jsonb;r jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into h from public.historical_report_runs where id=(b->'historical'->>'id')::uuid;
 if not coalesce(b->>'version'='jls-direct4-historical-v1' and h.id='fa55c8a5-f6e3-43df-a792-e9beed974457'::uuid
 and h.establishment_id='6a53577a-c816-4548-845e-870995fbaed9'::uuid and h.status='completed' and h.language='vi'
 and b->>'organization_id'=h.organization_id::text and b->>'establishment_id'=h.establishment_id::text
 and b->>'authority_user_id'=h.requested_by::text and b->>'language'='vi'
 and b->'historical'->>'record_sha256'='0d34685f8bba042afa53f7aab095516f21e17da27ea8390dacca7bbaf0eba46c'
 and public.jls_restaurant_hash(to_jsonb(h))=b->'historical'->>'record_sha256'
 and b->'frozen_historical'=to_jsonb(h)
 and b->'historical'->>'source_fingerprint'=h.snapshot->'base'->>'source_fingerprint'
 and b->'historical'->>'snapshot_sha256'=public.jls_restaurant_hash(h.snapshot)
 and b->'historical'->>'published_report_sha256'=public.jls_restaurant_hash(b->'frozen_published_report')
 and b->'frozen_published_report'->>'generation_id'=h.generation_id::text
 and b->>'source_snapshot_sha256'=public.jls_restaurant_hash(b->'source_snapshot')
 and b->'source_snapshot'->>'source_reviews_sha256'=public.jls_restaurant_hash(b->'source_snapshot'->'reviews')
 and jsonb_array_length(b->'source_snapshot'->'reviews')=100
 and b->'denominators'='{"source_reviews":100,"analytical_reviews":68,"textless_statistics_only":32}'::jsonb
 and b->>'max_jev_calls'='68' and b->>'max_luna_calls'='32' and b->>'max_sol_calls'='1' and b->>'max_apify_calls'='0'
 and b->>'automatic_retry'='false' and b->>'production_enabled'='false' and b->'spending_authorization'='null'::jsonb
 and b->'run_id'='null'::jsonb and b->>'preparation_is_not_spending_authorization'='true'
 and b->>'classification_configuration_sha256'='e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69'
 and b->>'classification_configuration_sha256'=public.jls_restaurant_hash(b->'configuration'->'jev')
 and b->'configuration'->'jev_request_template'->'questions'=b->'configuration'->'jev'->'questions'
 and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b->>'pending_sha256'=public.jls_restaurant_hash(b->'pending') and jsonb_array_length(b->'pending')=68
 and (select count(distinct value->>'review_id') from jsonb_array_elements(b->'pending'))=68
 and b->'cache'='[]'::jsonb and b->>'cache_sha256'=public.jls_restaurant_hash('[]'::jsonb)
 and b->'sol_size_policy'->>'input_budget_tokens'='32768' and b->'sol_size_policy'->>'max_output_tokens'='9500'
 and exists(select 1 from public.establishments e where e.id=h.establishment_id and e.organization_id=h.organization_id and e.active)
 and exists(select 1 from public.organization_members m where m.organization_id=h.organization_id and m.user_id=h.requested_by and m.role in('owner','admin','manager')),false) then return false;end if;
 for x in select value from jsonb_array_elements(b->'source_snapshot'->'reviews') loop
 select value into r from jsonb_array_elements(h.snapshot->'reviews') where value->>'id'=x->>'id';
 if r is null or x->>'original_text' is distinct from coalesce(r->>'original_text','')
 or x->>'analysis_text' is distinct from nullif(r->>'analysis_text','') or x->'rating' is distinct from r->'rating'
 or x->>'organization_id'<>h.organization_id::text or x->>'establishment_id'<>h.establishment_id::text
 or x->>'original_text_sha256'<>encode(extensions.digest(x->>'original_text','sha256'),'hex')
 or x->>'analysis_text' is not null and x->>'analysis_text_sha256'<>encode(extensions.digest(x->>'analysis_text','sha256'),'hex')
 then return false;end if;end loop;
 for x in select value from jsonb_array_elements(b->'pending') loop
 select value into r from jsonb_array_elements(b->'source_snapshot'->'reviews') where value->>'id'=x->>'review_id';
 if r is null or r->>'analysis_text' is null or x->'payload'->'state'->>'analysis_text' is distinct from r->>'analysis_text'
 or x->'payload'->>'model'<>'jev-latest' or x->'payload'->'questions'<>b->'configuration'->'jev'->'questions'
 or x->>'request_sha256'<>public.jls_restaurant_hash(x->'payload')
 or x->'identity'->>'configuration_sha256'<>b->>'classification_configuration_sha256'
 or x->'identity'->>'analysis_text_sha256'<>r->>'analysis_text_sha256' then return false;end if;end loop;return true;
end $$;
create function public.save_jls_direct4_historical_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_jls_direct4_historical_sources(p_body) then raise exception 'DIRECT4_HISTORICAL_PROTOCOL_INVALID';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;
end $$;
create function public.authorize_jls_direct4_historical(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if not public.check_jls_direct4_historical_sources(p.body) then raise exception 'DIRECT4_HISTORICAL_SOURCE_CHANGED';end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id;if rid is not null then return rid;end if;
 if (select count(distinct body->>'phase') from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind like 'historical_direct4_deployed_%'
 and body->>'protocol_sha256'=p.sha256 and body->>'provider_calls'='0' and body->'result'->>'passed'='true'
 and body->>'phase' in('jev','luna','sol','validate_sol'))<>4 then raise exception 'DIRECT4_HISTORICAL_DEPLOYED_QUALIFICATION_REQUIRED';end if;
 if position(p.id::text in coalesce(p_consent->>'user_directive',''))=0 then raise exception 'DIRECT4_HISTORICAL_GO_SCOPE_CHANGED';end if;
 return public.authorize_jls_restaurant_pre_ready(p_protocol,p_consent,p_sha);
end $$;
create function public.claim_jls_direct4_historical_task(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() then return null;end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.check_jls_direct4_historical_sources(p.body) then raise exception 'DIRECT4_HISTORICAL_SOURCE_CHANGED';end if;
 select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if t.request_sha256<>public.jls_restaurant_hash(t.request) then raise exception 'JLS_REQUEST_CHANGED';end if;
 if t.phase='jev' and not exists(select 1 from jsonb_array_elements(p.body->'pending') x where x->>'review_id'=t.review_id::text and x->>'request_sha256'=t.request_sha256 and x->'identity'=t.identity)
 then raise exception 'DIRECT4_HISTORICAL_JEV_MANIFEST_CHANGED';end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=t.phase and request_count=1)>=(case t.phase when 'jev' then 68 when 'luna' then 32 else 1 end) then raise exception 'JLS_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now() where id=t.id returning * into t;
 return to_jsonb(t);
end $$;
create function public.stage_jls_direct4_historical(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;expected int;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() or p_tasks<>'[]'::jsonb
 or not(r.stage='jev' and p_stage='prepare_evidence' or r.stage='luna' and p_stage='prepare_sol') then return false;end if;
 expected=case when r.stage='jev' then 68 else (select jsonb_array_length(body->'body'->'luna_groups') from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='direct4_report_preparation') end;
 if expected is null or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='completed' and request_count=1)<>expected then return false;end if;
 update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;
end $$;
create function public.bind_jls_direct4_historical_evidence(p_run uuid,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;v jsonb;prep jsonb=p_body->'preparation';rowdata jsonb;expected text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.jls_restaurant_valid(r.id) or not public.check_jls_direct4_historical_sources(p.body) or r.lease_until>now()
 or r.stage<>'prepare_evidence' or p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'protocol_sha256'<>p.sha256
 or p_body->'dataset'->>'sha256'<>public.jls_restaurant_hash(p_body->'dataset'->'body')
 or prep->>'sha256'<>public.jls_restaurant_hash(prep->'body')
 or prep->'body'->'source_archive'->>'sha256'<>p_body->'dataset'->>'sha256'
 or prep->'body'->'source_snapshot'->>'sha256'<>p.body->>'source_snapshot_sha256'
 or prep->'body'->'statistics'->'scope'<>'{"source_reviews":100,"analysed_text_reviews":68,"textless_statistics_only":32}'::jsonb
 or prep->'body'->'statistics'->'counts'<>p_body->'dataset'->'body'->'counts'
 or jsonb_array_length(p_body->'dataset'->'body'->'reviews')<>68
 or jsonb_array_length(p_body->'jev_source_tasks')<>68
 or jsonb_array_length(prep->'body'->'selection'->'selected') not between 1 and 32
 or jsonb_array_length(prep->'body'->'luna_groups') not between 1 and 32 then return false;end if;
 for v in select value from jsonb_array_elements(p_body->'jev_source_tasks') loop
 if not exists(select 1 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
 where t.id=(v->>'task_id')::uuid and t.run_id=r.id and t.phase='jev' and t.status='completed' and t.request_count=1
 and t.request_sha256=v->>'request_sha256' and a.sha256=v->>'artifact_sha256' and a.sha256=public.jls_restaurant_hash(a.body)
 and exists(select 1 from jsonb_array_elements(p_body->'dataset'->'body'->'reviews') d where d->>'review_id'=t.review_id::text
 and d->'result'=a.body->'direct4_result' and d->>'raw_response_text'=a.body->>'raw_response_text')) then return false;end if;end loop;
 for v in select value from jsonb_array_elements(prep->'body'->'selection'->'selected') loop
 select value into rowdata from jsonb_array_elements(p.body->'source_snapshot'->'reviews') where value->>'id'=v->>'review_id';
 if rowdata is null or v->>'quote'<>rowdata->>'analysis_text' or v->>'context'<>rowdata->>'analysis_text'
 or v->>'analysis_text_sha256'<>rowdata->>'analysis_text_sha256' or v->>'quote_sha256'<>rowdata->>'analysis_text_sha256'
 or v->>'category' not in('service','price','quality','ambiance') or v->>'polarity' not in('positive','negative') then return false;end if;end loop;
 if exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='luna') then return false;end if;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values
 (r.id,r.organization_id,'direct4_evidence_bundle',p_body,p_sha),
 (r.id,r.organization_id,'direct4_report_preparation',prep,public.jls_restaurant_hash(prep)),
 (r.id,r.organization_id,'evidence_plan',jsonb_build_object('luna_groups',prep->'body'->'luna_groups'),public.jls_restaurant_hash(jsonb_build_object('luna_groups',prep->'body'->'luna_groups')));
 for v in select value from jsonb_array_elements(prep->'body'->'luna_groups') loop
 if v->>'request_sha256'<>public.jls_restaurant_hash(v->'payload') or v->'payload'->>'model'<>'gpt-6-luna' then raise exception 'JLS_LUNA_MANIFEST_CHANGED';end if;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(r.id,r.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,v->'payload',v->>'request_sha256');end loop;
 update public.analysis_jls_restaurant_runs set stage='luna' where id=r.id;return true;
end $$;
create function public.check_jls_direct4_historical_ready(b jsonb) returns boolean language plpgsql stable set search_path='' set jit='off' as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;a public.analysis_jls_restaurant_artifacts;d public.analysis_jls_restaurant_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(b->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(b->>'source_run_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='direct4_report_preparation';
 select * into d from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='luna_decisions';
 return coalesce(public.check_jls_direct4_historical_sources(p.body) and r.protocol_id=p.id and r.organization_id=p.organization_id
 and p.sha256=b->>'source_protocol_sha256' and a.body=b->'preparation' and a.sha256=b->>'preparation_artifact_sha256'
 and a.sha256=public.jls_restaurant_hash(a.body) and d.sha256=public.jls_restaurant_hash(d.body) and d.body->'results'=b->'results'
 and b->>'results_sha256'=public.jls_restaurant_hash(b->'results')
 and jsonb_array_length(b->'source_tasks')=jsonb_array_length(a.body->'body'->'luna_groups')
 and jsonb_array_length(b->'source_tasks') between 1 and 32
 and not exists(select 1 from jsonb_array_elements(b->'source_tasks') x left join public.analysis_jls_restaurant_tasks t on t.id=(x->>'task_id')::uuid
 left join public.analysis_jls_restaurant_artifacts z on z.run_id=r.id and z.kind='task:'||t.id where t.id is null or t.run_id<>r.id or t.phase<>'luna'
 or t.status<>'completed' or t.request_count<>1 or t.request_sha256<>x->>'request_sha256' or z.sha256 is distinct from x->>'artifact_sha256'
 or z.sha256<>public.jls_restaurant_hash(z.body))
 and b->'sol'->'gate'->>'passed'='true' and b->>'request_sha256'=public.jls_restaurant_hash((b->>'request_json')::jsonb)
 and b->>'request_raw_sha256'=encode(extensions.digest(b->>'request_json','sha256'),'hex')
 and (b->>'request_json')::jsonb->>'model'='gpt-6.1-sol'
 and b->>'token_certificate_sha256'=public.jls_restaurant_hash(b->'token_certificate')
 and b->'measurement'->>'input_budget_tokens'='32768' and (b->'measurement'->>'guarded_input_tokens')::int between 1 and 32768
 and b->'measurement'->>'output_reserved_tokens'='9500',false);
end $$;
-- Add scoped opt-in branches. Existing functions and historical callers retain
-- their original bodies after these version checks.
do $adapt$ declare d text;condition text;expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check check (('||expr||') or (establishment_id=''6a53577a-c816-4548-845e-870995fbaed9''::uuid and body->>''version''=''jls-direct4-historical-v1'' and body->''historical''->>''id''=''fa55c8a5-f6e3-43df-a792-e9beed974457''))';
 d=pg_get_functiondef('public.save_jls_restaurant_protocol(jsonb,text)'::regprocedure);
 execute regexp_replace(d,'begin','begin if p_body->>''version''=''jls-direct4-historical-v1'' then return public.save_jls_direct4_historical_protocol(p_body,p_sha);end if;');
 d=pg_get_functiondef('public.authorize_jls_restaurant(uuid,jsonb,text)'::regprocedure);
 execute regexp_replace(d,'begin','begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=p_protocol and body->>''version''=''jls-direct4-historical-v1'') then return public.authorize_jls_direct4_historical(p_protocol,p_consent,p_sha);end if;');
 condition='exists(select 1 from public.analysis_jls_restaurant_runs rr join public.analysis_jls_restaurant_protocols pp on pp.id=rr.protocol_id where rr.id=p_run and pp.body->>''version''=''jls-direct4-historical-v1'')';
 d=pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure);
 execute regexp_replace(d,'begin','begin if '||condition||' then return public.claim_jls_direct4_historical_task(p_run,p_worker);end if;');
 d=pg_get_functiondef('public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure);
 execute regexp_replace(d,'begin','begin if '||condition||' then return public.stage_jls_direct4_historical(p_run,p_worker,p_stage,p_tasks);end if;');
 d=pg_get_functiondef('public.check_jls_direct4_ready_sources(jsonb)'::regprocedure);
 execute regexp_replace(d,'begin','begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=(b->>''source_protocol_id'')::uuid and body->>''version''=''jls-direct4-historical-v1'') then return public.check_jls_direct4_historical_ready(b);end if;');
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 execute replace(d,'p.body->>''version''<>''jls-historical-snapshot-v2-vi-v1''','p.body->>''version'' not in(''jls-historical-snapshot-v2-vi-v1'',''jls-direct4-historical-v1'')');
 d=pg_get_functiondef('public.jls_restaurant_state_guard()'::regprocedure);
 execute replace(d,'''jls-historical-snapshot-v2-vi-v1'')','''jls-historical-snapshot-v2-vi-v1'',''jls-direct4-historical-v1'')');
end $adapt$;
revoke all on function public.check_jls_direct4_historical_sources(jsonb),public.save_jls_direct4_historical_protocol(jsonb,text),
 public.authorize_jls_direct4_historical(uuid,jsonb,text),public.claim_jls_direct4_historical_task(uuid,text),public.stage_jls_direct4_historical(uuid,text,text,jsonb),
 public.bind_jls_direct4_historical_evidence(uuid,jsonb,text),public.check_jls_direct4_historical_ready(jsonb) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_historical_sources(jsonb),public.save_jls_direct4_historical_protocol(jsonb,text),
 public.authorize_jls_direct4_historical(uuid,jsonb,text),public.claim_jls_direct4_historical_task(uuid,text),public.stage_jls_direct4_historical(uuid,text,text,jsonb),
 public.bind_jls_direct4_historical_evidence(uuid,jsonb,text),public.check_jls_direct4_historical_ready(jsonb) to service_role;
