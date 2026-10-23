-- Saved Home Pizza regression. SQL reservations only; transaction always rolls back.
begin;set local role service_role;set local jit=off;set local plan_cache_mode='force_generic_plan';set local statement_timeout='60s';
do $test$ declare src uuid='32b854ed-5a23-401e-9424-e0de7e22b338';t uuid;denied boolean=false;pair uuid;again uuid;rid uuid;q jsonb;n int=0;at1 timestamptz;max_ms numeric=0;created_ms numeric;before_source text;begin
 select public.jls_restaurant_hash(to_jsonb(r)) into before_source from public.analysis_jls_restaurant_runs r where id=src;
 select task_id into t from public.parallel_recovery_rows(src) where disposition='never_sent' limit 1;
 begin update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker='EXPLICIT_SQL_UNKNOWN',dispatched_at=now() where id=t;
 perform public.continue_parallel_report_unattempted(src);exception when others then if sqlerrm='PARALLEL_CONTINUATION_OUTCOME_UNCERTAIN' then denied=true;else raise;end if;end;
 assert denied,'unknown reservation accepted';
 at1=clock_timestamp();pair=public.continue_parallel_report_unattempted(src);created_ms=extract(epoch from clock_timestamp()-at1)*1000;
 again=public.continue_parallel_report_unattempted(src);assert pair=again,'double continuation';
 select run_id into rid from public.analysis_parallel_reports where id=pair;
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and status='reused')=318,'saved responses not preserved';
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and status='pending')=208,'remaining task mismatch';
 assert public.claim_jls_restaurant_tick(rid,'EXPLICIT_SQL_MOCK');
 assert not public.claim_jls_restaurant_tick(rid,'CONCURRENT_SQL_MOCK');
 loop at1=clock_timestamp();q=public.claim_jls_restaurant_task(rid,'EXPLICIT_SQL_MOCK');max_ms=greatest(max_ms,extract(epoch from clock_timestamp()-at1)*1000);exit when q is null;n=n+1;end loop;
 assert n=208;assert max_ms<8000;
 assert not exists(select 1 from public.analysis_jls_task_dispatch_intents i join public.analysis_jls_restaurant_tasks t on t.id=i.task_id where t.run_id=rid);
 assert before_source=(select public.jls_restaurant_hash(to_jsonb(r)) from public.analysis_jls_restaurant_runs r where id=src);
 perform set_config('home_reviews.final_recovery_test',jsonb_build_object('reused_responses',318,'unattempted',208,'proven_not_sent',0,'new_claims',n,'creation_ms',created_ms,'max_claim_ms',max_ms,'unknown_refused',denied,'provider_calls',0,'source_unchanged',true)::text,true);
end $test$;select current_setting('home_reviews.final_recovery_test')::jsonb result;rollback;