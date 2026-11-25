begin;

-- An absent commercial end date and unknown service slots are valid.
alter table private.helpeat_dish_publications
  alter column valid_until drop not null,
  drop constraint helpeat_dish_publications_check1,
  add constraint helpeat_dish_publications_meal_slots_check
    check (meal_slots <@ array['breakfast','lunch','dinner']::text[]);

-- 90 days of elapsed time after verification. A known earlier end date still applies.
-- Replacing this private function preserves its owner and execute grants.
create or replace function private.helpeat_read_catalog()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.helpeat_google_user() is null then
    raise exception 'HELPEAT_CATALOG_AUTH_REQUIRED' using errcode = '42501';
  end if;

  with eligible_places as (
    select p.*, e.organization_id,
      nullif(btrim(g.profile#>>'{identity,name}'), '') as name,
      nullif(btrim(g.profile#>>'{identity,city}'), '') as city,
      case when jsonb_typeof(g.profile#>'{identity,address}') = 'string'
        then nullif(btrim(g.profile#>>'{identity,address}'), '') end as address,
      private.dish_scope(e.id) as dish_scope,
      case when jsonb_typeof(g.profile#>'{identity,coordinates,latitude}') = 'number'
        then (g.profile#>>'{identity,coordinates,latitude}')::numeric end as latitude,
      case when jsonb_typeof(g.profile#>'{identity,coordinates,longitude}') = 'number'
        then (g.profile#>>'{identity,coordinates,longitude}')::numeric end as longitude
    from private.helpeat_restaurant_publications p
    join public.establishments e on e.id = p.establishment_id and e.active
    join private.google_place_profiles g on g.establishment_id = e.id and g.organization_id = e.organization_id
      and g.profile#>>'{identity,cid}' = e.google_id
      and (e.place_id is null or g.profile#>>'{identity,place_id}' = e.place_id)
    where p.published and p.venue_type = 'street_food' and p.reviewed_at <= statement_timestamp()
      and jsonb_typeof(g.profile#>'{identity,name}') = 'string'
      and jsonb_typeof(g.profile#>'{identity,city}') = 'string'
  ), places as (
    select p.*, case when p.latitude between -90 and 90 and p.longitude between -180 and 180
      then 'https://www.google.com/maps/dir/?api=1&destination=' || p.latitude || '%2C' || p.longitude end as maps_url
    from eligible_places p where p.name is not null and p.city is not null
  ), issue_labels(code, vi, fr) as (values
    ('long_wait', 'Chờ lâu', 'Attente longue'),
    ('noise', 'Ồn ào', 'Bruit'),
    ('crowding', 'Đông đúc', 'Forte affluence'),
    ('slow_service', 'Phục vụ chậm', 'Service lent'),
    ('limited_seating', 'Ít chỗ ngồi', 'Places assises limitées')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.establishment_id, 'published', true, 'name', p.name, 'zone', p.city,
    'address', p.address, 'latitude', case when p.maps_url is not null then p.latitude end,
    'longitude', case when p.maps_url is not null then p.longitude end, 'mapsUrl', p.maps_url,
    'venueType', p.venue_type, 'budgetPerPersonVnd', p.budget_per_person_vnd,
    'maxGroupSize', p.max_group_size, 'homeScore', score.value,
    'recurringIssues', coalesce((
      select jsonb_agg(jsonb_build_object('vi', i.vi, 'fr', i.fr) order by i.code)
      from issue_labels i where i.code = any(p.recurring_issues)
    ), '[]'::jsonb),
    'dishes', eligible_dishes.value
  ) order by p.establishment_id), '[]'::jsonb)
  into result
  from places p
  join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'confirmed', true, 'enabled', true,
      'family', a.family, 'meals', a.meal_slots, 'priceVnd', a.price_vnd,
      'verifiedAt', a.verified_at, 'validUntil', a.valid_until
    ) order by d.id) as value
    from private.helpeat_dish_publications a
    join private.restaurant_dishes link on link.scope = a.association_scope and link.dish_id = a.dish_id
      and link.status = 'confirmed' and link.enabled
    join private.dish_names d on d.id = a.dish_id
    where a.establishment_id = p.establishment_id and a.association_scope = p.dish_scope
      and a.approved and a.verified_at >= link.updated_at
      and a.verified_at <= statement_timestamp()
      and a.verified_at > statement_timestamp() - interval '2160 hours'
      and (a.valid_until is null or a.valid_until > statement_timestamp())
  ) eligible_dishes on eligible_dishes.value is not null
  left join lateral (
    select round(s.global_score * 100 / 6, 1) as value
    from public.restaurant_recommendation_sheets s
    where p.publish_score and s.establishment_id = p.establishment_id and s.organization_id = p.organization_id
      and not s.stale and s.global_score between 0 and 6
      and s.calculation->'scale' = '[0,6]'::jsonb and s.calculation->'comparable' = 'true'::jsonb
    order by s.report_generated_at desc nulls last, s.language
    limit 1
  ) score on true;

  return jsonb_build_object('source', 'HOME Reviews', 'version', 1, 'restaurants', result);
end;
$$;

notify pgrst, 'reload schema';
commit;
