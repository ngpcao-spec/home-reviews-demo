-- Claim one due collection per verified restaurant and language. The same
-- row lock also serializes subscription and completion. No provider call here.
create function public.queue_shared_restaurant_collection(p_restaurant uuid,p_language text)
returns uuid language plpgsql security definer set search_path='' as $$
declare c private.shared_restaurant_collections; job uuid; cadence integer;
begin
  select * into c from private.shared_restaurant_collections
    where restaurant_id=p_restaurant and language=p_language for update;
  if not found then return null; end if;
  select min(o.monitoring_interval_hours) into cadence
  from private.shared_restaurant_subscriptions s join public.organizations o on o.id=s.organization_id
  where s.restaurant_id=p_restaurant and s.language=p_language;
  if cadence is null then return null; end if;
  select id into job from private.shared_restaurant_collection_jobs
    where restaurant_id=p_restaurant and language=p_language and status in ('queued','running','unknown');
  if job is not null then return job; end if;
  -- A terminal failure requires explicit operator recovery, never a paid loop.
  if exists(select 1 from private.shared_restaurant_collection_jobs
    where restaurant_id=p_restaurant and language=p_language and status='failed')
    or c.last_success_at+make_interval(hours=>cadence)>now() then return null; end if;
  insert into private.shared_restaurant_collection_jobs(restaurant_id,language)
  values(p_restaurant,p_language) returning id into job;
  return job;
end $$;

create function public.claim_shared_restaurant_collection(p_job uuid)
returns boolean language sql security definer set search_path='' as $$
  with claimed as (
    update private.shared_restaurant_collection_jobs j set status='running'
    where j.id=p_job and j.status='queued' and exists(
      select 1 from private.shared_restaurant_subscriptions s
      where s.restaurant_id=j.restaurant_id and s.language=j.language
    ) returning 1
  ) select exists(select 1 from claimed);
$$;

create function public.complete_shared_restaurant_collection(p_job uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare j private.shared_restaurant_collection_jobs; added integer;
begin
  select * into j from private.shared_restaurant_collection_jobs where id=p_job;
  if not found then raise exception 'SHARED_COLLECTION_MISSING'; end if;
  -- Serialize merges across languages so both apply the same retention limit.
  perform 1 from private.shared_restaurants where id=j.restaurant_id for update;
  perform 1 from private.shared_restaurant_collections where restaurant_id=j.restaurant_id and language=j.language for update;
  select * into strict j from private.shared_restaurant_collection_jobs where id=p_job for update;
  if j.status='completed' then return 0; end if;
  if j.status<>'running' or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows)>150 then raise exception 'SHARED_COLLECTION_INVALID'; end if;
  insert into private.shared_restaurant_reviews(restaurant_id,external_id,published_at,rating,original_text)
  select j.restaurant_id,r.external_id,r.published_at,r.rating,r.original_text
  from jsonb_to_recordset(p_rows) r(external_id text,published_at timestamptz,rating integer,original_text text)
  on conflict(restaurant_id,external_id) do nothing;
  get diagnostics added=row_count;
  delete from private.shared_restaurant_reviews v
  using (select external_id from private.shared_restaurant_reviews where restaurant_id=j.restaurant_id
    order by published_at desc,external_id offset 150) obsolete
  where v.restaurant_id=j.restaurant_id and v.external_id=obsolete.external_id;
  update private.shared_restaurant_collection_jobs set status='completed' where id=p_job;
  update private.shared_restaurant_collections
    set initialized_at=coalesce(initialized_at,now()),last_success_at=now()
    where restaurant_id=j.restaurant_id and language=j.language;
  return added;
end $$;

create function public.unsubscribe_shared_restaurant(p_org uuid,p_restaurant uuid)
returns void language sql security definer set search_path='' as $$
  delete from private.shared_restaurant_subscriptions
  where organization_id=p_org and restaurant_id=p_restaurant
    and exists(select 1 from public.organization_members where organization_id=p_org
      and user_id=(select auth.uid()) and role in ('owner','admin','manager'));
$$;

create function public.reserve_shared_restaurant_analysis(
  p_restaurant uuid,p_content text,p_language text,p_model text,p_configuration text
) returns boolean language sql security definer set search_path='' as $$
  with reservation as (
    insert into private.shared_restaurant_analysis_jobs
      (restaurant_id,content_sha256,language,model,configuration_sha256)
    values(p_restaurant,p_content,p_language,p_model,p_configuration)
    on conflict do nothing returning 1
  ) select exists(select 1 from reservation);
$$;

revoke all on function public.reserve_shared_restaurant_analysis(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_shared_restaurant_analysis(uuid,text,text,text,text) to service_role;

create function public.complete_shared_restaurant_analysis(
  p_restaurant uuid,p_content text,p_language text,p_model text,p_configuration text,p_result jsonb
) returns boolean language sql security definer set search_path='' as $$
  with saved as (
    update private.shared_restaurant_analysis_jobs
    set state='completed',result=p_result
    where restaurant_id=p_restaurant and content_sha256=p_content and language=p_language
      and model=p_model and configuration_sha256=p_configuration and state='reserved'
      and jsonb_typeof(p_result)='object' returning 1
  ) select exists(select 1 from saved);
$$;

create function public.read_shared_restaurant_analysis(
  p_restaurant uuid,p_content text,p_language text,p_model text,p_configuration text
) returns jsonb language sql stable security definer set search_path='' as $$
  select result from private.shared_restaurant_analysis_jobs
  where restaurant_id=p_restaurant and content_sha256=p_content and language=p_language
    and model=p_model and configuration_sha256=p_configuration and state='completed';
$$;

revoke all on function public.complete_shared_restaurant_analysis(uuid,text,text,text,text,jsonb),
  public.read_shared_restaurant_analysis(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_shared_restaurant_analysis(uuid,text,text,text,text,jsonb),
  public.read_shared_restaurant_analysis(uuid,text,text,text,text) to service_role;

revoke all on function public.queue_shared_restaurant_collection(uuid,text),
  public.claim_shared_restaurant_collection(uuid),
  public.complete_shared_restaurant_collection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.queue_shared_restaurant_collection(uuid,text),
  public.claim_shared_restaurant_collection(uuid),
  public.complete_shared_restaurant_collection(uuid,jsonb) to service_role;
revoke all on function public.unsubscribe_shared_restaurant(uuid,uuid) from public,anon;
grant execute on function public.unsubscribe_shared_restaurant(uuid,uuid) to authenticated;
