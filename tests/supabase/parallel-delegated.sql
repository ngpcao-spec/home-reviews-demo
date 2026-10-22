-- Inject home_reviews.parallel_fixture with a real frozen protocol, ready artifact
-- and EXPLICIT mock Sol receipt/result. The inner subtransaction ALWAYS rolls
-- back, including its temporary consent/run/cache/task/receipt writes.
do $test$
declare f jsonb=current_setting('home_reviews.parallel_fixture')::jsonb;p jsonb;pid uuid;rid uuid;pair uuid;again uuid;w text='EXPLICIT_SQL_MOCK';t jsonb;t2 jsonb;body jsonb;sha text;wire text;op uuid;reserved jsonb;receipt jsonb;result jsonb;
 raw text;ready jsonb;readysha text;source_sha text;c jsonb;bad jsonb;started timestamptz=clock_timestamp();ms numeric;calls int=0;saved int=0;tests int=0;summary text;forbidden boolean=false;
begin
 begin
 execute 'set local role service_role';p=f->'protocol'->'body';
 source_sha=public.jls_restaurant_hash((select to_jsonb(h) from public.historical_establishment_reports h where id=(p->'reference'->>'report_id')::uuid));

 c=jsonb_build_object('consent_source','user_directive_codex_delegation','operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),
 'user_directive','EXPLICIT OFFLINE TECHNICAL MOCK delegation; no provider transport; every write is rolled back',
 'directive_sha256',encode(extensions.digest('EXPLICIT OFFLINE TECHNICAL MOCK delegation; no provider transport; every write is rolled back','sha256'),'hex'),
 'protocol_sha256',public.jls_restaurant_hash(p),'source_snapshot_sha256',p->>'source_snapshot_sha256','pending_sha256',p->>'pending_sha256',
 'reference_report_id',p#>>'{reference,report_id}','requested_at',now(),'expires_at',now()+interval '4 hours',
 'scope',jsonb_build_object('organization_id',p->'organization_id','establishment_id',p->'establishment_id','language',p->'language','configuration_sha256',p->'configuration_sha256',
 'max_jev_calls',p->'max_jev_calls','max_luna_calls',0,'max_sol_calls',1,'max_apify_calls',0,'automatic_retry',false,'provider_client_retries',0));
 assert not public.check_parallel_delegation(p,public.jls_restaurant_hash(p),'{}'),'missing GO accepted';tests=tests+1;
 foreach bad in array array[jsonb_set(c,'{expires_at}',to_jsonb((now()-interval '1 hour')::text)),jsonb_set(c,'{scope,max_sol_calls}','2'),jsonb_set(c,'{source_snapshot_sha256}','"changed"'),jsonb_set(c,'{scope,organization_id}',to_jsonb(gen_random_uuid()::text)),jsonb_set(c,'{directive_sha256}','"wrong"')] loop
  assert not public.check_parallel_delegation(p,public.jls_restaurant_hash(p),bad),'invalid GO accepted';tests=tests+1;
 end loop;
 -- The original button RPC still records its own actual provenance.
 begin
  pair=public.start_parallel_report(p,public.jls_restaurant_hash(p),(p->>'authority_user_id')::uuid);
  assert exists(select 1 from public.analysis_parallel_reports x join public.analysis_jls_restaurant_runs r on r.id=x.run_id where x.id=pair and r.consent->>'consent_source'='user_in_app_button');
  raise exception using errcode='P7002',message='ROLLBACK_MANUAL_COMPATIBILITY';
 exception when sqlstate 'P7002' then null;end;tests=tests+1;
 pair=public.start_parallel_report_delegated(p,public.jls_restaurant_hash(p),c,public.jls_restaurant_hash(c));
 again=public.start_parallel_report_delegated(p,public.jls_restaurant_hash(p),c,public.jls_restaurant_hash(c));
 assert pair=again,'duplicate launch created another run';tests=tests+1;
 select run_id,protocol_id into rid,pid from public.analysis_parallel_reports where id=pair;
 assert exists(select 1 from public.analysis_jls_restaurant_runs where id=rid and consent->>'consent_source'='user_directive_codex_delegation'),'delegation mislabeled';tests=tests+1;
 assert public.jls_restaurant_valid(rid),'delegated consent scope not recognized';tests=tests+1;
 assert public.claim_jls_restaurant_task(rid,'WRONG_WORKER') is null,'claim without lease';tests=tests+1;
 begin perform public.start_parallel_report(p,public.jls_restaurant_hash(p),gen_random_uuid());exception when others then forbidden=true;end;
 assert forbidden,'wrong identity accepted';tests=tests+1;
 assert not has_table_privilege('authenticated','public.analysis_parallel_reports','INSERT'),'client write granted';tests=tests+1;
 assert not has_function_privilege('authenticated','public.start_parallel_report(jsonb,text,uuid)','EXECUTE'),'client can forge launch';tests=tests+1;
 -- Test actual uncached reservation/persistence, without invoking a transport.
 delete from public.analysis_parallel_jev_cache where organization_id=(p->>'organization_id')::uuid and establishment_id=(p->>'establishment_id')::uuid;
 assert public.claim_jls_restaurant_tick(rid,w),'tick failed';tests=tests+1;
 assert not public.claim_jls_restaurant_tick(rid,'CONCURRENT_WAKE'),'concurrent run lease granted';tests=tests+1;
 loop
  t=public.claim_jls_restaurant_task(rid,w);exit when t is null;calls=calls+1;
  assert t->>'phase'='jev' and t->>'request_count'='1','wrong supplier or counter';
  assert public.begin_jls_restaurant_dispatch((t->>'id')::uuid,w,t->>'request_sha256'),'dispatch reservation failed';
  assert not public.begin_jls_restaurant_dispatch((t->>'id')::uuid,w,t->>'request_sha256'),'dispatch repeated';
  -- Existing compatible raw classification is copied only into this rollback
  -- mock receipt. Its historical source artifact is never updated.
  body=f#>array['mock_bodies',t->>'review_id'];
  assert body is not null,'saved classification missing from real fixture';
  body=body||jsonb_build_object('request_sha256',t->>'request_sha256','provider_fetch_invoked',false,'explicit_technical_mock',true);
  sha=public.jls_restaurant_hash(body);wire=jsonb_build_object('version','jls-restaurant-receipt-v1','source_kind','provider_outcome','task_id',t->>'id','worker',w,'protocol_sha256',public.jls_restaurant_hash(p),'status','completed','body',body,'sha256',sha)::text;
  assert public.save_jls_restaurant_receipt((t->>'id')::uuid,w,wire,encode(extensions.digest(wire,'sha256'),'hex')),'receipt save failed';
  assert public.save_jls_restaurant_receipt((t->>'id')::uuid,w,wire,encode(extensions.digest(wire,'sha256'),'hex')),'receipt idempotence failed';
  assert public.finish_jls_restaurant_receipt((t->>'id')::uuid),'receipt finish failed';
  assert public.finish_jls_restaurant_receipt((t->>'id')::uuid),'repeat finish failed';saved=saved+1;
 end loop;
 assert calls=(p->>'max_jev_calls')::int and saved=calls,'not all reservations persisted';tests=tests+5;
 assert not exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=rid and phase='luna'),'Luna task created';tests=tests+1;
 assert public.claim_jls_restaurant_task(rid,w) is null,'limit did not stop claims';tests=tests+1;
 assert public.stage_jls_restaurant(rid,w,'prepare_evidence','[]'),'free preparation stage failed';tests=tests+1;
 ready=f->'ready'->'body';ready=ready||jsonb_build_object('source_protocol_id',pid,'source_protocol_sha256',public.jls_restaurant_hash(p),'source_run_id',rid);
 ready=jsonb_set(ready,'{dataset,id}',to_jsonb(rid));ready=jsonb_set(ready,'{dataset,protocol_id}',to_jsonb(pid));
 select jsonb_agg(jsonb_build_object('task_id',t.id,'review_id',t.review_id,'artifact_sha256',a.sha256,'result_sha256',public.jls_restaurant_hash(a.body->'direct4_result'),'reused',false) order by t.review_id) into body
 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id where t.run_id=rid and t.phase='jev';
 ready=jsonb_set(ready,'{classification_sources}',body);ready=jsonb_set(ready,'{classification_sources_sha256}',to_jsonb(public.jls_restaurant_hash(body)));readysha=public.jls_restaurant_hash(ready);
 op=public.prepare_parallel_ready(rid,w,ready,readysha);
 assert op=public.prepare_parallel_ready(rid,w,ready,readysha),'ready reservation idempotence failed';tests=tests+1;
 perform public.release_jls_restaurant_tick(rid,w,null);
 reserved=public.claim_jls_sol_ready(op,'EXPLICIT_SOL_MOCK');assert reserved->>'request_count'='1','Sol not reserved';tests=tests+1;
 assert public.claim_jls_sol_ready(op,'CONCURRENT_SOL') is null,'second Sol reservation';tests=tests+1;
 receipt=f->'mock_operation'->'receipt';receipt=receipt||jsonb_build_object('request_sha256',ready->>'request_sha256','request_raw_sha256',ready->>'request_raw_sha256','mock',false,'explicit_technical_mock',true);
 assert public.receive_jls_sol_ready(op,'EXPLICIT_SOL_MOCK',receipt,public.jls_restaurant_hash(receipt)),'Sol receipt save failed';
 assert public.receive_jls_sol_ready(op,'EXPLICIT_SOL_MOCK',receipt,public.jls_restaurant_hash(receipt)),'Sol receipt idempotence failed';tests=tests+2;
 reserved=public.claim_jls_sol_ready(op,'EXPLICIT_VALIDATE_MOCK');assert reserved->>'phase'='validate_sol' and reserved->>'request_count'='1','validation repeated supplier attempt';tests=tests+1;
 result=f->'mock_operation'->'result';result=result||jsonb_build_object('receipt_sha256',public.jls_restaurant_hash(receipt),'raw_response_sha256',receipt->>'raw_response_sha256');
 assert public.finish_jls_sol_ready(op,'EXPLICIT_VALIDATE_MOCK','completed',result,public.jls_restaurant_hash(result)),'finish Sol failed';
 assert public.finish_jls_sol_ready(op,'EXPLICIT_VALIDATE_MOCK','completed',result,public.jls_restaurant_hash(result)),'finish Sol not idempotent';tests=tests+2;
 assert public.claim_jls_sol_ready(op,'REPEATED_WAKE') is null,'completed Sol repeated';tests=tests+1;
 assert exists(select 1 from public.analysis_parallel_reports where id=pair and derived_report is not null and original_report is not null and raw_response is not null),'report not atomically published';tests=tests+1;
 assert source_sha=public.jls_restaurant_hash((select to_jsonb(h) from public.historical_establishment_reports h where id=(p->'reference'->>'report_id')::uuid)),'production report changed';tests=tests+1;
 -- Authenticated random identity must read no rows and cannot write.
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);execute 'set local role authenticated';
 assert not exists(select 1 from public.analysis_parallel_reports),'cross-account data visible';tests=tests+1;
 execute 'set local role service_role';
 ms=extract(epoch from clock_timestamp()-started)*1000;
 raise exception using errcode='P7001',message=jsonb_build_object('tests_passed',tests,'jev_mock_reservations',calls,'jev_receipts_saved',saved,'sol_mock_reservations',1,'provider_calls',0,'all_writes_rolled_back',true,'sql_wall_ms',ms)::text;
 exception when sqlstate 'P7001' then get stacked diagnostics summary=message_text;perform set_config('home_reviews.parallel_results',summary,true);
 end;
end $test$;
select current_setting('home_reviews.parallel_results')::jsonb as offline_sql_results;
