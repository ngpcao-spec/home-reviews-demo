-- Execute inside BEGIN / ROLLBACK as service_role. Source IDs supplied by the
-- administrator. All runtime writes below target session-local table copies.
-- No consent, paid run, public task or provider request is created or changed.
create temp table analysis_jls_restaurant_protocols (like public.analysis_jls_restaurant_protocols including all);
create temp table analysis_jls_restaurant_runs (like public.analysis_jls_restaurant_runs including all);
create temp table analysis_jls_restaurant_tasks (like public.analysis_jls_restaurant_tasks including all);
create temp table analysis_jls_restaurant_artifacts (like public.analysis_jls_restaurant_artifacts including all);
create temp table analysis_jls_sol_ready_artifacts (like public.analysis_jls_sol_ready_artifacts including all);
create temp table analysis_jls_sol_ready_operations (like public.analysis_jls_sol_ready_operations including all);
-- Copy the DEPLOYED RPC and trigger bodies, replacing only their SQL namespace.
-- This exercises the paid finalization branch against isolated saved data,
-- unlike the older mock operation test which skipped the restaurant task guard.
do $$declare f text;d text;n text;begin
 foreach f in array array['jls_restaurant_state_guard','jls_ready_operation_guard','save_jls_restaurant_artifact','receive_jls_sol_ready','finish_jls_sol_ready'] loop
  select pg_get_functiondef(oid) into strict d from pg_proc where pronamespace='public'::regnamespace and proname=f;
  d=replace(d,'public.analysis_jls_','pg_temp.analysis_jls_');
  foreach n in array array['jls_restaurant_state_guard','jls_ready_operation_guard','save_jls_restaurant_artifact','receive_jls_sol_ready','finish_jls_sol_ready'] loop
   d=replace(d,'public.'||n,'pg_temp.'||n);
  end loop;
  execute d;
 end loop;
