-- Set home_reviews.parallel_preparation_id to a certified real frozen corpus.
-- Supplier-free qualification of the deployed RPCs. ALL queue writes roll back.
begin;
set local role service_role;
set local jit=off;
set local statement_timeout='20s';
do $test$
declare b jsonb;h text;actor uuid;pair uuid;again uuid;rid uuid;bad jsonb;denied boolean;before_count int;
begin
 select body,sha256,authority_user_id into strict b,h,actor
 from public.analysis_parallel_launch_preparations
 where id=current_setting('home_reviews.parallel_preparation_id')::uuid;
 select count(*) into before_count from public.analysis_parallel_reports;
 assert not has_table_privilege('authenticated','public.analysis_parallel_launch_preparations','INSERT');
 assert not has_table_privilege('anon','public.analysis_parallel_launch_preparations','SELECT');
 assert not has_function_privilege('authenticated','public.prepare_parallel_report(jsonb,text,uuid)','EXECUTE');
 denied=false;begin perform public.start_parallel_report(b,h,gen_random_uuid());exception when others then denied=true;end;assert denied,'wrong actor accepted';
 denied=false;begin perform public.prepare_parallel_report(jsonb_set(b,'{establishment_id}',to_jsonb(gen_random_uuid())),h,actor);exception when others then denied=true;end;assert denied,'wrong establishment accepted';
 -- A certificate is not a bypass for modified requests or an outer hash.
 bad=jsonb_set(b,'{pending,0,payload,state,analysis_text}','"ALTERED SOURCE"');
 denied=false;begin perform public.prepare_parallel_report(bad,public.jls_restaurant_hash(bad),actor);exception when others then denied=true;end;assert denied,'altered request accepted';
 assert (select count(*) from public.analysis_parallel_reports)=before_count,'failed preparation created a job';
 pair=public.start_parallel_report(b,h,actor);again=public.start_parallel_report(b,h,actor);assert pair=again,'double launch';
 select run_id into rid from public.analysis_parallel_reports where id=pair;
 assert public.jls_restaurant_valid(rid),'invalid consent';
 assert (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and phase='jev')=(b->>'max_jev_calls')::int;
 assert not exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=rid and phase='luna');
 assert not exists(select 1 from public.analysis_jls_task_dispatch_intents i join public.analysis_jls_restaurant_tasks t on t.id=i.task_id where t.run_id=rid);
 denied=false;begin update public.analysis_parallel_launch_preparations set body='{}' where sha256=h;exception when others then denied=true;end;assert denied,'mutable certificate';
end $test$;
select 'passed; no provider transport; queue writes rolled back' as qualification;
rollback;
