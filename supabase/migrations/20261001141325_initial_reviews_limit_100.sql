-- New jobs only. Keep completed jobs and all stored reviews/reports unchanged.
alter table public.initial_import_jobs alter column reviews_target set default 100;

-- A manual retry starts a new provider run, so it uses the current initial sample cap.
-- The legacy check (<= 500) is retained to preserve existing job history.
create or replace function public.retry_initial_import_job(p_job_id uuid)
returns public.initial_import_jobs
language plpgsql security definer set search_path='' as $$
declare v_job public.initial_import_jobs%rowtype;
begin
  update public.initial_import_jobs set
    status='queued',attempts=0,available_at=now(),lease_until=null,locked_by=null,
    reviews_target=least(reviews_target,100),
    provider_run_id=null,provider_dataset_id=null,error_code=null,finished_at=null,
    acknowledged_at=null,updated_at=now()
  where id=p_job_id and user_id=(select auth.uid()) and status='failed'
    and (select private.is_org_member(organization_id))
  returning * into v_job;
  if not found then raise exception 'IMPORT_JOB_NOT_RETRYABLE'; end if;
  return v_job;
end $$;