end $$;
insert into pg_temp.analysis_jls_sol_ready_operations select * from public.analysis_jls_sol_ready_operations where id=current_setting('jls.finalization_operation')::uuid;
insert into pg_temp.analysis_jls_restaurant_runs select r.* from public.analysis_jls_restaurant_runs r join pg_temp.analysis_jls_sol_ready_operations o on o.run_id=r.id;
insert into pg_temp.analysis_jls_restaurant_protocols select p.* from public.analysis_jls_restaurant_protocols p join pg_temp.analysis_jls_restaurant_runs r on r.protocol_id=p.id;
insert into pg_temp.analysis_jls_restaurant_tasks select t.* from public.analysis_jls_restaurant_tasks t join pg_temp.analysis_jls_sol_ready_operations o on o.task_id=t.id;
insert into pg_temp.analysis_jls_sol_ready_artifacts select a.* from public.analysis_jls_sol_ready_artifacts a join pg_temp.analysis_jls_sol_ready_operations o on o.artifact_id=a.id;
-- Reconstruct the moment just before receipt persistence in TEMP copies only.
select set_config('jls.finalization_receipt',(select receipt::text from pg_temp.analysis_jls_sol_ready_operations),true);
update pg_temp.analysis_jls_sol_ready_operations set phase='sol',status='dispatched',worker='sql_fixture',lease_until=now()+interval '5 minutes',receipt=null,receipt_sha256=null,result=null,result_sha256=null,completed_at=null,error_code=null;
update pg_temp.analysis_jls_restaurant_runs set status='running',stage='sol',worker='sql_fixture',lease_until=now()+interval '5 minutes',error_code=null;
update pg_temp.analysis_jls_restaurant_tasks set status='running',worker='sql_fixture',completed_at=null,error_code=null;
create trigger fixture_run_guard before update or delete on pg_temp.analysis_jls_restaurant_runs for each row execute function pg_temp.jls_restaurant_state_guard();
create trigger fixture_task_guard before update or delete on pg_temp.analysis_jls_restaurant_tasks for each row execute function pg_temp.jls_restaurant_state_guard();
create trigger fixture_operation_guard before update or delete on pg_temp.analysis_jls_sol_ready_operations for each row execute function pg_temp.jls_ready_operation_guard();
do $$declare op uuid=current_setting('jls.finalization_operation')::uuid;
 receipt jsonb=current_setting('jls.finalization_receipt')::jsonb;
 result jsonb=(select body->'result' from public.analysis_jls_snapshot_preparations where id=current_setting('jls.finalization_validation')::uuid);
 succeeded boolean=false;failed text;begin
 if result is null or receipt is null then raise exception 'TEST_SOURCE_MISSING';end if;
 if not pg_temp.receive_jls_sol_ready(op,'sql_fixture',receipt,public.jls_restaurant_hash(receipt))
 or not pg_temp.receive_jls_sol_ready(op,'sql_fixture',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_RECEIVE';end if;
 if not exists(select 1 from pg_temp.analysis_jls_restaurant_artifacts where kind='sol_receipt') then raise exception 'TEST_RECEIPT_NOT_DURABLE';end if;
 -- Simulate closure/reload between receipt and validation; the original raw
 -- receipt and consumed request_count survive, and no dispatch is performed.
 update pg_temp.analysis_jls_restaurant_runs set worker='validator',lease_until=now()+interval '5 minutes';
 update pg_temp.analysis_jls_sol_ready_operations set status='validating',worker='validator',lease_until=now()+interval '5 minutes';
 if current_setting('jls.expect_old_failure')='false' then
  if pg_temp.finish_jls_sol_ready(op,null,'needs_review',result,public.jls_restaurant_hash(result))
  or pg_temp.finish_jls_sol_ready(op,'wrong_worker','needs_review',result,public.jls_restaurant_hash(result))
  or pg_temp.finish_jls_sol_ready(op,'validator','needs_review',result,'wrong_hash') then raise exception 'TEST_INVALID_FINISH_ACCEPTED';end if;
  -- An interrupted transaction must roll back all three finalization writes.
  begin
   if not pg_temp.finish_jls_sol_ready(op,'validator','needs_review',result,public.jls_restaurant_hash(result)) then raise exception 'TEST_INTERRUPT_SETUP';end if;
   raise exception 'TEST_CONNECTION_INTERRUPTED';
  exception when others then if sqlerrm<>'TEST_CONNECTION_INTERRUPTED' then raise;end if;end;
  if exists(select 1 from pg_temp.analysis_jls_restaurant_artifacts where kind like 'task:%')
  or not exists(select 1 from pg_temp.analysis_jls_restaurant_tasks where status='received') then raise exception 'TEST_INTERRUPT_PARTIAL_SAVE';end if;
 end if;
 begin
  succeeded=pg_temp.finish_jls_sol_ready(op,'validator','needs_review',result,public.jls_restaurant_hash(result));
 exception when others then failed=sqlerrm;end;
 if current_setting('jls.expect_old_failure')='true' then
  if failed is distinct from 'JLS_NO_RETRY' then raise exception 'TEST_EXPECTED_OLD_GUARD_FAILURE: %',failed;end if;
  if exists(select 1 from pg_temp.analysis_jls_restaurant_artifacts where kind like 'task:%') then raise exception 'TEST_FAILED_FINISH_NOT_ATOMIC';end if;
  return;
 end if;
 if not succeeded or failed is not null then raise exception 'TEST_FINISH_FAILED: %',failed;end if;
 -- Finish is idempotent after a lost acknowledgement; a different body fails.
 if not pg_temp.finish_jls_sol_ready(op,'another_worker','needs_review',result,public.jls_restaurant_hash(result))
 or pg_temp.finish_jls_sol_ready(op,'another_worker','completed',result||'{"changed":true}',public.jls_restaurant_hash(result||'{"changed":true}')) then raise exception 'TEST_IDEMPOTENCE';end if;
 if not exists(select 1 from pg_temp.analysis_jls_restaurant_runs where status='needs_review')
 or not exists(select 1 from pg_temp.analysis_jls_restaurant_tasks where status='needs_review' and request_count=1)
 or not exists(select 1 from pg_temp.analysis_jls_restaurant_artifacts where kind like 'task:%' and body=result)
 then raise exception 'TEST_ATOMIC_FINALIZATION';end if;
 begin update pg_temp.analysis_jls_restaurant_tasks set status='running';raise exception 'TEST_RETRY_ALLOWED';exception when others then if sqlerrm='TEST_RETRY_ALLOWED' then raise;end if;end;
 begin update pg_temp.analysis_jls_restaurant_runs set status='running';raise exception 'TEST_REOPEN_ALLOWED';exception when others then if sqlerrm='TEST_REOPEN_ALLOWED' then raise;end if;end;
end $$;
select 'receipt -> interruption -> validation result -> atomic SQL finish -> repeat acknowledgement: PASS (temporary copies only)' checks;
