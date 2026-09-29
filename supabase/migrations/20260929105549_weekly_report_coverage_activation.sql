create or replace function private.activate_establishment_reporting_coverage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reporting_started_at is null
    and new.active = true
    and new.sync_status = 'ok'
    and exists (
      select 1
      from public.establishment_snapshots snapshot
      where snapshot.establishment_id = new.id
    )
  then
    new.reporting_started_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.activate_establishment_reporting_coverage() from public, anon, authenticated;

drop trigger if exists establishments_activate_reporting_coverage
  on public.establishments;

create trigger establishments_activate_reporting_coverage
before update of sync_status, active on public.establishments
for each row
when (new.reporting_started_at is null)
execute function private.activate_establishment_reporting_coverage();

comment on function private.activate_establishment_reporting_coverage() is
  'Sets reporting coverage only after an active establishment has completed synchronization and has at least one provider snapshot.';
