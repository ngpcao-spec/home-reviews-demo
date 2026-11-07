-- A terminal failure closes its scheduled slot. Recovery opens a different
-- slot for a single establishment after an operator reconciles Apify.
create index if not exists review_sync_jobs_terminal_slot_idx
  on public.review_sync_jobs(establishment_id,scheduled_for,created_at desc)
  where status='dead';

create or replace function public.enqueue_due_review_sync_jobs(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  with due as (
    select e.id,e.organization_id,e.next_sync_at,e.last_review_id,e.last_review_at
    from public.establishments e
    where e.active and e.next_sync_at<=now()
      and e.last_sync_status is distinct from 'error'
      and not exists (
        select 1 from public.review_sync_jobs j where j.establishment_id=e.id
          and (j.status in ('queued','running','retry')
            or (j.status='dead' and j.scheduled_for=e.next_sync_at))
      )
    order by e.next_sync_at,e.id
    for update of e skip locked
    limit least(greatest(coalesce(p_limit,1000),1),10000)
  ), ins as (
    insert into public.review_sync_jobs(
      establishment_id,organization_id,scheduled_for,available_at,
      checkpoint_review_id,checkpoint_review_at)
    select id,organization_id,next_sync_at,now(),last_review_id,last_review_at from due
    on conflict do nothing returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end $$;

-- The exact dead job is an idempotency key. An operator must reconcile all
-- ambiguous starts for the establishment before attesting no run was created.
create function public.prepare_review_sync_recovery(p_dead_job uuid,p_no_run_confirmed boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;
  j public.review_sync_jobs%rowtype;
  v_slot timestamptz;
  v_job uuid;
begin
  select * into j from public.review_sync_jobs where id=p_dead_job;
  if not found or j.status<>'dead' then raise exception 'SYNC_RECOVERY_JOB_NOT_DEAD'; end if;
  select * into e from public.establishments where id=j.establishment_id for update;
  if not e.active or e.next_sync_at is distinct from j.scheduled_for
    or e.review_collection_status is distinct from 'complete'
    or e.last_review_id is null or e.last_review_at is null
    or exists(select 1 from public.review_sync_jobs x where x.establishment_id=e.id
      and (x.status in ('queued','running','retry')
        or (x.status='dead' and x.scheduled_for=j.scheduled_for and (x.created_at,x.id)>(j.created_at,j.id))))
  then raise exception 'SYNC_RECOVERY_SLOT_CHANGED'; end if;
  if p_no_run_confirmed is not true and exists(
    select 1 from public.review_sync_jobs x where x.establishment_id=e.id
      and x.provider_start_attempted_at is not null and x.apify_run_id is null
  ) then raise exception 'APIFY_START_OUTCOME_UNKNOWN'; end if;
  v_slot:=greatest(clock_timestamp(),e.next_sync_at+interval '1 microsecond');
  insert into public.review_sync_jobs(
    establishment_id,organization_id,scheduled_for,available_at,checkpoint_review_id,checkpoint_review_at)
  values(e.id,e.organization_id,v_slot,v_slot,e.last_review_id,e.last_review_at)
  returning id into v_job;
  if v_job is null then raise exception 'SYNC_RECOVERY_QUEUE_REJECTED'; end if;
  update public.establishments set next_sync_at=v_slot,sync_status='pending',last_sync_status='pending',
    sync_error=null,last_sync_error=null where id=e.id;
  return v_job;
end $$;
revoke all on function public.prepare_review_sync_recovery(uuid,boolean) from public,anon,authenticated;
grant execute on function public.prepare_review_sync_recovery(uuid,boolean) to service_role;
