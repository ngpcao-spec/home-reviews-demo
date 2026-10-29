CREATE OR REPLACE FUNCTION public.complete_review_sync_job(p_job_id uuid, p_worker_id text, p_synced_at timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job public.review_sync_jobs%rowtype; v_interval integer;
begin
  select * into v_job from public.review_sync_jobs
  where id=p_job_id and status='running' and locked_by=left(p_worker_id,120)
    and lease_until>now() for update;
  if not found then return false; end if;
  select monitoring_interval_hours into v_interval
  from public.organizations where id=v_job.organization_id;
  update public.establishments set
    last_review_id=coalesce(v_job.head_review_id,last_review_id),
    last_review_at=coalesce(v_job.head_review_at,last_review_at),
    last_sync_at=p_synced_at,
    next_sync_at=p_synced_at+make_interval(hours=>v_interval)
      +public.review_sync_spread_offset(id,v_interval),
    sync_status='ok',sync_error=null,last_sync_status='ok',last_sync_error=null,
    sync_lock_token=null,sync_locked_until=null
  where id=v_job.establishment_id;
  update public.review_sync_jobs set status='completed',lease_until=null,locked_by=null,
    pagination_cursor=null,error_code=null,finished_at=now(),updated_at=now()
  where id=p_job_id;
  return true;
end $function$

;
revoke all on function public.complete_review_sync_job(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_review_sync_job(uuid,text,timestamptz) to service_role;
