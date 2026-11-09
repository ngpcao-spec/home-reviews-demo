-- Organization rows remain private projections with their original IDs.
alter table private.shared_restaurant_reviews add column public_payload jsonb;
alter table private.shared_restaurant_review_translations drop constraint shared_restaurant_review_translations_language_check;
alter table private.shared_restaurant_review_translations add constraint shared_restaurant_review_translations_language_check check(language in ('fr','vi','en'));
alter table public.review_sync_jobs add column shared_restaurant_id uuid references private.shared_restaurants;
create unique index review_sync_one_shared_collection on public.review_sync_jobs(shared_restaurant_id,collection_language)
  where shared_restaurant_id is not null and status in ('queued','running','retry');

-- Explicit allowlist: never transfer reply drafts, workflow status or AI edits.
create function private.shared_review_public_fields(p_row jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_row) where key=any(array[
 'external_review_id','author_name','author_image','rating','text','original_text','original_language','language',
 'published_at','review_url','owner_response','source_provider','provider_publish_at','provider_rating','likes_count',
 'review_context','review_detailed_rating','visited_in','review_image_urls','response_from_owner_text','response_from_owner_date',
 'reviewer_id','reviewer_url','reviewer_number_of_reviews','reviewer_photo_url','is_local_guide','review_origin','provider_scraped_at']);
$$;

create function public.capture_shared_review_corpus(p_establishment uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare restaurant uuid; n integer;
begin
 if not public.shared_restaurant_runtime_enabled() then return 0; end if;
 select restaurant_id into restaurant from private.shared_restaurant_establishments where establishment_id=p_establishment;
 if restaurant is null then return 0; end if;
 perform 1 from private.shared_restaurants where id=restaurant for update;
 insert into private.shared_restaurant_reviews(restaurant_id,external_id,published_at,rating,original_text,public_payload)
 select restaurant,r.external_review_id,r.published_at,r.rating,coalesce(nullif(r.original_text,''),r.text,''),
   private.shared_review_public_fields(to_jsonb(r)) from public.reviews r
 where r.establishment_id=p_establishment and r.published_at is not null
 order by r.published_at desc,r.external_review_id limit 150
 on conflict(restaurant_id,external_id) do update set rating=excluded.rating,original_text=excluded.original_text,
   public_payload=excluded.public_payload;
 get diagnostics n=row_count;
 insert into private.shared_restaurant_review_translations(restaurant_id,external_id,language,original_text_sha256,translated_text)
 select restaurant,r.external_review_id,t.language,encode(sha256(convert_to(coalesce(nullif(r.original_text,''),r.text,''),'UTF8')),'hex'),t.translated_text
 from public.review_translations t join public.reviews r on r.id=t.review_id
 where r.establishment_id=p_establishment and t.language in ('fr','vi','en')
   and exists(select 1 from private.shared_restaurant_reviews v where v.restaurant_id=restaurant and v.external_id=r.external_review_id)
   and t.source_text_sha256=encode(sha256(convert_to(coalesce(nullif(r.original_text,''),r.text,''),'UTF8')),'hex')
 on conflict(restaurant_id,external_id,language,original_text_sha256) do update set translated_text=excluded.translated_text;
 delete from private.shared_restaurant_reviews r using (
  select external_id from private.shared_restaurant_reviews where restaurant_id=restaurant
  order by published_at desc,external_id offset 150
 ) old where r.restaurant_id=restaurant and r.external_id=old.external_id;
 return n;
end $$;

create function public.shared_review_projection_bundle(p_establishment uuid,p_historical boolean default false)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('row',v.public_payload||jsonb_build_object(
  'organization_id',l.organization_id,'establishment_id',l.establishment_id,
  'historical_import',p_historical or v.published_at<=l.subscribed_at,
  'requires_attention',v.rating<=3,'requires_ai_analysis',v.rating<=3,
  'status',case when v.rating<=3 then 'to_process' else 'ignored' end),
  'translations',coalesce((select jsonb_agg(jsonb_build_object('language',t.language,'translated_text',t.translated_text))
    from private.shared_restaurant_review_translations t where t.restaurant_id=v.restaurant_id and t.external_id=v.external_id
      and t.original_text_sha256=encode(sha256(convert_to(v.original_text,'UTF8')),'hex')),'[]'),
  'raw_payload','{}'::jsonb) order by v.published_at desc,v.external_id),'[]')
 from private.shared_restaurant_establishments l
 join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=l.organization_id
 join public.establishments e on e.id=l.establishment_id and e.active
 join private.shared_restaurant_reviews v on v.restaurant_id=l.restaurant_id
 where l.establishment_id=p_establishment and v.public_payload is not null and public.shared_restaurant_runtime_enabled();
