do $$
begin
  if exists (
    select 1
    from public.establishment_snapshots
    where source_run_id is not null
    group by establishment_id, provider, source_run_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate establishment snapshot source runs must be resolved before adding the unique constraint';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.establishment_snapshots'::regclass
      and conname = 'establishment_snapshots_establishment_provider_source_run_key'
  ) then
    alter table public.establishment_snapshots
      add constraint establishment_snapshots_establishment_provider_source_run_key
      unique (establishment_id, provider, source_run_id);
  end if;
end
$$;

-- Make the new ON CONFLICT arbiter visible to PostgREST immediately.
notify pgrst, 'reload schema';
