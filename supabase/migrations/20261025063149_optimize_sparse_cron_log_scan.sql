-- A purged extension table can keep hundreds of MiB of empty heap pages.
-- Read its remaining rows once through the existing primary key, materialize
-- only small columns, and lock/delete a bounded set by physical row identity.
-- Planner/memory settings are local to this private maintenance function.
create or replace function private.purge_cron_job_run_details(p_batch_size integer default 10000)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s'
set enable_seqscan='off' set work_mem='16MB' as $$
declare
 v_as_of timestamptz:=clock_timestamp();v_eligible bigint;v_deleted bigint;v_success bigint;v_failed bigint;
 v_unfinished bigint;v_old_unfinished bigint;v_oldest_unfinished timestamptz;
begin
 if p_batch_size is null or p_batch_size<1 or p_batch_size>10000 then raise exception 'CRON_LOG_BATCH_OUT_OF_RANGE';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('home-reviews:cron-log-retention-v1',0)) then
  return jsonb_build_object('as_of',v_as_of,'deleted',0,'skipped_concurrent',true);
 end if;
 with log_rows as materialized (
  select runid,status,start_time,end_time,ctid row_tid from cron.job_run_details order by runid
 ), ranked as materialized (
  select runid,status,end_time,row_tid,row_number() over(partition by status order by end_time desc,runid desc) position
  from log_rows where end_time is not null and status in('succeeded','failed')
 ), eligible as materialized (
  select runid,status,end_time,row_tid from ranked where
   (status='succeeded' and (end_time<v_as_of-interval '7 days' or position>95000)) or
   (status='failed' and (end_time<v_as_of-interval '30 days' or position>5000))
 ), targets as materialized (
  select * from eligible order by end_time,runid limit p_batch_size
 ), victims as (
  select d.ctid row_tid from cron.job_run_details d join targets e on d.ctid=e.row_tid
  where d.runid=e.runid and d.status=e.status and d.end_time=e.end_time
  order by e.end_time,e.runid limit p_batch_size for update of d skip locked
 ), removed as (
  delete from cron.job_run_details d using victims v where d.ctid=v.row_tid returning d.status
 )
 select (select count(*) from eligible),count(*),count(*) filter(where status='succeeded'),count(*) filter(where status='failed'),
  (select count(*) from log_rows where end_time is null or status is null or status not in('succeeded','failed')),
  (select count(*) from log_rows where (end_time is null or status is null or status not in('succeeded','failed')) and start_time<v_as_of-interval '1 hour'),
  (select min(start_time) from log_rows where end_time is null or status is null or status not in('succeeded','failed'))
 into v_eligible,v_deleted,v_success,v_failed,v_unfinished,v_old_unfinished,v_oldest_unfinished from removed;
 if v_old_unfinished>0 then
  raise warning 'CRON_LOG_RETENTION_OLD_UNFINISHED count=% oldest_start=% (preserved)',v_old_unfinished,v_oldest_unfinished;
 end if;
 raise log 'CRON_LOG_RETENTION_RESULT deleted=% succeeded=% failed=% eligible_remaining=% old_unfinished=%',v_deleted,v_success,v_failed,v_eligible-v_deleted,v_old_unfinished;
 return jsonb_build_object('as_of',v_as_of,'batch_limit',p_batch_size,'deleted',v_deleted,
  'deleted_succeeded',v_success,'deleted_failed',v_failed,'eligible_before',v_eligible,
  'eligible_remaining',v_eligible-v_deleted,'unfinished_preserved',v_unfinished,
  'old_unfinished_preserved',v_old_unfinished,'oldest_unfinished_start',v_oldest_unfinished,'skipped_concurrent',false);
end $$;
revoke all on function private.purge_cron_job_run_details(integer) from public,anon,authenticated,service_role;
