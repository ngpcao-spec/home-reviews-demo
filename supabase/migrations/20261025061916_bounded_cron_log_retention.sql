-- Log maintenance only: never touches cron.job or any application work/receipt.
create function private.purge_cron_job_run_details(p_batch_size integer default 10000)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
 v_as_of timestamptz:=clock_timestamp();v_eligible bigint;v_deleted bigint;v_success bigint;v_failed bigint;
 v_unfinished bigint;v_old_unfinished bigint;v_oldest_unfinished timestamptz;
begin
 if p_batch_size is null or p_batch_size<1 or p_batch_size>10000 then raise exception 'CRON_LOG_BATCH_OUT_OF_RANGE';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('home-reviews:cron-log-retention-v1',0)) then
  return jsonb_build_object('as_of',v_as_of,'deleted',0,'skipped_concurrent',true);
 end if;
 with ranked as materialized (
  select runid,status,end_time,row_number() over(partition by status order by end_time desc,runid desc) position
  from cron.job_run_details where end_time is not null and status in('succeeded','failed')
 ), eligible as materialized (
  select runid,status,end_time from ranked where
   (status='succeeded' and (end_time<v_as_of-interval '7 days' or position>95000)) or
   (status='failed' and (end_time<v_as_of-interval '30 days' or position>5000))
 ), victims as (
  select d.runid from cron.job_run_details d join eligible e using(runid)
  where d.status=e.status and d.end_time=e.end_time
  order by e.end_time,e.runid limit p_batch_size for update of d skip locked
 ), removed as (
  delete from cron.job_run_details d using victims v where d.runid=v.runid returning d.status
 )
 select (select count(*) from eligible),count(*),count(*) filter(where status='succeeded'),count(*) filter(where status='failed')
 into v_eligible,v_deleted,v_success,v_failed from removed;
 select count(*),count(*) filter(where start_time<v_as_of-interval '1 hour'),min(start_time)
 into v_unfinished,v_old_unfinished,v_oldest_unfinished from cron.job_run_details
 where end_time is null or status is null or status not in('succeeded','failed');
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
comment on function private.purge_cron_job_run_details(integer) is
 'At most 10000 finalized cron log rows per transaction. Keep newest successes <=7d/95000 and failures <=30d/5000 by end_time,runid. Preserve unfinished/unknown rows; warn at 1h. No application data, no VACUUM FULL.';
