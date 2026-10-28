begin;
set local lock_timeout='5s';
create table private.google_place_profiles(
 establishment_id uuid primary key references public.establishments(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 job_id uuid not null unique references private.google_place_price_jobs(id),
 observed_at timestamptz not null,profile jsonb not null,stored_at timestamptz not null default clock_timestamp()
);
alter table private.google_place_profiles enable row level security;
revoke all on private.google_place_profiles from public,anon,authenticated,service_role;

create function private.persist_google_place_profile(p_job uuid,p_profile jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j private.google_place_price_jobs;e public.establishments;g text;v jsonb;binding jsonb;saved jsonb;begin
 select * into j from private.google_place_price_jobs where id=p_job for update;
 if not found or j.status not in('completed','not_provided') or j.run_id is null or j.dataset_id is null
  or j.provider_status is distinct from 'SUCCEEDED' then raise exception 'PLACE_PROFILE_CONFIRMED_RESULT_REQUIRED';end if;
 select * into e from public.establishments where id=j.establishment_id and organization_id=j.organization_id for update;
 if e.id is null or (e.google_id,e.place_id) is distinct from (j.google_id,j.place_id)
  or p_profile#>>'{identity,cid}' is distinct from j.google_id or j.place_id is not null and p_profile#>>'{identity,place_id}' is distinct from j.place_id then raise exception 'PLACE_PROFILE_IDENTITY_MISMATCH';end if;
 if jsonb_typeof(p_profile) is distinct from 'object' or p_profile->>'version' is distinct from 'google-place-profile-v1'
  or octet_length(p_profile::text)>150000 or exists(select 1 from jsonb_object_keys(p_profile) k where k not in('version','identity','categories','hours','attributes','popularity','presentation','contacts')) then raise exception 'PLACE_PROFILE_SHAPE_INVALID';end if;
 foreach g in array array['identity','categories','hours','attributes','popularity','presentation','contacts'] loop
  v=p_profile->g;
  if jsonb_typeof(v) is distinct from 'object' or v->>'source' is distinct from 'google_maps_place_details'
   or v->>'collection_language' is distinct from j.language
   or (v->>'observed_at')::timestamptz is distinct from (j.observation#>>'{raw,scrapedAt}')::timestamptz
   or jsonb_typeof(v->'source_fields') is distinct from 'array' then raise exception 'PLACE_PROFILE_PROVENANCE_INVALID';end if;
 end loop;
 if jsonb_typeof(p_profile#>'{categories,raw}') is distinct from 'array' or jsonb_typeof(p_profile#>'{attributes,entries}') is distinct from 'array'
  or jsonb_typeof(p_profile#>'{attributes,facts}') is distinct from 'object' or jsonb_typeof(p_profile#>'{hours,weekly}') is distinct from 'array'
  or jsonb_typeof(p_profile#>'{hours,additional}') is distinct from 'array' or jsonb_typeof(p_profile#>'{popularity,weekly}') is distinct from 'array'
  or p_profile#>'{hours,live}' is distinct from 'false'::jsonb or p_profile#>'{popularity,live}' is distinct from 'false'::jsonb
  or p_profile#>'{contacts,menu_contents_known}' is distinct from 'false'::jsonb
  or p_profile#>'{contacts,reservation_availability_known}' is distinct from 'false'::jsonb then raise exception 'PLACE_PROFILE_SHAPE_INVALID';end if;
 binding=jsonb_build_object('establishment_id',e.id,'organization_id',e.organization_id,'job_id',j.id,'run_id',j.run_id,'dataset_id',j.dataset_id,'actor',j.actor,'build',j.build);
 saved=p_profile||jsonb_build_object('binding',binding);
 if exists(select 1 from private.google_place_profiles where establishment_id=e.id and profile is distinct from saved) then raise exception 'PLACE_PROFILE_IMMUTABLE_CONFLICT';end if;
 insert into private.google_place_profiles(establishment_id,organization_id,job_id,observed_at,profile)
 values(e.id,e.organization_id,j.id,(p_profile#>>'{identity,observed_at}')::timestamptz,saved) on conflict(establishment_id) do nothing;
 update public.restaurant_recommendation_sheets set metadata=jsonb_set(metadata,'{google_place_profile}',saved),updated_at=clock_timestamp()
 where establishment_id=e.id and organization_id=e.organization_id and metadata->'google_place_profile' is distinct from saved;
 return true;
end$$;

create function public.store_google_place_profile(p_job uuid,p_profile jsonb) returns boolean
language sql security definer set search_path='' as $$select private.persist_google_place_profile(p_job,p_profile)$$;
revoke all on function public.store_google_place_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.store_google_place_profile(uuid,jsonb) to service_role;
revoke all on function private.persist_google_place_profile(uuid,jsonb) from public,anon,authenticated,service_role;

-- Publication/price refreshes may rebuild metadata; always attach the same independent Google observation.
create function private.attach_google_place_profile() returns trigger
language plpgsql security definer set search_path='' as $$declare p jsonb;begin
 select profile into p from private.google_place_profiles where establishment_id=new.establishment_id and organization_id=new.organization_id;
 if p is not null then new.metadata=jsonb_set(new.metadata,'{google_place_profile}',p);
 else new.metadata=new.metadata-'google_place_profile';end if;
 return new;
end$$;
revoke all on function private.attach_google_place_profile() from public,anon,authenticated,service_role;
create trigger attach_google_place_profile before insert or update of metadata on public.restaurant_recommendation_sheets
 for each row execute function private.attach_google_place_profile();

-- Keep the existing attempt/lease/receipt/concurrency logic verbatim. Old workers remain compatible.
do $$declare definition text;anchor text=$a$ if p_action in('finish','fail') then$a$;begin
 definition=pg_get_functiondef('public.advance_google_place_price_job(uuid,text,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'PLACE_PROFILE_PATCH_ANCHOR_MISMATCH';end if;
 definition=replace(definition,anchor,$a$ if p_action='finish' and p_data?'profile' then
  perform private.persist_google_place_profile(j.id,p_data->'profile');
 end if;
$a$||anchor);
 execute definition;
end$$;
comment on table private.google_place_profiles is 'Curated dated Google declarations, independent of frozen report scores. No reviews or extra image downloads; no provider invocation.';
commit;
