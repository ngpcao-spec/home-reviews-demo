-- Shadow catalog. Existing rows, report URLs and RLS policies stay in place.
create table private.shared_restaurants (
  id uuid primary key default gen_random_uuid(),
  place_id text not null unique check (place_id ~ '^ChIJ[[:alnum:]_-]+$'),
  name text not null,
  maps_url text not null
);

create table private.shared_restaurant_subscriptions (
  restaurant_id uuid references private.shared_restaurants on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  language text not null check (language in ('fr','vi')),
  primary key (restaurant_id,organization_id)
);

create table private.shared_restaurant_reviews (
  restaurant_id uuid references private.shared_restaurants on delete cascade,
  external_id text not null,
  published_at timestamptz not null,
  rating integer not null check (rating between 1 and 5),
  original_text text not null,
  primary key (restaurant_id,external_id)
);
create index shared_restaurant_reviews_recent on private.shared_restaurant_reviews
  (restaurant_id,published_at desc,external_id);

create table private.shared_restaurant_review_translations (
  restaurant_id uuid not null,
  external_id text not null,
  language text not null check (language in ('fr','vi')),
  original_text_sha256 text not null,
  translated_text text not null,
  primary key (restaurant_id,external_id,language,original_text_sha256),
  foreign key (restaurant_id,external_id) references private.shared_restaurant_reviews on delete cascade
);

create table private.shared_restaurant_menu_versions (
  restaurant_id uuid references private.shared_restaurants on delete cascade,
  run_id text not null,
  collected_at timestamptz not null,
  raw jsonb not null,
  menu_references jsonb not null,
  provenance jsonb not null,
  primary key (restaurant_id,run_id)
);

-- Reports carry their own frozen evidence, with no FK into the rotating corpus.
create table private.shared_restaurant_report_versions (
  restaurant_id uuid references private.shared_restaurants on delete cascade,
  report_id uuid not null,
  language text not null check (language in ('fr','vi')),
  generated_at timestamptz not null,
  document jsonb not null,
  evidence jsonb not null,
  primary key (restaurant_id,report_id)
);

create table private.shared_restaurant_collections (
  restaurant_id uuid references private.shared_restaurants on delete cascade,
  language text check (language in ('fr','vi')),
  initialized_at timestamptz,
  last_success_at timestamptz,
  primary key (restaurant_id,language)
);

create table private.shared_restaurant_collection_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  language text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','unknown')),
  foreign key (restaurant_id,language) references private.shared_restaurant_collections
);
-- Unknown provider outcomes occupy the slot until reconciled.
create unique index shared_restaurant_one_active_collection on private.shared_restaurant_collection_jobs
  (restaurant_id,language) where status in ('queued','running','unknown');

create table private.shared_restaurant_analysis_jobs (
  restaurant_id uuid references private.shared_restaurants on delete cascade,
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  language text check (language in ('fr','vi')),
  model text,
  configuration_sha256 text check (configuration_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'reserved' check (state in ('reserved','completed','failed','unknown')),
  result jsonb,
  check ((state='completed')=(result is not null)),
  primary key (restaurant_id,content_sha256,language,model,configuration_sha256)
);

-- Server-only. Callers must resolve and verify the Google Place ID first.
create function public.subscribe_verified_shared_restaurant(
  p_place_id text,p_name text,p_maps_url text,p_org uuid,p_user uuid,p_language text
) returns uuid language plpgsql security definer set search_path='' as $$
declare restaurant uuid;
begin
  if not exists(select 1 from public.organization_members
    where organization_id=p_org and user_id=p_user and role in ('owner','admin','manager'))
  then raise exception 'FORBIDDEN'; end if;
  insert into private.shared_restaurants(place_id,name,maps_url)
  values(p_place_id,p_name,p_maps_url) on conflict(place_id) do nothing;
  select id into strict restaurant from private.shared_restaurants where place_id=p_place_id for update;
  insert into private.shared_restaurant_subscriptions values(restaurant,p_org,p_language)
  on conflict (restaurant_id,organization_id) do update set language=excluded.language;
  insert into private.shared_restaurant_collections(restaurant_id,language)
  values(restaurant,p_language) on conflict do nothing;
  return restaurant;
end $$;

create function public.read_shared_restaurant(p_org uuid,p_restaurant uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'identity',jsonb_build_object('id',r.id,'placeId',r.place_id,'name',r.name,'mapsUrl',r.maps_url),
    'reviews',coalesce((select jsonb_agg((to_jsonb(v)-'restaurant_id')||jsonb_build_object('translations',
      coalesce((select jsonb_object_agg(t.language,t.translated_text)
        from private.shared_restaurant_review_translations t
        where t.restaurant_id=r.id and t.external_id=v.external_id
          and t.original_text_sha256=encode(sha256(convert_to(v.original_text,'UTF8')),'hex')),'{}'::jsonb))
      order by v.published_at desc,v.external_id)
      from (select * from private.shared_restaurant_reviews where restaurant_id=r.id
        order by published_at desc,external_id limit 150) v),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(jsonb_build_object('id',v.report_id,'language',v.language,
      'generatedAt',v.generated_at,'document',v.document) order by v.generated_at desc,v.report_id)
      from private.shared_restaurant_report_versions v where v.restaurant_id=r.id
        and exists(select 1 from public.organization_members where organization_id=p_org
          and user_id=(select auth.uid()) and role in ('owner','admin','manager'))),'[]'::jsonb),
    'menu',(select jsonb_build_object('runId',m.run_id,'collectedAt',m.collected_at,'references',m.menu_references)
      from private.shared_restaurant_menu_versions m where m.restaurant_id=r.id
      order by m.collected_at desc,m.run_id limit 1)
  )
  from private.shared_restaurants r
  join private.shared_restaurant_subscriptions s on s.restaurant_id=r.id
  where r.id=p_restaurant and s.organization_id=p_org
    and exists(select 1 from public.organization_members where organization_id=p_org and user_id=(select auth.uid()));
$$;

revoke all on function public.subscribe_verified_shared_restaurant(text,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.subscribe_verified_shared_restaurant(text,text,text,uuid,uuid,text) to service_role;
revoke all on function public.read_shared_restaurant(uuid,uuid) from public,anon;
grant execute on function public.read_shared_restaurant(uuid,uuid) to authenticated;
