-- Additive and disabled until the complete cutover has been validated.
create table private.shared_restaurant_runtime (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.shared_restaurant_runtime values(true,false);

create table private.shared_restaurant_establishments (
  establishment_id uuid primary key references public.establishments on delete cascade,
  restaurant_id uuid not null references private.shared_restaurants,
  organization_id uuid not null references public.organizations,
  subscribed_at timestamptz not null default now(),
  unique(restaurant_id,organization_id)
);
create index shared_restaurant_establishments_restaurant on private.shared_restaurant_establishments(restaurant_id);

create table private.shared_restaurant_operations (
  key text primary key check(key ~ '^[0-9a-f]{64}$'),
  owner uuid not null,
  state text not null check(state in ('running','completed','unknown')),
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check((state='completed')=(result is not null))
);
alter table private.shared_restaurant_runtime enable row level security;
alter table private.shared_restaurant_establishments enable row level security;
alter table private.shared_restaurant_operations enable row level security;

create function public.shared_restaurant_runtime_enabled()
returns boolean language sql stable security definer set search_path='' as $$
  select enabled from private.shared_restaurant_runtime where singleton;
$$;

create function public.reserve_shared_operation(p_key text,p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item private.shared_restaurant_operations; inserted integer;
begin
  if not public.shared_restaurant_runtime_enabled() then raise exception 'SHARED_RUNTIME_DISABLED'; end if;
  insert into private.shared_restaurant_operations(key,owner,state) values(p_key,p_owner,'running')
    on conflict(key) do nothing;
  get diagnostics inserted=row_count;
  if inserted=1 then return '{"state":"owner"}'::jsonb; end if;
  select * into strict item from private.shared_restaurant_operations where key=p_key;
  -- Even the same owner must not call the provider twice.
  return jsonb_build_object('state',case when item.state='completed' then 'completed'
    when item.state='unknown' then 'blocked' else 'waiting' end,'result',item.result);
end $$;

create function public.finish_shared_operation(p_key text,p_owner uuid,p_result jsonb,p_unknown boolean default false)
returns boolean language sql security definer set search_path='' as $$
  with saved as (
    update private.shared_restaurant_operations set
      state=case when p_unknown then 'unknown' else 'completed' end,
      result=case when p_unknown then null else p_result end,finished_at=now()
    where key=p_key and owner=p_owner and state='running'
      and (p_unknown or p_result is not null) returning 1
  ) select exists(select 1 from saved);
$$;

-- Attach only a server-verified legacy identity. No name matching or private-row sharing.
create function public.attach_verified_shared_establishment(p_establishment uuid,p_place text,p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare restaurant uuid; e public.establishments;
begin
  if not public.shared_restaurant_runtime_enabled() then return null; end if;
  restaurant:=public.seed_verified_shared_restaurant(p_establishment,p_place,p_user);
  select * into strict e from public.establishments where id=p_establishment;
  insert into private.shared_restaurant_establishments(establishment_id,restaurant_id,organization_id)
  values(e.id,restaurant,e.organization_id) on conflict(establishment_id) do nothing;
  if not exists(select 1 from private.shared_restaurant_establishments
    where establishment_id=e.id and restaurant_id=restaurant and organization_id=e.organization_id)
  then raise exception 'SHARED_IDENTITY_CHANGED'; end if;
  return restaurant;
end $$;

create function public.shared_restaurant_for_establishment(p_establishment uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select l.restaurant_id from private.shared_restaurant_establishments l
  join public.establishments e on e.id=l.establishment_id and e.active
  join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=e.organization_id
  where e.id=p_establishment and public.shared_restaurant_runtime_enabled();
$$;

-- Metadata + raw menu remain common, and only menu-specific fields leave the server.
create function public.read_shared_establishment_menu(p_establishment uuid,p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('result',m.menu_references,'runId',m.run_id,'collectedAt',m.collected_at)
  from private.shared_restaurant_establishments l
  join public.establishments e on e.id=l.establishment_id and e.active
  join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=e.organization_id
  join private.shared_restaurant_menu_versions m on m.restaurant_id=l.restaurant_id
  where e.id=p_establishment and public.shared_restaurant_runtime_enabled()
    and exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=p_user)
  order by m.collected_at desc,m.run_id limit 1;
$$;

create function private.capture_shared_rainminer_menu() returns trigger
language plpgsql security definer set search_path='' as $$
declare restaurant uuid;
begin
  if new.status<>'completed' or new.raw is null or new.result is null or new.run_id is null
    or not public.shared_restaurant_runtime_enabled() then return new; end if;
  select restaurant_id into restaurant from private.shared_restaurant_establishments where establishment_id=new.establishment_id;
  if restaurant is null then return new; end if;
  if not exists(select 1 from private.shared_restaurants where id=restaurant and place_id=new.place_id)
    then raise exception 'SHARED_MENU_PLACE_MISMATCH'; end if;
  insert into private.shared_restaurant_menu_versions(restaurant_id,run_id,collected_at,raw,menu_references,provenance)
  values(restaurant,new.run_id,new.created_at,new.raw,new.result,
    jsonb_build_object('actor','rainminer/google-maps-menu-scraper','legacyJobId',new.id))
  on conflict(restaurant_id,run_id) do update set menu_references=excluded.menu_references;
  return new;
end $$;
create trigger capture_shared_rainminer_menu after insert or update of status,result
on public.rainminer_menu_jobs for each row execute function private.capture_shared_rainminer_menu();

-- Existing completed imports are copied explicitly, with their exact raw payload.
create function public.seed_shared_establishment_menus(p_establishment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare restaurant uuid; copied integer;
begin
  restaurant:=public.shared_restaurant_for_establishment(p_establishment);
  if restaurant is null then return 0; end if;
  insert into private.shared_restaurant_menu_versions(restaurant_id,run_id,collected_at,raw,menu_references,provenance)
  select restaurant,j.run_id,j.created_at,j.raw,j.result,
    jsonb_build_object('actor','rainminer/google-maps-menu-scraper','legacyJobId',j.id)
  from public.rainminer_menu_jobs j join private.shared_restaurants r on r.id=restaurant and r.place_id=j.place_id
  where j.establishment_id=p_establishment and j.status='completed' and j.run_id is not null
    and j.raw is not null and j.result is not null on conflict(restaurant_id,run_id) do nothing;
  get diagnostics copied=row_count;
  return copied;
end $$;

revoke all on function public.shared_restaurant_runtime_enabled(),public.reserve_shared_operation(text,uuid),
  public.finish_shared_operation(text,uuid,jsonb,boolean),public.attach_verified_shared_establishment(uuid,text,uuid),
  public.shared_restaurant_for_establishment(uuid),public.read_shared_establishment_menu(uuid,uuid),
  public.seed_shared_establishment_menus(uuid) from public,anon,authenticated;
grant execute on function public.shared_restaurant_runtime_enabled(),public.reserve_shared_operation(text,uuid),
  public.finish_shared_operation(text,uuid,jsonb,boolean),public.attach_verified_shared_establishment(uuid,text,uuid),
  public.shared_restaurant_for_establishment(uuid),public.read_shared_establishment_menu(uuid,uuid),
  public.seed_shared_establishment_menus(uuid) to service_role;
revoke all on private.shared_restaurant_runtime,private.shared_restaurant_establishments,
  private.shared_restaurant_operations from anon,authenticated;

alter function public.enqueue_rainminer_menu(uuid,uuid,uuid) rename to enqueue_rainminer_menu_before_sharing;
create function public.enqueue_rainminer_menu(p_establishment uuid,p_request uuid,p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare restaurant uuid; job uuid; org uuid;
begin
  restaurant:=public.shared_restaurant_for_establishment(p_establishment);
  if restaurant is null then return public.enqueue_rainminer_menu_before_sharing(p_establishment,p_request,p_user); end if;
  select organization_id into strict org from public.establishments where id=p_establishment and active;
  if not exists(select 1 from public.organization_members where organization_id=org and user_id=p_user
    and role in ('owner','admin','manager')) then raise exception 'MENU_FORBIDDEN'; end if;
  -- Same lock as the legacy queue, including non-shared requests.
  perform pg_advisory_xact_lock(75302143);
  select j.id into job from public.rainminer_menu_jobs j
    join private.shared_restaurant_establishments l on l.establishment_id=j.establishment_id
    join private.shared_restaurants r on r.id=l.restaurant_id and r.place_id=j.place_id
    where r.id=restaurant and j.status in ('queued','starting','running','unknown','completed')
    order by (j.status<>'completed') desc,j.created_at desc,j.id limit 1;
  if job is not null then return job; end if;
  return public.enqueue_rainminer_menu_before_sharing(p_establishment,p_request,p_user);
end $$;
revoke all on function public.enqueue_rainminer_menu(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_rainminer_menu(uuid,uuid,uuid) to service_role;
