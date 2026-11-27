begin;

create table private.dish_images (
 dish_id uuid primary key references private.dish_names(id),
 image_status text not null default 'missing' check(image_status in ('missing','pending','ready','failed')),
 image_url text,
 image_storage_path text,
 image_source text check(image_source='ai_generated'),
 prompt_version text,
 generation_id uuid,
 started_at timestamptz,
 lease_until timestamptz,
 last_error text,
 generation_receipt jsonb check(generation_receipt is null or jsonb_typeof(generation_receipt)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((image_url is null and image_storage_path is null and image_source is null and prompt_version is null)
     or (image_url is not null and image_storage_path is not null and image_source is not null and prompt_version is not null)),
 check (image_status <> 'ready' or image_url is not null),
 check (image_status = 'missing' or generation_id is not null),
 check (lease_until is null or (image_status='pending' and started_at is not null))
);
create index dish_image_pending_leases on private.dish_images(lease_until) where image_status='pending' and started_at is not null;

create table private.dish_image_settings (
 singleton boolean primary key default true check(singleton),
 launches_enabled boolean not null default false,
 project_url text check(project_url ~ '^https://[a-z0-9]+[.]supabase[.]co$'),
 allowed_dish_ids uuid[] not null default '{}'
  check(cardinality(allowed_dish_ids)<=3 and array_position(allowed_dish_ids,null) is null),
 remaining_launches smallint not null default 0 check(remaining_launches between 0 and 3),
 check(not launches_enabled or project_url is not null)
);
insert into private.dish_image_settings default values;

alter table private.dish_images enable row level security;
alter table private.dish_image_settings enable row level security;
revoke all on private.dish_images,private.dish_image_settings from public,anon,authenticated,service_role;

-- Only illustrative AI assets are stored here. Public file reads need no signed URL.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('dish-images','dish-images',true,2097152,array['image/webp']);
-- Restrictive policies also block writes granted by any broader Storage policy.
create policy dish_images_server_insert on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id <> 'dish-images');
create policy dish_images_server_update on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id <> 'dish-images') with check(bucket_id <> 'dish-images');
create policy dish_images_server_delete on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id <> 'dish-images');

create function private.dish_image_eligible(p_dish uuid,p_scope text default null) returns boolean
language sql stable set search_path='' as $$
 select exists(
  select 1 from private.dish_names d
  join private.restaurant_dishes a on a.dish_id=d.id and a.enabled
  join private.restaurant_dish_profiles p on p.scope=a.scope and p.specialty_id=d.id
  join private.menu_dish_ai_targets t on t.scope=p.scope and t.published_source_run=p.source_run
  join private.menu_dish_ai_runs r on r.id=t.published_id and r.status='succeeded'
  join public.establishments e on e.id=t.establishment_id and e.active and e.place_id=r.place_id
  where d.id=p_dish and d.parent_id is null and (p_scope is null or p.scope=p_scope)
   and r.result#>>'{restaurant_type,value}'='street_food' and t.scope=private.dish_scope(e.id)
 );
$$;

-- Also used by operators to seed individual existing dishes for the pilot.
create function private.enqueue_dish_image(p_dish uuid,p_scope text default null) returns boolean
language plpgsql set search_path='' as $$
begin
 if not private.dish_image_eligible(p_dish,p_scope) then return false; end if;
 insert into private.dish_images(dish_id,image_status,generation_id) values(p_dish,'pending',gen_random_uuid())
 on conflict(dish_id) do update set image_status='pending',generation_id=excluded.generation_id,updated_at=now()
 where dish_images.image_status='missing' and dish_images.image_url is null;
 return found;
end;
$$;

create function private.enqueue_published_dish_image() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform private.enqueue_dish_image(p.specialty_id,new.scope)
 from private.restaurant_dish_profiles p where p.scope=new.scope and p.specialty_id is not null;
 return new;
exception when others then
 raise warning 'DISH_IMAGE_ENQUEUE_FAILED (%)',sqlstate;
 return new;
end;
$$;

create trigger enqueue_published_dish_image after update of published_id,published_source_run
on private.menu_dish_ai_targets for each row
when (new.published_id is not null and (old.published_id,old.published_source_run)
 is distinct from (new.published_id,new.published_source_run)) execute function private.enqueue_published_dish_image();

