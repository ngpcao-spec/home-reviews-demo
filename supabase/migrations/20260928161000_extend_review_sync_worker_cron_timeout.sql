do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job
    where jobname='home-reviews-sync-worker-v2'
  loop perform cron.unschedule(v_job.jobid); end loop;
end $$;

select cron.schedule('home-reviews-sync-worker-v2','* * * * *',$cron$
  select net.http_post(
    url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-review-sync-jobs',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-home-reviews-scheduler',(
        select decrypted_secret from vault.decrypted_secrets
        where name='home_reviews_scheduler_token')),
    body:='{}'::jsonb,timeout_milliseconds:=60000);
$cron$);
