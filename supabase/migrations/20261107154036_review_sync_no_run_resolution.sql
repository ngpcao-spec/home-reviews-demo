alter table public.review_sync_jobs add column provider_no_run_confirmed_at timestamptz;

-- Keep the original reservation and its error for audit, while allowing
-- a new slot after the provider account has been checked.
do $$
declare d text;
  old_predicate text := 'q.establishment_id=new.establishment_id and q.provider_start_attempted_at is not null and q.apify_run_id is null';
begin
  d:=pg_get_functiondef('private.freeze_collection_language()'::regprocedure);
  if strpos(d,old_predicate)=0 then raise exception 'SYNC_START_GUARD_CHANGED'; end if;
  execute replace(d,old_predicate,old_predicate||' and q.provider_no_run_confirmed_at is null');
end $$;

do $$
declare d text;
  old_predicate text := 'and x.provider_start_attempted_at is not null and x.apify_run_id is null';
begin
  d:=pg_get_functiondef('public.prepare_review_sync_recovery(uuid,boolean)'::regprocedure);
  if strpos(d,old_predicate)=0 or strpos(d,'  v_slot:=')=0 then
    raise exception 'SYNC_RECOVERY_DEFINITION_CHANGED';
  end if;
  d:=replace(d,old_predicate,old_predicate||' and x.provider_no_run_confirmed_at is null');
  execute replace(d,'  v_slot:=',$recovery$
  if p_no_run_confirmed is true then
    update public.review_sync_jobs set provider_no_run_confirmed_at=clock_timestamp()
    where establishment_id=e.id and status='dead'
      and provider_start_attempted_at is not null and apify_run_id is null
      and provider_no_run_confirmed_at is null;
  end if;
  v_slot:=$recovery$);
end $$;