create function public.finish_dish_image(p_dish uuid,p_generation uuid,p_error text default null,p_receipt jsonb default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare job private.dish_images; object_path text; project text;
begin
 select * into job from private.dish_images where dish_id=p_dish and generation_id=p_generation for update;
 if not found or job.started_at is null or job.image_status not in ('pending','failed') then return false; end if;
 object_path:=p_dish::text||'/'||p_generation::text||'.webp';
 if exists(select 1 from storage.objects where bucket_id='dish-images' and name=object_path) then
  select project_url into strict project from private.dish_image_settings where singleton;
  if project is null then raise exception 'DISH_IMAGE_PROJECT_UNCONFIGURED'; end if;
  update private.dish_images set image_status='ready',image_storage_path=object_path,
   image_url=project||'/storage/v1/object/public/dish-images/'||object_path,
   image_source='ai_generated',prompt_version='dish-image-v1',generation_receipt=coalesce(p_receipt,job.generation_receipt),
   last_error=null,lease_until=null,updated_at=now()
  where dish_id=p_dish;
  return true;
 end if;
 if p_error is null or job.image_status='failed' then return false; end if;
 if p_error not in ('DISH_IMAGE_OUTCOME_UNKNOWN','DISH_IMAGE_PROVIDER_REJECTED','DISH_IMAGE_INVALID_OUTPUT','DISH_IMAGE_STORAGE_UNCONFIRMED') then
  raise exception 'DISH_IMAGE_INVALID_ERROR';
 end if;
 update private.dish_images set image_status='failed',last_error=p_error,lease_until=null,updated_at=now(),
  generation_receipt=coalesce(p_receipt,job.generation_receipt) where dish_id=p_dish;
 return true;
end;
$$;

create function public.claim_dish_image() returns table(dish_id uuid,generation_id uuid,dish_name text,storage_path text)
language plpgsql security definer set search_path='' as $$
declare settings private.dish_image_settings; job private.dish_images;
begin
 -- Serialize claims and consume one slot before the provider can receive the request.
 select * into strict settings from private.dish_image_settings where singleton for update;
 for job in select i.* from private.dish_images i
  where i.image_status='pending' and i.started_at is not null and i.lease_until<=now() for update
 loop
  perform public.finish_dish_image(job.dish_id,job.generation_id,'DISH_IMAGE_OUTCOME_UNKNOWN');
 end loop;
 if not settings.launches_enabled or settings.remaining_launches=0 or exists(
  select 1 from private.dish_images i where i.image_status='pending' and i.started_at is not null
 ) then return; end if;
 select i.* into job from private.dish_images i
 where i.dish_id=any(settings.allowed_dish_ids) and i.image_status='pending' and i.started_at is null
  and private.dish_image_eligible(i.dish_id)
 order by i.created_at,i.dish_id limit 1 for update of i;
 if not found then return; end if;
 update private.dish_image_settings set remaining_launches=remaining_launches-1 where singleton;
 update private.dish_images i set started_at=now(),lease_until=now()+interval '5 minutes',updated_at=now() where i.dish_id=job.dish_id;
 return query select job.dish_id,job.generation_id,n.name,job.dish_id::text||'/'||job.generation_id::text||'.webp'
  from private.dish_names n where n.id=job.dish_id;
end;
$$;

-- An explicit operator request names the current generation to prevent repeated regeneration.
-- Keep the published URL throughout the new attempt, including a failed replacement.
create function private.regenerate_dish_image(p_dish uuid,p_expected_generation uuid) returns boolean
language plpgsql set search_path='' as $$
begin
 if not private.dish_image_eligible(p_dish) then return false; end if;
 update private.dish_images set image_status='pending',generation_id=gen_random_uuid(),started_at=null,lease_until=null,
  last_error=null,generation_receipt=null,updated_at=now()
 where dish_id=p_dish and generation_id=p_expected_generation and image_url is not null
  and (image_status='ready' or (image_status='failed' and last_error='DISH_IMAGE_PROVIDER_REJECTED'));
 return found;
end;
$$;

revoke all on function private.dish_image_eligible(uuid,text),private.enqueue_dish_image(uuid,text),
 private.enqueue_published_dish_image(),private.regenerate_dish_image(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_dish_image(),public.finish_dish_image(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_dish_image(),public.finish_dish_image(uuid,uuid,text,jsonb) to service_role;

select cron.schedule('home-reviews-dish-image-worker','* * * * *',$cron$
 select net.http_post(
  url:=s.project_url||'/functions/v1/process-dish-image-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',token.decrypted_secret),
  body:='{}'::jsonb,timeout_milliseconds:=150000)
 from vault.decrypted_secrets token cross join private.dish_image_settings s
 where token.name='home_reviews_scheduler_token' and s.singleton and s.project_url is not null and exists(
  select 1 from private.dish_images i where i.image_status='pending' and
   ((i.started_at is not null and i.lease_until<=now()) or
    (s.launches_enabled and s.remaining_launches>0 and i.started_at is null and i.dish_id=any(s.allowed_dish_ids)))
 );
$cron$);

notify pgrst,'reload schema';
commit;
