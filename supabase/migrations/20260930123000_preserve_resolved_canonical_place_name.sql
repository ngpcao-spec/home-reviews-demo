alter table public.initial_import_jobs
  add column if not exists resolved_place_url text;

drop function if exists public.checkpoint_initial_import_job(
  uuid,text,text,text,uuid,integer,integer,integer,integer
);

create function public.checkpoint_initial_import_job(
  p_job_id uuid,
  p_worker_id text,
  p_provider_run_id text default null,
  p_provider_dataset_id text default null,
  p_establishment_id uuid default null,
  p_reviews_fetched integer default null,
  p_reviews_inserted integer default null,
  p_provider_requests integer default 0,
  p_lease_seconds integer default 240,
  p_resolved_place_url text default null
) returns boolean
language sql
security definer
set search_path=''
as $$
  with u as (
    update public.initial_import_jobs set
      provider_run_id=coalesce(p_provider_run_id,provider_run_id),
      provider_dataset_id=coalesce(p_provider_dataset_id,provider_dataset_id),
      resolved_place_url=coalesce(nullif(trim(p_resolved_place_url),''),resolved_place_url),
      establishment_id=coalesce(p_establishment_id,establishment_id),
      reviews_fetched=coalesce(p_reviews_fetched,reviews_fetched),
      reviews_inserted=coalesce(p_reviews_inserted,reviews_inserted),
      provider_requests=provider_requests+greatest(coalesce(p_provider_requests,0),0),
      lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),
      updated_at=now()
    where id=p_job_id
      and status='running'
      and locked_by=left(p_worker_id,120)
      and lease_until>now()
    returning 1
  )
  select exists(select 1 from u)
$$;

revoke all on function public.checkpoint_initial_import_job(
  uuid,text,text,text,uuid,integer,integer,integer,integer,text
) from public,anon,authenticated;

grant execute on function public.checkpoint_initial_import_job(
  uuid,text,text,text,uuid,integer,integer,integer,integer,text
) to service_role;