$$;

-- Covers both the scheduler and direct enqueue paths. Existing non-shared jobs are unchanged.
create function private.reserve_shared_sync_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare restaurant uuid; lang text;
begin
 restaurant:=public.shared_restaurant_for_establishment(new.establishment_id);
 if restaurant is null then return new; end if;
 select collection_language into strict lang from public.establishments where id=new.establishment_id;
 perform 1 from private.shared_restaurants where id=restaurant for update;
 if exists(select 1 from public.review_sync_jobs j join private.shared_restaurant_establishments l on l.establishment_id=j.establishment_id
   where l.restaurant_id=restaurant and j.collection_language=lang and j.status in ('queued','running','retry'))
 or exists(select 1 from public.review_sync_jobs j join private.shared_restaurant_establishments l on l.establishment_id=j.establishment_id
   where l.restaurant_id=restaurant and j.collection_language=lang and j.status='dead'
     and (j.provider_start_attempted_at is not null and j.apify_run_id is null and j.provider_no_run_confirmed_at is null
       or j.created_at>=coalesce((select last_success_at from private.shared_restaurant_collections where restaurant_id=restaurant and language=lang),'-infinity')))
 or exists(select 1 from public.initial_import_jobs j join private.shared_restaurant_establishments l on l.establishment_id=j.establishment_id
   where l.restaurant_id=restaurant and j.status in ('queued','running','retry'))
 then return null; end if;
 new.shared_restaurant_id:=restaurant;
 new.collection_language:=lang;
 return new;
end $$;
create trigger zz_shared_sync_reservation before insert on public.review_sync_jobs
 for each row execute function private.reserve_shared_sync_row();

