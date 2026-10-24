-- Wake only newly inserted current batch requests. No existing request is
-- claimed, resumed or dispatched by this migration; the minute cron stays.
create or replace function public.wake_current_jev_preparation(p_source uuid) returns bigint language plpgsql set search_path='' as $$
declare result bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.report_generation_requests q join public.historical_report_runs s on s.id=q.source_run_id
  where s.id=p_source and q.engine='jev_sol_v2' and q.jev_transport='batch_initial_v1' and q.comparison_id is null
  and s.status in('queued','running','retry') and s.locked_by is null and s.created_at+interval '24 hours'>now()
  and (s.lease_until is null or s.lease_until<=now()) and (s.next_retry_at is null or s.next_retry_at<=now())
  and ((s.status='queued' and s.started_at is null and s.attempt_count=0)
   or (s.snapshot->'reviews' is not null and s.snapshot->'base' is not null))) then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-historical-report-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
   (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
  body:='{}'::jsonb,timeout_milliseconds:=180000) into result;return result;
end $$;

create function public.wake_new_current_batch_request() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 begin
  perform public.wake_current_jev_preparation(new.source_run_id);
 exception when others then
  -- Retain the durable request for the cron if wake scheduling itself fails.
  -- Never log SQLERRM: it could contain privileged request details.
  raise warning 'CURRENT_BATCH_INITIAL_WAKE_FAILED_CRON_RECOVERY';
 end;
 return new;
end $$;
revoke all on function public.wake_current_jev_preparation(uuid),public.wake_new_current_batch_request() from public,anon,authenticated;
grant execute on function public.wake_current_jev_preparation(uuid),public.wake_new_current_batch_request() to service_role;
create trigger current_batch_request_wake after insert on public.report_generation_requests
 for each row when(new.engine='jev_sol_v2' and new.jev_transport='batch_initial_v1')
 execute function public.wake_new_current_batch_request();
