begin;
set local role service_role;
do $$declare q public.analysis_jls_sql_qualifications;o public.analysis_jls_sol_ready_operations;begin
 select * into q from public.analysis_jls_sql_qualifications where nonce='foursea_sql_v1_20261020';
 select * into o from public.analysis_jls_sol_ready_operations where run_id=q.run_id;
 if q.id is null or o.status<>'completed' or o.mode<>'mock' or o.request_count<>1 or o.result#>>'{validated_report,technical_checks_passed}'<>'true' then raise exception 'SQL_FULL_PATH_NOT_COMPLETE';end if;
 if public.claim_jls_sol_ready(o.id,'EXPLICIT_REPEAT') is not null then raise exception 'SECOND_SOL_CLAIM';end if;
 if not public.receive_jls_sol_ready(o.id,'EXPLICIT_REPEAT',o.receipt,o.receipt_sha256) or not public.finish_jls_sol_ready(o.id,'EXPLICIT_REPEAT',o.status,o.result,o.result_sha256) then raise exception 'RECEIPT_RESULT_NOT_IDEMPOTENT';end if;
 if public.finish_jls_sol_ready(o.id,'EXPLICIT_REPEAT',o.status,o.result,repeat('0',64)) then raise exception 'CHANGED_RESULT_ACCEPTED';end if;
 if public.wake_jls_restaurant(q.run_id) is not null then raise exception 'MOCK_WAKE_ACCEPTED';end if;
 perform set_config('jls.sql.mock_run',q.run_id::text,true);
 perform set_config('jls.sql.owner',(select authority_user_id::text from public.analysis_jls_restaurant_protocols where id=q.protocol_id),true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('jls.sql.owner'),true);
do $$begin
 if exists(select 1 from public.analysis_jls_restaurant_runs where id=current_setting('jls.sql.mock_run')::uuid) or
 exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=current_setting('jls.sql.mock_run')::uuid) or
 exists(select 1 from public.analysis_jls_sol_ready_operations where run_id=current_setting('jls.sql.mock_run')::uuid) then raise exception 'MOCK_LEAKED_INTO_OWNER_HISTORY';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_runs where id='ad64447b-cc9e-4f22-852b-63f43a1564f0') then raise exception 'REAL_HISTORY_HIDDEN';end if;
 if has_function_privilege('authenticated','public.start_jls_sql_qualification(uuid,text)','execute') or
 has_function_privilege('authenticated','public.begin_jls_restaurant_dispatch(uuid,text,text)','execute') or
 has_function_privilege('authenticated','public.certify_jls_direct4_sources(uuid)','execute') then raise exception 'SERVER_WRITE_EXPOSED';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$begin
 if exists(select 1 from public.analysis_jls_source_certificates) or exists(select 1 from public.analysis_jls_task_dispatch_intents) then raise exception 'CROSS_ORG_READ';end if;
end $$;
select 'passed' sql_rls_idempotence,0 provider_calls;
rollback;
