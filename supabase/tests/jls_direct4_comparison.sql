-- Transactional technical fixtures only. No HTTP, scheduler, real GO or persistent run.
begin;
set local role service_role;
do $$declare p public.analysis_jls_restaurant_protocols;r uuid;t jsonb;v jsonb;c jsonb;i int;tid uuid;aid uuid;oid uuid;receipt jsonb;outbody jsonb;begin
 select * into p from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-synthesis-comparison-v1' order by created_at desc limit 1;
 if p.id is null or not public.check_jls_direct4_comparison_sources(p.body) then raise exception 'COMPARISON_SOURCE_INVALID';end if;
 if public.save_jls_restaurant_protocol(p.body,p.sha256)<>p.id then raise exception 'NON_IDEMPOTENT_PREPARATION';end if;
 if public.check_jls_direct4_comparison_sources(jsonb_set(p.body,'{max_luna_calls}','5'))
 or public.check_jls_direct4_comparison_sources(jsonb_set(p.body,'{statistics_sha256}',to_jsonb(repeat('0',64))))
 or public.check_jls_direct4_comparison_sources(jsonb_set(p.body,'{organization_id}',to_jsonb('00000000-0000-4000-8000-000000000004'::text))) then raise exception 'SOURCE_MUTATION_ACCEPTED';end if;
 begin perform public.authorize_jls_restaurant(p.id,null,null);raise exception 'MISSING_GO_ACCEPTED';
 exception when others then if sqlerrm<>'DIRECT_COMPARISON_NEW_GO_REQUIRED' then raise;end if;end;
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=p.id) then raise exception 'UNEXPECTED_EXISTING_RUN';end if;
 c=jsonb_build_object('explicit_technical_mock',true,'user_directive','EXPLICIT_TRANSACTIONAL_MOCK_NOT_USER_GO','protocol_sha256',p.sha256,'consent_source','user_directive_codex_delegation');
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at,status,stage)
 values(p.id,p.organization_id,c,public.jls_restaurant_hash(c),now()+interval '1 hour','queued','luna') returning id into r;
 for v in select value from jsonb_array_elements(p.body->'pending_groups') loop
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(r,p.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,v->'payload',v->>'request_sha256');end loop;
 if not public.claim_jls_restaurant_tick(r,'technical_mock') or public.claim_jls_restaurant_tick(r,'other_worker') then raise exception 'LEASE_NOT_EXCLUSIVE';end if;
 for i in 1..4 loop
 t=public.claim_jls_restaurant_task(r,'technical_mock');if t is null or t->>'request_count'<>'1' then raise exception 'RESERVATION_FAILED';end if;
 outbody='{"explicit_technical_mock":true,"input_tokens":1,"output_tokens":0,"direct4_result":{"mock":true}}';
 if not public.finish_jls_restaurant_task((t->>'id')::uuid,'technical_mock','completed',outbody,public.jls_restaurant_hash(outbody)) then raise exception 'RECEIPT_SAVE_FAILED';end if;
 end loop;
 if public.claim_jls_restaurant_task(r,'technical_mock') is not null or (select sum(request_count) from public.analysis_jls_restaurant_tasks where run_id=r)<>4 then raise exception 'CALL_LIMIT_FAILED';end if;
 if not public.stage_jls_restaurant(r,'technical_mock','prepare_sol','[]') then raise exception 'SOL_STAGE_FAILED';end if;
 -- The received receipt can finalize exactly once; a terminal response is never resent.
 update public.analysis_jls_restaurant_runs set stage='validate_sol' where id=r;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256,status,request_count,worker)
 values(r,p.organization_id,'sol','sol','{"explicit_technical_mock":true}',public.jls_restaurant_hash('{"explicit_technical_mock":true}'),'received',1,'technical_mock') returning id into tid;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256)
 values(p.organization_id,p.id,r,'{"explicit_technical_mock":true}',public.jls_restaurant_hash('{"explicit_technical_mock":true}')) returning id into aid;
 receipt=jsonb_build_object('explicit_technical_mock',true,'raw_response_text','{"mock":true}','raw_response_sha256',encode(extensions.digest('{"mock":true}','sha256'),'hex'));
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_id,protocol_sha256,run_id,task_id,phase,status,request_count,worker,lease_until,receipt,receipt_sha256)
 values(p.organization_id,aid,'paid',p.id,p.sha256,r,tid,'validate_sol','validating',1,'technical_mock',now()+interval '1 minute',receipt,public.jls_restaurant_hash(receipt)) returning id into oid;
 outbody=jsonb_build_object('explicit_technical_mock',true,'receipt_sha256',public.jls_restaurant_hash(receipt),'raw_response_sha256',receipt->>'raw_response_sha256');
 if not public.finish_jls_sol_ready(oid,'technical_mock','completed',outbody,public.jls_restaurant_hash(outbody))
 or not public.finish_jls_sol_ready(oid,'technical_mock','completed',outbody,public.jls_restaurant_hash(outbody)) then raise exception 'SOL_FINISH_NOT_IDEMPOTENT';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_runs where id=r and status='completed') then raise exception 'RESULT_NOT_SAVED';end if;
 perform set_config('comparison_test.user',p.authority_user_id::text,true);perform set_config('comparison_test.protocol',p.id::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('comparison_test.user'),true);
do $$begin if not exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('comparison_test.protocol')::uuid) then raise exception 'OWNER_READ_FAILED';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$declare f record;begin
 if exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('comparison_test.protocol')::uuid) then raise exception 'CROSS_ORG_READ';end if;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname like '%jls_direct4_comparison%' loop
 if has_function_privilege('authenticated',f.oid,'execute') or has_function_privilege('anon',f.oid,'execute') then raise exception 'PUBLIC_MUTATION_PERMISSION';end if;end loop;
end $$;
rollback;
