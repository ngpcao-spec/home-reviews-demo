-- Terminal provider outcomes no longer represent an in-flight collection.
-- An unknown start remains blocking until reconciled on the original job.
do $$
declare
  signature regprocedure;
  definition text;
  old_guard text := $old$s.status<>'completed' and (s.apify_run_id is null or coalesce(s.error_code,'') not in('APIFY_RUN_FAILED','APIFY_RUN_TIMED-OUT','APIFY_RUN_ABORTED'))$old$;
  new_guard text := $new$s.status<>'completed' and not (
    s.status='dead' and (
      (s.apify_run_id is null and s.provider_no_run_confirmed_at is not null)
      or (s.apify_run_id is not null and (
        coalesce(s.error_code,'') in ('APIFY_RUN_FAILED','APIFY_RUN_TIMED-OUT','APIFY_RUN_ABORTED')
        or (coalesce(s.incremental_receipt->>'id','')=s.apify_run_id
          and coalesce(s.incremental_receipt->>'status','') in ('SUCCEEDED','FAILED','TIMED-OUT','ABORTED'))
      ))
    )
  )$new$;
begin
  foreach signature in array array[
    'public.request_review_reload(uuid,uuid)'::regprocedure,
    'private.assert_review_reload_idle(uuid)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(signature);
    if strpos(definition,old_guard)=0 then raise exception 'RELOAD_SYNC_GUARD_CHANGED: %',signature; end if;
    execute replace(definition,old_guard,new_guard);
  end loop;
end $$;

-- The successful reload establishes a new collection epoch. Even if a
-- historical dead job shares its slot, that job belongs to the old corpus.
do $$
declare
  d text := pg_get_functiondef('public.enqueue_due_review_sync_jobs(integer)'::regprocedure);
  old_slot text := $old$j.status='dead' and j.scheduled_for=e.next_sync_at$old$;
begin
  if strpos(d,old_slot)=0 then raise exception 'RELOAD_SCHEDULER_DEFINITION_CHANGED'; end if;
  execute replace(d,old_slot,old_slot||$new$
              and (e.review_reload_barrier_at is null or j.created_at>=e.review_reload_barrier_at)$new$);
end $$;
