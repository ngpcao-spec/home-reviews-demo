-- Run inside BEGIN / ROLLBACK with jls.sol_ready_fixture set to the real
-- frozen compilation. Never wake a worker or create an execution consent.
do $$declare c jsonb=current_setting('jls.sol_ready_fixture')::jsonb;a uuid;op uuid;again uuid;o jsonb;r jsonb;result jsonb;begin
 a=public.save_jls_sol_ready_artifact(c->'artifact'->'body',c->'artifact'->>'sha256');
 if not public.check_jls_sol_ready_sources(c->'artifact'->'body') then raise exception 'TEST_SOURCES_CHANGED';end if;
 op=public.create_jls_sol_ready_probe(c->'protocol'->'body',c->'protocol'->>'sha256','SQL_ROLLBACK_READY_MOCK');
 again=public.create_jls_sol_ready_probe(c->'protocol'->'body',c->'protocol'->>'sha256','SQL_ROLLBACK_READY_MOCK');
 if op<>again then raise exception 'TEST_DUPLICATE_PROBE';end if;
 if exists(select 1 from public.analysis_jls_sol_ready_operations where id=op and (mode<>'mock' or run_id is not null)) then raise exception 'TEST_PAID_RUN';end if;
 o=public.claim_jls_sol_ready(op,'mock_worker_a');
 if o->>'request_count'<>'1' or public.claim_jls_sol_ready(op,'mock_worker_b') is not null then raise exception 'TEST_CONCURRENT_RESERVATION';end if;
 r=jsonb_build_object('version','jls-sol-raw-receipt-v1','request_sha256',c->'artifact'->'body'->>'request_sha256',
 'request_raw_sha256',c->'artifact'->'body'->>'request_raw_sha256','mock',true,'http_status',200,
 'raw_response_text','EXPLICIT MOCK ONLY','raw_response_sha256',encode(extensions.digest('EXPLICIT MOCK ONLY','sha256'),'hex'));
 if not public.receive_jls_sol_ready(op,'mock_worker_a',r,public.jls_restaurant_hash(r))
 or not public.receive_jls_sol_ready(op,'mock_worker_a',r,public.jls_restaurant_hash(r)) then raise exception 'TEST_RECEIPT_IDEMPOTENCE';end if;
 if public.receive_jls_sol_ready(op,'mock_worker_a',r||'{"http_status":201}',public.jls_restaurant_hash(r||'{"http_status":201}')) then raise exception 'TEST_RECEIPT_MUTABLE';end if;
 o=public.claim_jls_sol_ready(op,'mock_validator');
 if o->>'phase'<>'validate_sol' or o->>'request_count'<>'1' then raise exception 'TEST_VALIDATION_REDISPATCH';end if;
 result=jsonb_build_object('receipt_sha256',public.jls_restaurant_hash(r),'raw_response_sha256',r->>'raw_response_sha256','explicit_mock',true);
 if not public.finish_jls_sol_ready(op,'mock_validator','completed',result,public.jls_restaurant_hash(result))
 or not public.finish_jls_sol_ready(op,'mock_validator','completed',result,public.jls_restaurant_hash(result))
 or public.claim_jls_sol_ready(op,'mock_again') is not null then raise exception 'TEST_RESULT_RETRY';end if;
 begin update public.analysis_jls_sol_ready_operations set request_count=0 where id=op;raise exception 'TEST_ATTEMPT_RESET';exception when others then if sqlerrm='TEST_ATTEMPT_RESET' then raise;end if;end;
 begin update public.analysis_jls_sol_ready_artifacts set body='{}' where id=a;raise exception 'TEST_MUTABLE_ARTIFACT';exception when others then if sqlerrm='TEST_MUTABLE_ARTIFACT' then raise;end if;end;
-- Lost response: expire only a synthetic mock lease; the consumed attempt
 -- becomes terminal without creating a new task or provider request.
 op=public.create_jls_sol_ready_probe(c->'protocol'->'body',c->'protocol'->>'sha256','SQL_ROLLBACK_READY_LOST');
 o=public.claim_jls_sol_ready(op,'lost_mock');
 update public.analysis_jls_sol_ready_operations set lease_until=now()-interval '1 minute' where id=op;
 if public.claim_jls_sol_ready(op,'lost_again') is not null or not exists(select 1 from public.analysis_jls_sol_ready_operations where id=op and status='billing_uncertain' and request_count=1) then raise exception 'TEST_LOST_RESPONSE_RETRIED';end if;
 perform set_config('jls.ready_test_user',c->'protocol'->'body'->>'authority_user_id',true);
 perform set_config('jls.ready_test_operation',op::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('jls.ready_test_user'),'role','authenticated')::text,true);
do $$begin
 if not exists(select 1 from public.analysis_jls_sol_ready_operations where id=current_setting('jls.ready_test_operation')::uuid) then raise exception 'TEST_OWNER_READ';end if;
 begin perform public.claim_jls_sol_ready(current_setting('jls.ready_test_operation')::uuid,'browser');raise exception 'TEST_BROWSER_WRITE';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin if exists(select 1 from public.analysis_jls_sol_ready_operations) or exists(select 1 from public.analysis_jls_sol_ready_artifacts) then raise exception 'TEST_CROSS_ORG';end if;end $$;
set local role anon;
do $$begin begin perform count(*) from public.analysis_jls_sol_ready_operations;raise exception 'TEST_ANON_READ';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'Sol-ready SQL/RLS: source reuse, idempotence, reservation, receipt before validation, consumed attempt, immutable result, tenant separation: PASS' checks;
