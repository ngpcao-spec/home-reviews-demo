-- Explicit, server-only seeding after verification. This is not a blanket
-- backfill: the existing organization, reports, reviews and URLs are untouched.
create function public.seed_verified_shared_restaurant(
  p_establishment uuid,p_verified_place_id text,p_user uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.establishments; restaurant uuid;
begin
  select * into e from public.establishments where id=p_establishment and active;
  if not found or p_verified_place_id is null or e.place_id is distinct from p_verified_place_id
  then raise exception 'SHARED_SEED_IDENTITY_MISMATCH'; end if;
  restaurant:=public.subscribe_verified_shared_restaurant(
    e.place_id,e.name,e.google_maps_url,e.organization_id,p_user,e.collection_language);
  insert into private.shared_restaurant_reviews(restaurant_id,external_id,published_at,rating,original_text)
  select restaurant,r.external_review_id,r.published_at,r.rating,coalesce(r.original_text,'')
  from public.reviews r where r.establishment_id=e.id and r.organization_id=e.organization_id
    and r.published_at is not null
  order by r.published_at desc,r.external_review_id limit 150
  on conflict (restaurant_id,external_id) do nothing;
  delete from private.shared_restaurant_reviews r using (
    select external_id from private.shared_restaurant_reviews where restaurant_id=restaurant
    order by published_at desc,external_id offset 150
  ) obsolete where r.restaurant_id=restaurant and r.external_id=obsolete.external_id;
  if e.review_collection_status='complete' and e.last_sync_at is not null
    and exists(select 1 from private.shared_restaurant_reviews
      where restaurant_id=restaurant and external_id=e.last_review_id and published_at=e.last_review_at)
  then
    update private.shared_restaurant_collections set
      initialized_at=coalesce(initialized_at,e.last_sync_at),
      last_success_at=greatest(last_success_at,e.last_sync_at)
    where restaurant_id=restaurant and language=e.collection_language;
  end if;
  return restaurant;
end $$;

revoke all on function public.seed_verified_shared_restaurant(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.seed_verified_shared_restaurant(uuid,text,uuid) to service_role;
