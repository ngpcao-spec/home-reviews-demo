-- Limit candidate IDs BEFORE looking up and locking heap rows. This prevents
-- poor/absent extension-table statistics from causing hundreds of thousands
-- of random primary-key lookups just to delete one bounded batch.
do $$
declare d text;a text;b text;
begin
 d=pg_get_functiondef('private.purge_cron_job_run_details(integer)'::regprocedure);
 a=E'), victims as (\n  select d.runid from cron.job_run_details d join eligible e using(runid)';
 b=E'), targets as materialized (\n  select runid,status,end_time from eligible order by end_time,runid limit p_batch_size\n ), victims as (\n  select d.runid from cron.job_run_details d join targets e using(runid)';
 if position(a in d)=0 then raise exception 'CRON_LOG_RETENTION_LOOKUP_ANCHOR_CHANGED';end if;
 execute replace(d,a,b);
end $$;
