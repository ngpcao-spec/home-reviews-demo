create or replace function public.set_monitoring_interval(p_hours smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if p_hours not in (1, 3, 6, 12, 24) then
    raise exception 'INVALID_MONITORING_INTERVAL';
  end if;

  select organization_id
  into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and role in ('owner', 'admin')
  order by created_at asc
  limit 1;

  if v_organization_id is null then
    raise exception 'FORBIDDEN';
  end if;

  update public.organizations
  set monitoring_interval_hours = p_hours
  where id = v_organization_id;

  update public.establishments
  set next_sync_at = coalesce(last_sync_at, now()) + make_interval(hours => p_hours)
  where organization_id = v_organization_id
    and active = true;

  return p_hours;
end;
$$;

revoke all on function public.set_monitoring_interval(smallint) from public, anon;
grant execute on function public.set_monitoring_interval(smallint) to authenticated;

update public.establishments as establishment
set next_sync_at = coalesce(establishment.last_sync_at, now())
  + make_interval(hours => organization.monitoring_interval_hours)
from public.organizations as organization
where establishment.organization_id = organization.id
  and establishment.active = true;
