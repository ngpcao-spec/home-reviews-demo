create table private.shared_restaurant_resolutions (
  google_id text primary key,
  restaurant_id uuid not null references private.shared_restaurants,
  place jsonb not null
);
create table private.shared_restaurant_initial_sources (
  restaurant_id uuid not null references private.shared_restaurants,
  language text not null check(language in ('fr','vi')),
  configuration text not null,
  leader_job uuid not null,
  result jsonb,
  completed_at timestamptz,
  primary key(restaurant_id,language,configuration)
);
alter table private.shared_restaurant_resolutions enable row level security;
alter table private.shared_restaurant_initial_sources enable row level security;

create function public.register_shared_restaurant_resolution(p_place jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare restaurant uuid; google text:=p_place->>'googleId';
begin
  if not public.shared_restaurant_runtime_enabled() then return null; end if;
  if coalesce(p_place->>'placeId','') !~ '^ChIJ[[:alnum:]_-]+$' or nullif(google,'') is null
    or nullif(p_place->>'name','') is null then raise exception 'SHARED_VERIFIED_IDENTITY_REQUIRED'; end if;
  insert into private.shared_restaurants(place_id,name,maps_url)
    values(p_place->>'placeId',p_place->>'name',coalesce(p_place->>'locationLink','https://www.google.com/maps?query_place_id='||(p_place->>'placeId')))
    on conflict(place_id) do nothing;
  select id into strict restaurant from private.shared_restaurants where place_id=p_place->>'placeId';
  insert into private.shared_restaurant_resolutions values(google,restaurant,p_place) on conflict(google_id) do nothing;
  if not exists(select 1 from private.shared_restaurant_resolutions where google_id=google and restaurant_id=restaurant)
    then raise exception 'SHARED_GOOGLE_ID_CONFLICT'; end if;
  return restaurant;
end $$;

create function public.read_shared_restaurant_resolution(p_place_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select v.place from private.shared_restaurant_resolutions v
    join private.shared_restaurants r on r.id=v.restaurant_id
  where r.place_id=p_place_id and public.shared_restaurant_runtime_enabled() order by v.google_id limit 1;
$$;

create function public.reserve_shared_initial_import(p_job uuid,p_configuration text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs; restaurant uuid; source private.shared_restaurant_initial_sources; leader public.initial_import_jobs;
begin
  if not public.shared_restaurant_runtime_enabled() then return '{"state":"legacy"}'; end if;
  select * into strict j from public.initial_import_jobs where id=p_job;
  if j.request_kind<>'initial' then return '{"state":"legacy"}'; end if;
  select restaurant_id into restaurant from private.shared_restaurant_resolutions where google_id=j.expected_google_id;
  if restaurant is null then raise exception 'SHARED_VERIFIED_IDENTITY_REQUIRED'; end if;
  perform 1 from private.shared_restaurants where id=restaurant for update;
  insert into private.shared_restaurant_initial_sources(restaurant_id,language,configuration,leader_job)
    values(restaurant,j.preferred_language,p_configuration,j.id) on conflict do nothing;
  select * into strict source from private.shared_restaurant_initial_sources
    where restaurant_id=restaurant and language=j.preferred_language and configuration=p_configuration;
  if source.result is not null then return jsonb_build_object('state','completed','result',source.result); end if;
  if source.leader_job=j.id then return jsonb_build_object('state','owner'); end if;
  select * into leader from public.initial_import_jobs where id=source.leader_job;
  return jsonb_build_object('state',case when leader.id is null or leader.status='failed' then 'blocked' else 'waiting' end);
end $$;

create function public.complete_shared_initial_import(p_job uuid,p_configuration text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs; restaurant uuid; n integer;
begin
  if not public.shared_restaurant_runtime_enabled() then return false; end if;
  select * into strict j from public.initial_import_jobs where id=p_job;
  select r.id into restaurant from private.shared_restaurants r join private.shared_restaurant_resolutions x on x.restaurant_id=r.id
    where x.google_id=j.expected_google_id and r.place_id=p_result#>>'{establishment,placeId}'
      and x.google_id=p_result#>>'{establishment,googleId}';
  if restaurant is null or jsonb_typeof(p_result->'reviews')<>'array' then raise exception 'SHARED_INITIAL_RESULT_MISMATCH'; end if;
  update private.shared_restaurant_initial_sources set result=p_result,completed_at=now()
    where restaurant_id=restaurant and language=j.preferred_language and configuration=p_configuration
      and leader_job=j.id and result is null;
  get diagnostics n=row_count;
  return n=1;
end $$;

revoke all on function public.register_shared_restaurant_resolution(jsonb),public.read_shared_restaurant_resolution(text),
  public.reserve_shared_initial_import(uuid,text),public.complete_shared_initial_import(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_shared_restaurant_resolution(jsonb),public.read_shared_restaurant_resolution(text),
  public.reserve_shared_initial_import(uuid,text),public.complete_shared_initial_import(uuid,text,jsonb) to service_role;
