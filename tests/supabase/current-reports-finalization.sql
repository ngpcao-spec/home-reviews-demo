-- Explicit saved-source subset + mock transport; ROLLBACK only.
-- Inject home_reviews.current_fixture with an offline protocol generated from a
-- saved real corpus. Every request, consent and task below is ROLLED BACK.
begin;
set local role service_role;
set local jit=off;
do $test$
declare f jsonb=current_setting('home_reviews.current_fixture')::jsonb;p jsonb;src uuid;req uuid;actor uuid;org uuid;est uuid;r public.historical_report_runs;r2 public.historical_report_runs;pid uuid;pair uuid;again uuid;rid uuid;pre uuid;review_rows jsonb;base jsonb;tests int=0;bad boolean;summary text;ready jsonb;body jsonb;readysha text;op uuid;reserved jsonb;receipt jsonb;result jsonb;w text='EXPLICIT_SQL_MOCK';started timestamptz=clock_timestamp();step timestamptz;timings jsonb='{}';
begin
 begin
 p=f->'protocol'->'body';select jsonb_set(p,'{pending}',jsonb_agg(jsonb_set(t,'{payload,questions}',p#>'{configuration,jev,questions}'))) into p from jsonb_array_elements(p->'pending') t;
 assert public.jls_restaurant_hash(p)=f#>>'{protocol,sha256}','fixture changed in transport';
 src=(p#>>'{current_delivery,source_run_id}')::uuid;req=(p#>>'{current_delivery,request_id}')::uuid;actor=(p->>'authority_user_id')::uuid;org=(p->>'organization_id')::uuid;est=(p->>'establishment_id')::uuid;
 perform public.set_current_report_pipeline('jev_sol_v2','EXPLICIT OFFLINE SQL TEST; ALL WRITES ROLLED BACK');
 r=public.enqueue_current_report(est,org,actor,'vi',gen_random_uuid(),'gpt-6.1-sol',7);
 r2=public.enqueue_current_report(est,org,actor,'vi',gen_random_uuid(),'gpt-6.1-sol',7);
 assert r.id=r2.id,'double click started two wrappers';tests=tests+1;
 select id into pre from public.report_generation_requests where source_run_id=r.id;
 r2=public.enqueue_current_report(est,org,actor,'vi',pre,'gpt-6.1-sol',7);assert r.id=r2.id,'intent is not idempotent';tests=tests+1;
 bad=false;begin perform public.enqueue_current_report(est,gen_random_uuid(),actor,'vi',gen_random_uuid(),'gpt-6.1-sol',7);exception when others then bad=true;end;assert bad,'wrong organization accepted';tests=tests+1;
 update public.historical_report_runs set status='failed' where id=r.id;
 -- Real frozen snapshot, reconstructed from the exact transport representation.
 base=(p->'frozen_report')-array['id','generation_id','ai_status','ai_model','consultant_report'];
 select jsonb_agg(v||jsonb_build_object('original_language',v#>'{translation_provenance,original_language}')) into review_rows from jsonb_array_elements(p#>'{source_snapshot,reviews}') v;
 insert into public.historical_report_runs(id,generation_id,organization_id,establishment_id,language,requested_by,status,snapshot,model)
 values(src,(p#>>'{current_delivery,generation_id}')::uuid,org,est,'vi',actor,'running',jsonb_build_object('base',base,'reviews',review_rows,'analysis_version',8),'gpt-6.1-sol');
 insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id)values(req,org,est,actor,'vi','jev_sol_v2',src);
 assert public.check_parallel_protocol(p),'current protocol rejected';tests=tests+1;
 step=clock_timestamp();pid=public.prepare_current_v2_protocol(src,p,f#>>'{protocol,sha256}');timings=timings||jsonb_build_object('prepare_ms',extract(epoch from clock_timestamp()-step)*1000);
 assert pid=public.prepare_current_v2_protocol(src,p,f#>>'{protocol,sha256}'),'seal not idempotent';tests=tests+1;
 bad=false;begin update public.historical_report_runs set snapshot=jsonb_set(snapshot,'{base,source_fingerprint}','"changed"') where id=src;exception when others then bad=true;end;assert bad,'source mutable';tests=tests+1;
 step=clock_timestamp();pair=public.start_parallel_report(p,f#>>'{protocol,sha256}',actor);timings=timings||jsonb_build_object('start_ms',extract(epoch from clock_timestamp()-step)*1000);again=public.start_parallel_report(p,f#>>'{protocol,sha256}',actor);assert pair=again,'repeated start duplicated';tests=tests+1;
 select run_id into rid from public.analysis_parallel_reports where id=pair;
 assert public.jls_restaurant_valid(rid),'current consent invalid';tests=tests+1;
 assert exists(select 1 from public.report_generation_requests where id=req and comparison_id=pair),'binding missing';tests=tests+1;
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and phase='jev')=(p->>'max_jev_calls')::int,'wrong task count';tests=tests+1;
 assert not exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=rid and phase='luna'),'Luna queued';tests=tests+1;
 assert public.claim_jls_restaurant_tick(rid,w),'lease failed';
 assert not public.claim_jls_restaurant_tick(rid,'CONCURRENT'),'concurrent lease accepted';
 assert public.claim_jls_restaurant_task(rid,w) is null,'expected exact saved caches';
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and status='reused')=(p->>'max_jev_calls')::int,'cache reuse incomplete';
 assert public.stage_jls_restaurant(rid,w,'prepare_evidence','[]'),'free preparation stage failed';tests=tests+1;
 ready=f->'ready'->'body';ready=ready||jsonb_build_object('source_protocol_id',(select protocol_id from public.analysis_parallel_reports where id=pair),'source_protocol_sha256',public.jls_restaurant_hash(p),'source_run_id',rid);
 ready=jsonb_set(ready,'{dataset,id}',to_jsonb(rid));ready=jsonb_set(ready,'{dataset,protocol_id}',to_jsonb((select protocol_id from public.analysis_parallel_reports where id=pair)));
 select jsonb_agg(jsonb_build_object('task_id',t.id,'review_id',t.review_id,'artifact_sha256',a.sha256,'result_sha256',public.jls_restaurant_hash(a.body->'direct4_result'),'reused',true) order by t.review_id) into body
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
 assert exists(select 1 from public.historical_report_runs where id=src and status='completed'),'current wrapper not completed with publication';tests=tests+1;
 assert not has_function_privilege('authenticated','public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)','EXECUTE'),'client can forge scope';tests=tests+1;
 assert not has_table_privilege('authenticated','public.report_generation_requests','INSERT'),'client can write intents';tests=tests+1;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);set local role authenticated;
 assert not exists(select 1 from public.report_generation_requests),'cross organization readable';tests=tests+1;
 set local role service_role;
 raise exception using errcode='P7001',message=jsonb_build_object('tests_passed',tests,'rpc_timings',timings,'real_source_reviews',jsonb_array_length(review_rows),'real_text_reviews',p->>'max_jev_calls','provider_calls',0,'rolled_back',true,'wall_ms',extract(epoch from clock_timestamp()-started)*1000)::text;
 exception when sqlstate 'P7001' then get stacked diagnostics summary=message_text;perform set_config('home_reviews.current_sql_result',summary,true);
 end;
end $test$;
select current_setting('home_reviews.current_sql_result')::jsonb result;
rollback;



