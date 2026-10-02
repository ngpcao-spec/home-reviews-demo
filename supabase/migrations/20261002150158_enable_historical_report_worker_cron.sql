-- Worker deployed and authenticated before enabling the new report-only cron.
select cron.alter_job(jobid,active:=true) from cron.job where jobname='home-reviews-historical-report-worker-v1';
