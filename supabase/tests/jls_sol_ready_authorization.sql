-- Execute after genuine Edge qualification, inside BEGIN/ROLLBACK only.
-- All consent/attempt/result fixtures below are synthetic and never committed.
do $$declare c jsonb=current_setting('jls.sol_ready_fixture')::jsonb;p uuid;rid uuid;again uuid;op uuid;task uuid;g jsonb;o jsonb;receipt jsonb;result jsonb;bad jsonb;begin
 p=public.save_jls_sol_ready_protocol(c->'protocol'->'body',c->'protocol'->>'sha256');
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=p) then raise exception 'TEST_EXISTING_RUN_NOT_SAFE';end if;
 g=jsonb_build_object('protocol_sha256',c->'protocol'->>'sha256','consent_source','user_directive_codex_delegation',
 'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),'user_directive','EXPLICIT SYNTHETIC ROLLBACK TEST ONLY NO NETWORK',
 'directive_sha256',encode(extensions.digest('EXPLICIT SYNTHETIC ROLLBACK TEST ONLY NO NETWORK','sha256'),'hex'),
 'requested_at',now(),'expires_at',now()+interval '1 hour','scope',jsonb_build_object(
 'establishment_id',c->'protocol'->'body'->>'establishment_id','organization_id',c->'protocol'->'body'->>'organization_id',
 'language','vi','configuration_sha256',c->'protocol'->'body'->>'configuration_sha256','max_jev_calls',0,'max_luna_calls',0,'max_sol_calls',1,
 'automatic_retry',false,'provider_client_retries',0,'apify_calls',0));
 for bad in select value from jsonb_array_elements(jsonb_build_array(g||'{"consent_source":"no_GO"}',
 g||jsonb_build_object('expires_at',now()-interval '1 hour'),jsonb_set(g,'{scope,max_luna_calls}','1'))) loop
 begin perform public.authorize_jls_restaurant(p,bad,public.jls_restaurant_hash(bad));raise exception 'TEST_INVALID_GO_ACCEPTED';exception when others then if sqlerrm='TEST_INVALID_GO_ACCEPTED' then raise;end if;end;
 end loop;
 rid=public.authorize_jls_restaurant(p,g,public.jls_restaurant_hash(g));
 again=public.authorize_jls_restaurant(p,g,public.jls_restaurant_hash(g));
 if again<>rid or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid)<>1
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=rid and phase<>'sol') then raise exception 'TEST_ONLY_ONE_SOL';end if;
 select id,task_id into op,task from public.analysis_jls_sol_ready_operations where run_id=rid and mode='paid';
 o=public.claim_jls_sol_ready(op,'sql_mock_dispatch');
 if o->>'request_count'<>'1' or public.claim_jls_sol_ready(op,'sql_mock_concurrent') is not null then raise exception 'TEST_PAID_RESERVATION';end if;
 receipt=jsonb_build_object('version','jls-sol-raw-receipt-v1','request_sha256',c->'artifact'->'body'->>'request_sha256',
 'request_raw_sha256',c->'artifact'->'body'->>'request_raw_sha256','mock',false,'http_status',200,
 'raw_response_text','EXPLICIT SQL MOCK NO PROVIDER','raw_response_sha256',encode(extensions.digest('EXPLICIT SQL MOCK NO PROVIDER','sha256'),'hex'));
 if not public.receive_jls_sol_ready(op,'sql_mock_dispatch',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_PAID_RECEIPT';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_tasks where id=task and status='received' and request_count=1)
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=rid and kind='sol_receipt') then raise exception 'TEST_RAW_NOT_DURABLE';end if;
 o=public.claim_jls_sol_ready(op,'sql_mock_validate');
 if o->>'phase'<>'validate_sol' or o->>'request_count'<>'1' then raise exception 'TEST_FREE_VALIDATION_RESERVE';end if;
 result=jsonb_build_object('receipt_sha256',public.jls_restaurant_hash(receipt),'raw_response_sha256',receipt->>'raw_response_sha256','explicit_sql_mock',true);
 if not public.finish_jls_sol_ready(op,'sql_mock_validate','completed',result,public.jls_restaurant_hash(result)) then raise exception 'TEST_PAID_FINAL_SAVE';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_runs where id=rid and status='completed')
 or not exists(select 1 from public.analysis_jls_restaurant_tasks where id=task and status='completed' and request_count=1)
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=rid and kind='task:'||task)
 or public.claim_jls_sol_ready(op,'sql_mock_again') is not null then raise exception 'TEST_PAID_REDISPATCH';end if;
end $$;
select 'Production SQL path with synthetic rollback only: scoped/expired/absent GO; single Sol reservation; raw receipt; received-to-final guard; immutable result; no redispatch: PASS' checks;
