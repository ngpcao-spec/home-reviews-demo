create function private.update_shared_subscription_language() returns trigger
language plpgsql security definer set search_path='' as $$declare restaurant uuid;begin
 if new.collection_language is not distinct from old.collection_language or not public.shared_restaurant_runtime_enabled() then return new;end if;
 select restaurant_id into restaurant from private.shared_restaurant_establishments where establishment_id=new.id;
 if restaurant is null then return new;end if;
 perform 1 from private.shared_restaurants where id=restaurant for update;
 update private.shared_restaurant_subscriptions set language=new.collection_language where restaurant_id=restaurant and organization_id=new.organization_id;
 insert into private.shared_restaurant_collections(restaurant_id,language) values(restaurant,new.collection_language) on conflict do nothing;
 return new;
end $$;

-- Old clients must not delete an establishment that still anchors shared
-- receipts or report links. The supported removal RPC only unsubscribes it.
create function private.prevent_shared_establishment_delete() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from private.shared_restaurant_establishments where establishment_id=old.id)
 then raise exception 'USE_SUBSCRIPTION_REMOVAL';end if;
 return old;
end $$;
create trigger preserve_shared_establishment before delete on public.establishments
 for each row execute function private.prevent_shared_establishment_delete();
revoke all on function private.prevent_shared_establishment_delete() from public,anon,authenticated;
create trigger shared_subscription_language after update of collection_language on public.establishments
 for each row execute function private.update_shared_subscription_language();

-- Archive before a manual reload retires source runs, without changing the
-- reload's transaction, atomic replacement, or report retry rules.
alter function public.apply_review_reload(uuid,text) rename to apply_review_reload_before_shared_archive;
create function public.apply_review_reload(p_job uuid,p_worker text) returns jsonb
language plpgsql security invoker set search_path='' as $$declare e uuid;restaurant uuid;answer jsonb;target record;source public.establishments;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select establishment_id into e from public.initial_import_jobs where id=p_job;
 restaurant:=public.shared_restaurant_for_establishment(e);
 if restaurant is not null then
  perform pg_advisory_xact_lock(75302144);
  perform 1 from private.shared_restaurants where id=restaurant for update;
 end if;
 if e is not null then perform public.archive_shared_restaurant_reports(e);end if;
 answer:=public.apply_review_reload_before_shared_archive(p_job,p_worker);
 if restaurant is not null and answer->>'reload_replaced'='true' then
  perform public.capture_shared_review_corpus(e);
  select * into source from public.establishments where id=e;
  update private.shared_restaurant_collections set last_success_at=source.last_sync_at,
    initialized_at=coalesce(initialized_at,source.last_sync_at) where restaurant_id=restaurant and language=source.collection_language;
  for target in select x.id,x.organization_id from private.shared_restaurant_establishments l
   join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=l.organization_id
   join public.establishments x on x.id=l.establishment_id and x.active
   where l.restaurant_id=restaurant and x.id<>e order by x.id loop
   perform public.archive_shared_restaurant_reports(target.id);
   perform public.ingest_recent_reviews(target.id,target.organization_id,public.shared_review_projection_bundle(target.id,true),'apify');
   update public.establishments set last_review_id=source.last_review_id,last_review_at=source.last_review_at,
    last_sync_at=case when collection_language=source.collection_language then source.last_sync_at else last_sync_at end,
    next_sync_at=case when collection_language=source.collection_language then source.next_sync_at else next_sync_at end,
    last_sync_status=case when collection_language=source.collection_language then 'ok' else last_sync_status end,
    last_sync_error=case when collection_language=source.collection_language then null else last_sync_error end
    where id=target.id;
  end loop;
 end if;
 return answer;
end $$;

create function public.read_shared_report_version(p_establishment uuid,p_language text,p_user uuid,p_report uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('scope',v.evidence->'scope'||jsonb_build_object('stale',true,'stale_reason','SHARED_DATED_PUBLICATION'),
  'row',v.document||jsonb_build_object('language',v.language,'generated_at',v.generated_at,'source_reviews',v.evidence->'source_reviews',
    'controls',v.document->'controls'||jsonb_build_object('evidence',v.evidence->'evidence','dated_publication',true,
     'shared_publication',true,'source_available',v.evidence->'source_available')))
 from private.shared_restaurant_establishments l join public.establishments e on e.id=l.establishment_id and e.active
 join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=e.organization_id
 join private.shared_restaurant_report_versions v on v.restaurant_id=l.restaurant_id and v.language=p_language
 where e.id=p_establishment and (p_report is null or v.report_id=p_report) and public.shared_restaurant_runtime_enabled()
 and exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=p_user and role in ('owner','admin','manager'))
 order by v.generated_at desc,v.report_id limit 1;
$$;
create function public.list_shared_report_versions(p_establishment uuid,p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.report_id,'language',v.language,'generated_at',v.generated_at) order by v.generated_at desc,v.report_id),'[]')
 from private.shared_restaurant_establishments l join public.establishments e on e.id=l.establishment_id and e.active
 join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=e.organization_id
 join private.shared_restaurant_report_versions v on v.restaurant_id=l.restaurant_id
 where e.id=p_establishment and public.shared_restaurant_runtime_enabled()
 and exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=p_user and role in ('owner','admin','manager'));
$$;
revoke all on function public.read_shared_report_version(uuid,text,uuid,uuid),public.list_shared_report_versions(uuid,uuid),
 public.apply_review_reload(uuid,text),private.update_shared_subscription_language() from public,anon,authenticated;
grant execute on function public.read_shared_report_version(uuid,text,uuid,uuid),public.list_shared_report_versions(uuid,uuid),public.apply_review_reload(uuid,text) to service_role;

-- Preserve every pre-existing organization policy and add only the departed
-- subscription restriction. Non-shared legacy establishments are unaffected.
do $$declare t text;begin
 foreach t in array array['analysis_parallel_reports','historical_establishment_reports','historical_report_runs','current_report_publications','report_generation_requests'] loop
  execute format('create policy subscribed_report_visibility on public.%I as restrictive for select to authenticated using(public.shared_projection_available(establishment_id))',t);
 end loop;
end $$;
