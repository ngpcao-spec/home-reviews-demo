-- Install after the initial bounded catch-up. An existing installation remains
-- unchanged on replay, including its minute and activation setting.
do $$
declare j cron.job;v_schedule text;
begin
 if not has_table_privilege(current_user,'cron.job_run_details','SELECT')
 or not has_table_privilege(current_user,'cron.job_run_details','DELETE')
 or not has_function_privilege(current_user,'private.purge_cron_job_run_details(integer)','EXECUTE')
 then raise exception 'CRON_LOG_RETENTION_PRIVILEGES_MISSING';end if;
 select * into j from cron.job where jobname='home-reviews-cron-log-retention-v1';
 if j.jobid is not null then
  if j.command<>$cmd$set statement_timeout='30s'; select private.purge_cron_job_run_details(10000);$cmd$
  or j.username<>current_user or j.database<>current_database() then raise exception 'CRON_LOG_RETENTION_JOB_CONFLICT';end if;
  return;
 end if;
 -- First normal scheduled execution in about 1–2 minutes, then every hour.
 v_schedule=to_char((clock_timestamp()+interval '2 minutes') at time zone 'UTC','MI')||' * * * *';
 perform cron.schedule('home-reviews-cron-log-retention-v1',v_schedule,
  $cmd$set statement_timeout='30s'; select private.purge_cron_job_run_details(10000);$cmd$);
end $$;
