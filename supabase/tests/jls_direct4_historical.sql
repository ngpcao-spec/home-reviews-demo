-- Real bookkeeping/RLS functions, inside a rolled-back technical fixture.
-- No HTTP, wake, supplier key, real GO, persistent consent or paid run.
begin;
set local role service_role;
do $$declare p public.analysis_jls_restaurant_protocols;r uuid;tid uuid;aid uuid;oid uuid;token jsonb;c jsonb;receipt jsonb;outbody jsonb;i int;h text;begin
 select * into p from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-historical-v1' order by created_at desc limit 1;
 if p.id is null or not public.check_jls_direct4_historical_sources(p.body) then raise exception 'HISTORICAL_SOURCES_INVALID';end if;
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=p.id) then raise exception 'REAL_RUN_ALREADY_EXISTS';end if;
 begin perform public.authorize_jls_restaurant(p.id,null,null);raise exception 'MISSING_GO_ACCEPTED';
 exception when others then if sqlerrm not in('DIRECT4_HISTORICAL_DEPLOYED_QUALIFICATION_REQUIRED','DIRECT4_HISTORICAL_GO_SCOPE_CHANGED','JLS_NEW_GO_REQUIRED') then raise;end if;end;
 select public.jls_restaurant_hash(to_jsonb(x)) into h from public.historical_report_runs x where id=(p.body->'historical'->>'id')::uuid;
 c=jsonb_build_object('explicit_technical_mock',true,'user_directive','EXPLICIT_TRANSACTIONAL_MOCK_NOT_USER_GO','protocol_sha256',p.sha256,'consent_source','user_directive_codex_delegation');
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at,status,stage)
 values(p.id,p.organization_id,c,public.jls_restaurant_hash(c),now()+interval '1 hour','queued','jev') returning id into r;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
 select r,p.organization_id,'jev',x->>'review_id',(x->>'review_id')::uuid,x->'payload',x->>'request_sha256',x->'identity' from jsonb_array_elements(p.body->'pending')x;
 if not public.claim_jls_restaurant_tick(r,'technical_mock') then raise exception 'MOCK_TICK_FAILED';end if;
 for i in 1..68 loop
 token=public.claim_jls_restaurant_task(r,'technical_mock');
 if token is null or token->>'request_count'<>'1' or (select count(*) from jsonb_object_keys(token->'request'->'questions'))<>4 then raise exception 'FOUR_CATEGORY_CLAIM_FAILED';end if;
 outbody=jsonb_build_object('phase','jev','explicit_technical_mock',true,'input_tokens',1,'output_tokens',0,'direct4_result',jsonb_build_object('mock',true));
 if not public.finish_jls_restaurant_task((token->>'id')::uuid,'technical_mock','completed',outbody,public.jls_restaurant_hash(outbody)) then raise exception 'MOCK_JEV_SAVE_FAILED';end if;
 end loop;
 if public.claim_jls_restaurant_task(r,'technical_mock') is not null or (select sum(request_count) from public.analysis_jls_restaurant_tasks where run_id=r)<>68 then raise exception 'MORE_THAN_68_CALLS';end if;
 if not public.stage_jls_restaurant(r,'technical_mock','prepare_evidence','[]') then raise exception 'FREE_PREPARATION_STAGE_FAILED';end if;
 -- Verify the received -> validated persistence path with the actual new version,
 -- without sending anything or pretending this fixture is a real Sol answer.
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
 or not public.finish_jls_sol_ready(oid,'technical_mock','completed',outbody,public.jls_restaurant_hash(outbody)) then raise exception 'SOL_RECEIPT_FINISH_NOT_IDEMPOTENT';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_runs where id=r and status='completed') then raise exception 'FINAL_RESULT_NOT_SAVED';end if;
 if h<>(select public.jls_restaurant_hash(to_jsonb(x)) from public.historical_report_runs x where id=(p.body->'historical'->>'id')::uuid) then raise exception 'HISTORY_MUTATED';end if;
 perform set_config('direct4_bistro_test.user',p.authority_user_id::text,true);perform set_config('direct4_bistro_test.protocol',p.id::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('direct4_bistro_test.user'),true);
do $$begin if not exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('direct4_bistro_test.protocol')::uuid) then raise exception 'OWNER_READ_FAILED';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('direct4_bistro_test.protocol')::uuid) then raise exception 'CROSS_ORG_READ';end if;
 if has_function_privilege('authenticated','public.authorize_jls_direct4_historical(uuid,jsonb,text)','execute') or has_function_privilege('anon','public.claim_jls_direct4_historical_task(uuid,text)','execute') then raise exception 'PUBLIC_WRITE_PRIVILEGE';end if;
end $$;
rollback;
