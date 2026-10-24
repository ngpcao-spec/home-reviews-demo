-- Run through the local qualification harness. It supplies ONLY synthetic
-- provider data in test.current_batch_fixture, inside a transaction ending in
-- ROLLBACK. pg_net wakes are transaction-bound and never sent after rollback.
set local role service_role;
do $$
declare fixtures jsonb=current_setting('test.current_batch_fixture')::jsonb;f jsonb;j jsonb;p jsonb;m jsonb;e jsonb;bad jsonb;u jsonb;
 r uuid;r1 uuid;r2 uuid;t1 uuid;t2 uuid;w jsonb;receipt jsonb;projection jsonb;response jsonb;original jsonb;new_source public.historical_report_runs;req uuid=gen_random_uuid();begin
 if (select jev_transport from public.report_pipeline_settings where id)<>'individual' then raise exception 'TEST_EXPECTED_DISABLED';end if;
 perform public.set_current_jev_transport('batch_initial_v1','Transactional batch qualification only; rollback preserves the disabled setting.');
 for f in select fixtures->'first' union all select fixtures->'second' loop
  j=f->'job';p=f->'protocol';m=f->'manifest';
  insert into public.historical_report_runs(id,generation_id,organization_id,establishment_id,language,requested_by,status,snapshot,model,created_at)
  values((j->>'id')::uuid,(j->>'generation_id')::uuid,(j->>'organization_id')::uuid,(j->>'establishment_id')::uuid,j->>'language',(j->>'requested_by')::uuid,'running',j->'snapshot','gpt-6.1-sol',(j->>'created_at')::timestamptz);
  insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport)
  values((j->>'request_id')::uuid,(j->>'organization_id')::uuid,(j->>'establishment_id')::uuid,(j->>'requested_by')::uuid,j->>'language','jev_sol_v2',(j->>'id')::uuid,'batch_initial_v1');
  perform public.prepare_current_v2_protocol((j->>'id')::uuid,p->'body',p->>'sha256');
  bad=jsonb_set(m->'body','{configuration,selector,version}','"jls-direct4-lexical-coverage-offline-v1"');
  begin
   perform public.jev_batch_create_current((j->>'id')::uuid,bad,public.jls_restaurant_hash(bad));raise exception 'TEST_SELECTOR_VARIANT_ACCEPTED';
  exception when others then if sqlerrm<>'CURRENT_BATCH_CONFIGURATION_CHANGED' then raise;end if;end;
  bad=jsonb_set(m->'body','{plans,0,mapping,r001_service,category}','"price"');
  begin
   perform public.jev_batch_create_current((j->>'id')::uuid,bad,public.jls_restaurant_hash(bad));raise exception 'TEST_MAPPING_CHANGE_ACCEPTED';
  exception when others then if sqlerrm<>'CURRENT_BATCH_MAPPING_OR_TEXT_CHANGED' then raise;end if;end;
  r=public.jev_batch_create_current((j->>'id')::uuid,m->'body',m->>'sha256');
  if public.jev_batch_create_current((j->>'id')::uuid,m->'body',m->>'sha256')<>r then raise exception 'TEST_DUPLICATE_CREATION';end if;
  if r1 is null then r1=r;else r2=r;end if;
 end loop;
 perform set_config('test.current_batch_run1',r1::text,true);
 if (select count(*) from public.analysis_jev_batch_tasks where run_id=r1)<>1 or (select count(*) from public.analysis_jev_batch_tasks where run_id=r2)<>2 then raise exception 'TEST_GENERAL_BATCH_PLAN';end if;
 w=public.jev_batch_claim(r1,'native-one');t1=(w->>'id')::uuid;
 if t1 is null or w->>'request_count'<>'1' then raise exception 'TEST_NATIVE_RESERVATION';end if;
 if public.jev_batch_claim(r2,'other-restaurant') is not null then raise exception 'TEST_GLOBAL_BATCH_CONCURRENCY';end if;
 f=fixtures->'first';receipt=f#>'{execution,tasks,0,receipt}';projection=f#>'{execution,tasks,0,projection}';
 if not public.jev_batch_receive(t1,'native-one',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_SAVE_RECEIPT';end if;
 if not public.jev_batch_receive(t1,'irrelevant',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_IDEMPOTENT_RECEIPT';end if;
 if public.jev_batch_receive(t1,'native-one','{}',public.jls_restaurant_hash('{}')) then raise exception 'TEST_RECEIPT_OVERWRITTEN';end if;
 -- Another restaurant can now reserve one batch, but a crashed reservation is consumed.
 w=public.jev_batch_claim(r2,'crash-before-receipt');t2=(w->>'id')::uuid;
 if t2 is null then raise exception 'TEST_OTHER_RESTAURANT_STARVED';end if;
 update public.analysis_jev_batch_tasks set lease_until=now()-interval '1 second' where id=t2;
 w=public.jev_batch_claim(r2,'resume-unstarted');
 if (w->>'id')::uuid=t2 or w->>'number'<>'2' or w->>'request_count'<>'1' then raise exception 'TEST_UNKNOWN_RETRIED_OR_UNSTARTED_LOST';end if;
 if not exists(select 1 from public.analysis_jev_batch_tasks where id=t2 and status='unknown' and request_count=1) then raise exception 'TEST_UNKNOWN_STATE_LOST';end if;
 begin update public.analysis_jev_batch_tasks set request_count=0 where id=t2;raise exception 'TEST_CONSUMED_ATTEMPT_RESET';
 exception when others then if sqlerrm<>'BATCH_FROZEN_TASK_CHANGED' then raise;end if;end;
 -- An interrupted saved receipt is projected freely even while another send is reserved.
 w=public.jev_batch_claim(r1,'validator');
 if w->>'status'<>'received' or w->>'request_count'<>'1' then raise exception 'TEST_SAVED_RECEIPT_RESENT';end if;
 if not public.jev_batch_save_projection(t1,'validator',projection,public.jls_restaurant_hash(projection)) then raise exception 'TEST_PROJECTION_SAVE';end if;
 if not public.jev_batch_save_projection(t1,'validator',projection,public.jls_restaurant_hash(projection)) then raise exception 'TEST_PROJECTION_IDEMPOTENCE';end if;
 e=f#>'{execution,run,envelope}';
 if not public.jev_batch_save_envelope(r1,e,public.jls_restaurant_hash(e)) then raise exception 'TEST_COMPACT_ENVELOPE_SAVE';end if;
 if not public.jev_batch_claim_sol(r1,'sol-one') or public.jev_batch_claim_sol(r1,'sol-duplicate') then raise exception 'TEST_SOL_RESERVATION';end if;
 response=f#>'{execution,run,sol_receipt}';
 if not public.jev_batch_receive_sol(r1,'sol-one',response,public.jls_restaurant_hash(response)) then raise exception 'TEST_SOL_RECEIPT';end if;
 if not public.jev_batch_finish(r1,'completed',f#>'{execution,result}',f#>'{execution,usage}') then raise exception 'TEST_CURRENT_PUBLICATION';end if;
 select to_jsonb(rpt) into original from public.analysis_parallel_reports rpt join public.analysis_jev_batch_runs br on br.report_id=rpt.id where br.id=r1;
 if original->>'current_source_run_id' is distinct from f#>>'{job,id}' or original->>'state'<>'completed' or original->'derived_report' is null then raise exception 'TEST_REPORT_NOT_CURRENT';end if;
 if original#>>'{statistics,counts,received_results}'<>'3' or jsonb_array_length(original#>'{statistics,counts,categories,service,negative_review_ids}')<>3 then raise exception 'TEST_NEGATIVE_MIXED_IDS_MISSING';end if;
 if not exists(select 1 from public.historical_report_runs where id=(f#>>'{job,id}')::uuid and status='completed' and ai_calls=2 and input_tokens=404 and output_tokens=606 and token_usage_complete) then raise exception 'TEST_ACTUAL_USAGE_NOT_PUBLISHED_ONCE';end if;
 perform public.jev_batch_finish(r1,'invalid_output','{}','{}');
 if original is distinct from (select to_jsonb(rpt) from public.analysis_parallel_reports rpt join public.analysis_jev_batch_runs br on br.report_id=rpt.id where br.id=r1) then raise exception 'TEST_REPORT_REPUBLISHED';end if;
 -- No accidental individual fallback can consume this generation's certificate.
 begin perform public.start_parallel_report(f#>'{protocol,body}',f#>>'{protocol,sha256}',(f#>>'{job,requested_by}')::uuid);raise exception 'TEST_INDIVIDUAL_FALLBACK';
 exception when others then if sqlerrm<>'CURRENT_V2_TRANSPORT_CHANGED' then raise;end if;end;
 -- Rollback affects only future requests, and does not create a generation itself.
 perform public.set_current_jev_transport('individual','Transactional rollback test: future requests only.');
 if (select jev_transport from public.report_generation_requests where source_run_id=(f#>>'{job,id}')::uuid)<>'batch_initial_v1' then raise exception 'TEST_EXISTING_TRANSPORT_CHANGED';end if;
 new_source=public.enqueue_current_report((f#>>'{job,establishment_id}')::uuid,(f#>>'{job,organization_id}')::uuid,(f#>>'{job,requested_by}')::uuid,'vi',req,'gpt-6.1-sol',8);
 if (select jev_transport from public.report_generation_requests where id=req)<>'individual' then raise exception 'TEST_ROLLBACK_NEW_REQUEST_NOT_INDIVIDUAL';end if;
 if (public.enqueue_current_report((f#>>'{job,establishment_id}')::uuid,(f#>>'{job,organization_id}')::uuid,(f#>>'{job,requested_by}')::uuid,'vi',req,'gpt-6.1-sol',8)).id<>new_source.id then raise exception 'TEST_NEW_REQUEST_NOT_IDEMPOTENT';end if;
 -- Preserve the other restaurant's unknown batch and finish only its unstarted successor.
 f=fixtures->'second';select id into t1 from public.analysis_jev_batch_tasks where run_id=r2 and number=2;
 receipt=f#>'{execution,tasks,1,receipt}';projection=f#>'{execution,tasks,1,projection}';
 if not public.jev_batch_receive(t1,'resume-unstarted',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_SUCCESSOR_RECEIPT';end if;
 w=public.jev_batch_claim(r2,'validator-two');
 if not public.jev_batch_save_projection(t1,'validator-two',projection,public.jls_restaurant_hash(projection)) then raise exception 'TEST_SUCCESSOR_PROJECT';end if;
 if public.jev_batch_claim(r2,'must-not-send') is not null then raise exception 'TEST_UNKNOWN_AUTO_RETRY';end if;
 if not exists(select 1 from public.analysis_jev_batch_runs where id=r2 and status='blocked' and not armed and sol_request_count=0) then raise exception 'TEST_INCOMPLETE_NOT_BLOCKED';end if;
 if not exists(select 1 from public.analysis_parallel_reports rpt join public.analysis_jev_batch_runs br on br.report_id=rpt.id where br.id=r2 and rpt.state='blocked' and rpt.usage#>>'{jev,new_usage,usage_complete}'='false') then raise exception 'TEST_UNKNOWN_USAGE_MISREPRESENTED';end if;
end $$;
-- Both table access and organisation ownership remain enforced.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.current_batch_fixture')::jsonb#>>'{first,job,requested_by}',true);
do $$begin
 if (select count(*) from public.analysis_jev_batch_tasks where run_id=current_setting('test.current_batch_run1')::uuid)<>1 then raise exception 'TEST_MEMBER_CANNOT_READ_CURRENT_BATCH';end if;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$begin
 if exists(select 1 from public.analysis_jev_batch_tasks where run_id=current_setting('test.current_batch_run1')::uuid) then raise exception 'TEST_UNRELATED_USER_CAN_READ_BATCH';end if;
end $$;
select 'passed: generic current creation, frozen transport, disabled rollback, exact mapping/selector guards, global reservation, immutable receipt, interrupted continuation, unknown non-retry, actual usage, current publication, negative/mixed IDs and RLS' qualification;
