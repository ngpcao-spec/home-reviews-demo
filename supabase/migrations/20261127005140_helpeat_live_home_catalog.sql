begin;

-- Read HOME Reviews' published result and active dish associations without
-- running classification, touching imports, or exporting the underlying data.
create or replace function private.helpeat_read_catalog()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.helpeat_google_user() is null then
    raise exception 'HELPEAT_CATALOG_AUTH_REQUIRED' using errcode = '42501';
  end if;

  with places as (
    select e.id, e.organization_id, t.scope, t.published_source_run, p.specialty_id,
      coalesce(nullif(btrim(g.profile#>>'{identity,name}'), ''), e.name) as name,
      nullif(btrim(g.profile#>>'{identity,city}'), '') as zone,
      coalesce(nullif(btrim(g.profile#>>'{identity,address}'), ''), e.address) as address,
      case when jsonb_typeof(g.profile#>'{identity,coordinates,latitude}') = 'number'
        then (g.profile#>>'{identity,coordinates,latitude}')::numeric end as latitude,
      case when jsonb_typeof(g.profile#>'{identity,coordinates,longitude}') = 'number'
        then (g.profile#>>'{identity,coordinates,longitude}')::numeric end as longitude,
      case when e.google_maps_url ~ '^https://(www[.]google[.]com/maps/|maps[.]app[.]goo[.]gl/)'
        then e.google_maps_url end as maps_url,
      case when e.photo_url ~ '^https://[A-Za-z0-9.-]+/[^?#[:space:]]+$' then e.photo_url end as photo_url,
      g.profile#>'{hours,weekly}' as weekly_hours
    from private.menu_dish_ai_targets t
    join private.menu_dish_ai_runs r on r.id = t.published_id and r.status = 'succeeded'
    join public.establishments e on e.id = t.establishment_id and e.active and e.place_id = r.place_id
    left join private.restaurant_dish_profiles p on p.scope = t.scope
    left join private.google_place_profiles g on g.establishment_id = e.id and g.organization_id = e.organization_id
      and g.profile#>>'{identity,cid}' = e.google_id and g.profile#>>'{identity,place_id}' = e.place_id
    where r.result#>>'{restaurant_type,value}' = 'street_food'
      and t.scope = private.dish_scope(e.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'zone', p.zone, 'address', p.address,
    'venueType', 'street_food', 'photoUrl', p.photo_url, 'specialty', dishes.specialty,
    'latitude', p.latitude, 'longitude', p.longitude, 'mapsUrl', p.maps_url,
    'homeScore', score.global_score, 'homeScoreMax', 6, 'hours', hours.value,
    'dishes', dishes.value
  ) order by p.id), '[]'::jsonb)
  into result
  from places p
  join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'enabled', true,
      'priceVnd', price.low, 'maxPriceVnd', price.high
    ) order by (d.id = p.specialty_id) desc nulls last, d.name, d.id) as value,
      max(d.name) filter (where d.id = p.specialty_id) as specialty
    from private.restaurant_dishes a
    join private.dish_names d on d.id = a.dish_id
    left join lateral (
      select min(amount) as low, max(amount) as high
      from (
        select case when jsonb_typeof(m.original->'price') = 'number'
          then (m.original->>'price')::numeric end as amount
        from private.dish_menu_evidence m
        where m.scope = p.scope and m.run_id = p.published_source_run
          and m.dish_id = d.id and m.decision = 'associated' and m.original->>'currency' = 'VND'
      ) v where amount > 0
    ) price on true
    where a.scope = p.scope and a.enabled
  ) dishes on dishes.value is not null
  left join lateral (
    select s.global_score
    from public.restaurant_recommendation_sheets s
    where s.establishment_id = p.id and s.organization_id = p.organization_id
      and not s.stale and s.global_score is not null
    order by s.report_generated_at desc nulls last, s.language
    limit 1
  ) score on true
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', day->'day', 'status', day->'status',
      'intervals', (select coalesce(jsonb_agg(jsonb_build_object('start', w->'start', 'end', w->'end')), '[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(day->'intervals') = 'array'
          then day->'intervals' else '[]'::jsonb end) w)
    ) order by day->'day'), '[]'::jsonb) as value
    from jsonb_array_elements(case when jsonb_typeof(p.weekly_hours) = 'array'
      then p.weekly_hours else '[]'::jsonb end) day
    where day->>'status' in ('parsed', 'closed')
  ) hours;

  return jsonb_build_object('source', 'HOME Reviews', 'version', 1, 'restaurants', result);
end;
$$;

notify pgrst, 'reload schema';
commit;
