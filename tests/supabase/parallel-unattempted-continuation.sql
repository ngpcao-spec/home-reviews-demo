-- Set home_reviews.parallel_source_run to a blocked parallel run.
-- Explicit administration only. Reserves SQL mock tasks but NEVER sends.
-- All continuation/task/cache writes roll back.
begin;
set local jit=off;
set local statement_timeout='60s';
set local role service_role;do $test$ declare pair uuid;again uuid;rid uuid;t jsonb;at1 timestamptz;creation_ms numeric;max_claim_ms numeric=0;n int=0;source_before text;begin
 select public.jls_restaurant_hash(to_jsonb(r)) into source_before from public.analysis_jls_restaurant_runs r where id=current_setting('home_reviews.parallel_source_run')::uuid;
 at1=clock_timestamp();pair=public.continue_parallel_report_unattempted(current_setting('home_reviews.parallel_source_run')::uuid);creation_ms=extract(epoch from clock_timestamp()-at1)*1000;
 again=public.continue_parallel_report_unattempted(current_setting('home_reviews.parallel_source_run')::uuid);assert pair=again,'duplicate continuation';
 select run_id into rid from public.analysis_parallel_reports where id=pair;
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and status='reused')=(select count(*) from public.analysis_jls_restaurant_tasks where run_id=current_setting('home_reviews.parallel_source_run')::uuid and status in('completed','reused')),'reuse count';
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and status='pending')=(select count(*) from public.analysis_jls_restaurant_tasks where run_id=current_setting('home_reviews.parallel_source_run')::uuid and status='pending'),'remaining count';
 assert not has_function_privilege('authenticated','public.continue_parallel_report_unattempted(uuid)','EXECUTE'),'untrusted continuation';
 assert public.claim_jls_restaurant_tick(rid,'EXPLICIT_SQL_MOCK'),'lease';
 assert not public.claim_jls_restaurant_tick(rid,'CONCURRENT_MOCK'),'second lease';
 loop at1=clock_timestamp();t=public.claim_jls_restaurant_task(rid,'EXPLICIT_SQL_MOCK');max_claim_ms=greatest(max_claim_ms,extract(epoch from clock_timestamp()-at1)*1000);exit when t is null;n=n+1;
 assert t->>'request_count'='1','repeat attempt';end loop;
 assert n=(select count(*) from public.analysis_jls_restaurant_tasks where run_id=current_setting('home_reviews.parallel_source_run')::uuid and status='pending'),'call cap';assert max_claim_ms<8000,'SQL timeout margin';
 assert not exists(select 1 from public.analysis_jls_task_dispatch_intents i join public.analysis_jls_restaurant_tasks t on t.id=i.task_id where t.run_id=rid),'provider started in test';
 assert source_before=(select public.jls_restaurant_hash(to_jsonb(r)) from public.analysis_jls_restaurant_runs r where id=current_setting('home_reviews.parallel_source_run')::uuid),'history changed';
 perform set_config('home_reviews.continuation_test',jsonb_build_object('creation_ms',creation_ms,'new_claims',n,'max_claim_ms',max_claim_ms,'reused',200,'provider_calls',0,'old_run_unchanged',true,'idempotent',true)::text,true);
end $test$;select current_setting('home_reviews.continuation_test')::jsonb result;rollback;