-- Refresh the schedule before invoking the original scheduler, preserving its terminal guards.
alter function public.enqueue_due_review_sync_jobs(integer) rename to enqueue_due_review_sync_jobs_before_sharing;
create function public.enqueue_due_review_sync_jobs(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path='' as $$
declare x record; candidate uuid; n integer:=0; inserted integer; legacy integer;
begin
 if not public.shared_restaurant_runtime_enabled() then return public.enqueue_due_review_sync_jobs_before_sharing(p_limit); end if;
 perform pg_advisory_xact_lock(75302144);
 for x in select c.restaurant_id,c.language,c.last_success_at,min(o.monitoring_interval_hours) hours
  from private.shared_restaurant_collections c
  join private.shared_restaurant_subscriptions s on s.restaurant_id=c.restaurant_id and s.language=c.language
  join private.shared_restaurant_establishments l on l.restaurant_id=s.restaurant_id and l.organization_id=s.organization_id
  join public.establishments e on e.id=l.establishment_id and e.active and e.collection_language=c.language
  join public.organizations o on o.id=s.organization_id
  group by c.restaurant_id,c.language,c.last_success_at order by c.restaurant_id,c.language
  limit least(greatest(p_limit,1),10000)
 loop
  perform 1 from private.shared_restaurants where id=x.restaurant_id for update;
  update public.establishments e set next_sync_at=x.last_success_at+make_interval(hours=>x.hours)
   from private.shared_restaurant_establishments l join private.shared_restaurant_subscriptions s
    on s.restaurant_id=l.restaurant_id and s.organization_id=l.organization_id
   where e.id=l.establishment_id and l.restaurant_id=x.restaurant_id and s.language=x.language
    and e.active and e.last_sync_status is distinct from 'error' and x.last_success_at is not null;
  if x.last_success_at is null or x.last_success_at+make_interval(hours=>x.hours)>now() then continue; end if;
  select e.id into candidate from public.establishments e
   join private.shared_restaurant_establishments l on l.establishment_id=e.id
   join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=l.organization_id
   where l.restaurant_id=x.restaurant_id and s.language=x.language and e.collection_language=x.language and e.active
    and e.last_sync_status is distinct from 'error' and e.last_review_id is not null and e.last_review_at is not null
   order by e.last_review_at desc,e.id limit 1;
  if candidate is not null then
   insert into public.review_sync_jobs(establishment_id,organization_id,scheduled_for,available_at,checkpoint_review_id,checkpoint_review_at)
   select e.id,e.organization_id,e.next_sync_at,now(),e.last_review_id,e.last_review_at from public.establishments e where e.id=candidate
   on conflict do nothing;
   get diagnostics inserted=row_count; n:=n+inserted;
  end if;
 end loop;
 -- The insert trigger also protects calls issued by the original scheduler.
 legacy:=public.enqueue_due_review_sync_jobs_before_sharing(p_limit);
 return n+legacy;
end $$;

alter function public.commit_incremental_review_sync(uuid,text,jsonb,jsonb) rename to commit_incremental_review_sync_before_sharing;
create function public.commit_incremental_review_sync(p_job uuid,p_worker text,p_bundle jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.review_sync_jobs; answer jsonb; target record; bundle jsonb; cadence integer;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN'; end if;
 select * into strict j from public.review_sync_jobs where id=p_job;
 if not public.shared_restaurant_runtime_enabled() or j.shared_restaurant_id is null then
  return public.commit_incremental_review_sync_before_sharing(p_job,p_worker,p_bundle,p_result);
 end if;
 perform pg_advisory_xact_lock(75302144);
 perform 1 from private.shared_restaurants where id=j.shared_restaurant_id for update;
 if j.status='completed' then return j.incremental_result; end if;
 -- Lock all projection corpora before the unchanged production validation/import.
 for target in select l.establishment_id from private.shared_restaurant_establishments l
  where l.restaurant_id=j.shared_restaurant_id order by l.establishment_id
 loop perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||target.establishment_id::text,0)); end loop;
 if exists(select 1 from public.initial_import_jobs i join private.shared_restaurant_establishments l on l.establishment_id=i.establishment_id
  where l.restaurant_id=j.shared_restaurant_id and i.status in ('queued','running','retry')) then raise exception 'SYNC_INCREMENTAL_RELOAD_IN_PROGRESS'; end if;
 -- This hook archives current report evidence before the original retention can retire it.
 for target in select establishment_id from private.shared_restaurant_establishments where restaurant_id=j.shared_restaurant_id
 loop perform public.capture_shared_review_corpus(target.establishment_id); end loop;
 answer:=public.commit_incremental_review_sync_before_sharing(p_job,p_worker,p_bundle,p_result);
 if answer is null then return null; end if;
 perform public.capture_shared_review_corpus(j.establishment_id);
 for target in select e.id,e.organization_id,e.collection_language,l.subscribed_at
  from private.shared_restaurant_establishments l join public.establishments e on e.id=l.establishment_id and e.active
  join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=l.organization_id
  where l.restaurant_id=j.shared_restaurant_id order by e.id
 loop
  if target.id<>j.establishment_id then
   bundle:=public.shared_review_projection_bundle(target.id,false);
   perform public.ingest_recent_reviews(target.id,target.organization_id,bundle,'apify');
  end if;
  select min(o.monitoring_interval_hours) into cadence from private.shared_restaurant_subscriptions s
   join private.shared_restaurant_establishments l on l.restaurant_id=s.restaurant_id and l.organization_id=s.organization_id
   join public.establishments e on e.id=l.establishment_id and e.active join public.organizations o on o.id=s.organization_id
   where s.restaurant_id=j.shared_restaurant_id and s.language=j.collection_language;
  update public.establishments set last_review_id=answer->>'head_id',last_review_at=(answer->>'head_at')::timestamptz,
   last_sync_at=case when collection_language=j.collection_language then now() else last_sync_at end,
   next_sync_at=case when collection_language=j.collection_language then now()+make_interval(hours=>cadence) else next_sync_at end,
   sync_status=case when collection_language=j.collection_language then 'ok' else sync_status end,
   last_sync_status=case when collection_language=j.collection_language then 'ok' else last_sync_status end
   where id=target.id;
 end loop;
 update private.shared_restaurant_collections set last_success_at=now() where restaurant_id=j.shared_restaurant_id and language=j.collection_language;
 return answer;
end $$;

grant usage on schema private to service_role;
grant select,update on private.shared_restaurants,private.shared_restaurant_collections to service_role;
grant select on private.shared_restaurant_establishments,private.shared_restaurant_subscriptions to service_role;
revoke all on function public.capture_shared_review_corpus(uuid),public.shared_review_projection_bundle(uuid,boolean),
 public.enqueue_due_review_sync_jobs(integer),public.commit_incremental_review_sync(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.capture_shared_review_corpus(uuid),public.shared_review_projection_bundle(uuid,boolean),
 public.enqueue_due_review_sync_jobs(integer),public.commit_incremental_review_sync(uuid,text,jsonb,jsonb) to service_role;
revoke all on function private.shared_review_public_fields(jsonb),private.reserve_shared_sync_row() from public,anon,authenticated;
