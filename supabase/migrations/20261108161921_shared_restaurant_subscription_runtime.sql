alter function public.attach_verified_shared_establishment(uuid,text,uuid) rename to attach_verified_shared_establishment_before_content;
create function public.attach_verified_shared_establishment(p_establishment uuid,p_place text,p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare restaurant uuid;e public.establishments;
begin
 restaurant:=public.attach_verified_shared_establishment_before_content(p_establishment,p_place,p_user);
 if restaurant is null then return null; end if;
 select * into strict e from public.establishments where id=p_establishment;
 perform public.register_shared_restaurant_resolution(jsonb_build_object('placeId',e.place_id,'googleId',e.google_id,'name',e.name,
  'locationLink',e.google_maps_url,'fullAddress',e.address,'rating',e.rating,'totalReviews',e.total_reviews,'photo',e.photo_url));
 perform public.capture_shared_review_corpus(e.id);
 perform public.seed_shared_establishment_menus(e.id);
 return restaurant;
end $$;

create function public.join_available_shared_restaurant(p_org uuid,p_user uuid,p_google text,p_language text,p_query text,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare restaurant uuid;e public.establishments;source public.establishments;j public.initial_import_jobs;head record;n integer;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN'; end if;
 if not public.shared_restaurant_runtime_enabled() then return null; end if;
 if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN'; end if;
 select restaurant_id into restaurant from private.shared_restaurant_resolutions where google_id=p_google;
 if restaurant is null then return null; end if;
 perform 1 from private.shared_restaurants where id=restaurant for update;
 select x.* into source from private.shared_restaurant_establishments l join public.establishments x on x.id=l.establishment_id
  where l.restaurant_id=restaurant and x.review_collection_status='complete'
  order by x.last_sync_at desc nulls last,x.id limit 1;
 if source.id is null then return null; end if;
 perform public.capture_shared_review_corpus(source.id);
 select * into e from public.establishments where organization_id=p_org and google_id=p_google;
 if e.id is not null and e.active then
  select * into j from public.initial_import_jobs where id=e.initial_import_job_id;
  if j.id is not null then return jsonb_build_object('importJobId',j.id,'status',j.status,'establishmentId',e.id,'shared',true); end if;
  raise exception 'ESTABLISHMENT_ALREADY_ADDED';
 end if;
 if e.id is null then
  j:=public.enqueue_initial_import_job(p_org,p_user,p_query,p_google,p_language,p_candidate);
  insert into public.establishments(organization_id,google_id,place_id,name,google_maps_url,address,rating,total_reviews,photo_url,active,initial_import_job_id)
   values(p_org,source.google_id,source.place_id,source.name,source.google_maps_url,source.address,source.rating,source.total_reviews,source.photo_url,true,j.id)
   returning * into e;
 else
  -- Rejoin retains IDs; the previous subscription's private data was cleared on removal.
  select * into j from public.initial_import_jobs where id=e.initial_import_job_id;
  if j.id is null then raise exception 'SHARED_REJOIN_IMPORT_REFERENCE_MISSING'; end if;
  update public.establishments set active=true where id=e.id;
 end if;
 perform public.subscribe_verified_shared_restaurant(source.place_id,source.name,source.google_maps_url,p_org,p_user,e.collection_language);
 insert into private.shared_restaurant_establishments(establishment_id,restaurant_id,organization_id)
  values(e.id,restaurant,p_org) on conflict(establishment_id) do update set subscribed_at=now();
 perform public.ingest_recent_reviews(e.id,p_org,public.shared_review_projection_bundle(e.id,true),'apify');
 select count(*) into n from public.reviews where establishment_id=e.id;
 select external_review_id,published_at into head from public.reviews where establishment_id=e.id order by published_at desc,external_review_id limit 1;
 update public.establishments set active=true,initialized_at=coalesce(initialized_at,now()),last_sync_at=source.last_sync_at,
  next_sync_at=now(),last_review_id=head.external_review_id,last_review_at=head.published_at,
  sync_status='ok',sync_error=null,last_sync_status='ok',last_sync_error=null,
  review_collection_status='complete',review_collection_unique=n,review_collection_expected=n,review_collection_checked_at=now()
  where id=e.id;
 update public.initial_import_jobs set establishment_id=e.id,status='completed',finished_at=now(),updated_at=now(),
  reviews_fetched=n,reviews_inserted=n,result=jsonb_build_object('establishmentId',e.id,'inserted',n,'shared',true),
  lease_until=null,locked_by=null where id=j.id;
 return jsonb_build_object('importJobId',j.id,'status','completed','establishmentId',e.id,'shared',true);
end $$;

create function public.remove_establishment_subscription(p_establishment uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.establishments;restaurant uuid;
begin
 select * into e from public.establishments where id=p_establishment;
 if not found or not exists(select 1 from public.organization_members where organization_id=e.organization_id
  and user_id=(select auth.uid()) and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN'; end if;
 select restaurant_id into restaurant from private.shared_restaurant_establishments where establishment_id=e.id;
 if restaurant is null then delete from public.establishments where id=e.id;return e.id;end if;
 perform pg_advisory_xact_lock(75302144);
 perform 1 from private.shared_restaurants where id=restaurant for update;
 perform public.capture_shared_review_corpus(e.id);
 perform public.seed_shared_establishment_menus(e.id);
 delete from private.shared_restaurant_subscriptions where restaurant_id=restaurant and organization_id=e.organization_id;
 update public.establishments set active=false,next_sync_at=null where id=e.id;
 delete from public.notifications where establishment_id=e.id and organization_id=e.organization_id;
 delete from public.review_reply_drafts where review_id in(select id from public.reviews where establishment_id=e.id);
 update public.reviews set reply_draft_text=null,reply_draft_language=null,reply_draft_updated_at=null,reply_draft_version=0,
  status=case when requires_attention or requires_ai_analysis then 'to_process' else 'ignored' end where establishment_id=e.id;
 return e.id;
end $$;

-- Existing RLS policies remain the authority for organization/user scope. This
-- additional restriction revokes the departed account's old direct row links.
create function public.shared_projection_available(p_establishment uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.shared_restaurant_establishments where establishment_id=p_establishment)
 or exists(select 1 from private.shared_restaurant_establishments l
  join public.establishments e on e.id=l.establishment_id and e.active
  join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=l.organization_id
  where l.establishment_id=p_establishment);
$$;
revoke all on function public.shared_projection_available(uuid) from public,anon;
grant execute on function public.shared_projection_available(uuid) to authenticated,service_role;
create policy subscribed_review_visibility on public.reviews as restrictive for all to authenticated
 using(public.shared_projection_available(establishment_id))
 with check(public.shared_projection_available(establishment_id));
create policy subscribed_draft_visibility on public.review_reply_drafts as restrictive for all to authenticated
 using(exists(select 1 from public.reviews r where r.id=review_id))
 with check(exists(select 1 from public.reviews r where r.id=review_id));

grant select on private.shared_restaurant_resolutions,private.shared_restaurant_reviews to service_role;
grant insert,update on private.shared_restaurant_establishments to service_role;
revoke all on function public.attach_verified_shared_establishment(uuid,text,uuid),public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.attach_verified_shared_establishment(uuid,text,uuid),public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb) to service_role;
revoke all on function public.remove_establishment_subscription(uuid) from public,anon;
grant execute on function public.remove_establishment_subscription(uuid) to authenticated;

alter function public.reserve_incremental_review_sync(uuid,text,jsonb,text) rename to reserve_incremental_review_sync_before_sharing;
create function public.reserve_incremental_review_sync(p_job uuid,p_worker text,p_input jsonb,p_build text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.review_sync_jobs;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN'; end if;
 select * into strict j from public.review_sync_jobs where id=p_job;
 if j.shared_restaurant_id is not null and not exists(select 1 from private.shared_restaurant_subscriptions s
  join private.shared_restaurant_establishments l on l.restaurant_id=s.restaurant_id and l.organization_id=s.organization_id
  join public.establishments e on e.id=l.establishment_id and e.active
  where s.restaurant_id=j.shared_restaurant_id and s.language=j.collection_language) then return false; end if;
 return public.reserve_incremental_review_sync_before_sharing(p_job,p_worker,p_input,p_build);
end $$;
revoke all on function public.reserve_incremental_review_sync(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_incremental_review_sync(uuid,text,jsonb,text) to service_role;

create or replace function public.read_shared_establishment_menu(p_establishment uuid,p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('result',m.menu_references,'runId',m.run_id,'collectedAt',m.collected_at,'job',j.body)
 from private.shared_restaurant_establishments l join public.establishments e on e.id=l.establishment_id and e.active
 join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=e.organization_id
 left join lateral(select * from private.shared_restaurant_menu_versions v where v.restaurant_id=l.restaurant_id order by collected_at desc,run_id limit 1) m on true
 left join lateral(select jsonb_build_object('id',q.id,'status',q.status,'error_code',q.error_code) body
  from public.rainminer_menu_jobs q join private.shared_restaurant_establishments t on t.establishment_id=q.establishment_id
  join private.shared_restaurants r on r.id=t.restaurant_id and r.place_id=q.place_id
  where t.restaurant_id=l.restaurant_id order by q.created_at desc,q.id limit 1) j on true
 where e.id=p_establishment and public.shared_restaurant_runtime_enabled()
  and exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=p_user);
$$;
create function public.shared_menu_source_valid(p_establishment uuid,p_place text,p_require_subscribers boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select public.shared_restaurant_runtime_enabled() and exists(select 1 from private.shared_restaurant_establishments l
  join private.shared_restaurants r on r.id=l.restaurant_id and r.place_id=p_place where l.establishment_id=p_establishment
  and (not p_require_subscribers or exists(select 1 from private.shared_restaurant_subscriptions s
   join private.shared_restaurant_establishments a on a.restaurant_id=s.restaurant_id and a.organization_id=s.organization_id
   join public.establishments e on e.id=a.establishment_id and e.active where s.restaurant_id=r.id)));
$$;
revoke all on function public.shared_menu_source_valid(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.shared_menu_source_valid(uuid,text,boolean) to service_role;
