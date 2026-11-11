-- Operational rollback. Keep all staged data for inspection.
-- Run as the migration owner after stopping any future shared workers.
begin;
-- Do not reopen the legacy provider paths while a common operation could still
-- have billed. Reconcile and drain those jobs before attempting the rollback.
do $$begin
  if to_regclass('private.shared_restaurant_operations') is not null then
    if exists(select 1 from private.shared_restaurant_operations where state in ('running','unknown'))
      or exists(select 1 from private.shared_restaurant_collection_jobs where status in ('queued','running','unknown'))
    then raise exception 'SHARED_ROLLBACK_REQUIRES_DRAIN'; end if;
    if to_regclass('private.shared_restaurant_initial_sources') is not null then
      if exists(select 1 from private.shared_restaurant_initial_sources s
        left join public.initial_import_jobs j on j.id=s.leader_job
        where s.result is null and (j.id is null or j.status<>'failed'))
      then raise exception 'SHARED_ROLLBACK_REQUIRES_DRAIN'; end if;
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='review_sync_jobs' and column_name='shared_restaurant_id') then
      if exists(select 1 from public.review_sync_jobs where shared_restaurant_id is not null and status in ('queued','running','retry'))
      then raise exception 'SHARED_ROLLBACK_REQUIRES_DRAIN'; end if;
    end if;
    if to_regclass('private.shared_restaurant_jev_keys') is not null then
      if exists(select 1 from private.shared_restaurant_jev_keys k join private.shared_jev_analyses a using(identity_sha256)
        where a.state not in ('ready','failed','expired'))
      then raise exception 'SHARED_ROLLBACK_REQUIRES_DRAIN'; end if;
    end if;
    if to_regclass('private.shared_restaurant_sol_requests') is not null then
      if exists(select 1 from private.shared_restaurant_sol_requests s left join public.analysis_jev_batch_runs r on r.id=s.source_run_id
        where s.receipt is null and (r.id is null or r.status='running'))
      then raise exception 'SHARED_ROLLBACK_REQUIRES_DRAIN'; end if;
    end if;
    update private.shared_restaurant_runtime set enabled=false where singleton;
  end if;
end $$;
revoke execute on function public.read_shared_restaurant(uuid,uuid),
  public.unsubscribe_shared_restaurant(uuid,uuid) from authenticated;
revoke execute on function public.subscribe_verified_shared_restaurant(text,text,text,uuid,uuid,text),
  public.seed_verified_shared_restaurant(uuid,text,uuid),
  public.queue_shared_restaurant_collection(uuid,text),
  public.claim_shared_restaurant_collection(uuid),
  public.complete_shared_restaurant_collection(uuid,jsonb),
  public.reserve_shared_restaurant_analysis(uuid,text,text,text,text),
  public.complete_shared_restaurant_analysis(uuid,text,text,text,text,jsonb),
  public.read_shared_restaurant_analysis(uuid,text,text,text,text) from service_role;
commit;
