begin;
set local lock_timeout='5s';

alter table private.dish_image_settings add column automatic_enabled boolean not null default false;
create index dish_image_waiting on private.dish_images(created_at,dish_id)
 where image_status='pending' and started_at is null;

-- Standard V1 rates in USD per million tokens for gpt-image-2.6-sunburst.
-- Leave the estimate unknown when the provider omitted the needed token counts.
create function private.dish_image_v1_estimate(p_receipt jsonb) returns numeric
language sql immutable strict set search_path='' as $$
 select case when p_receipt->>'model'='gpt-image-2.6-sunburst'
  and jsonb_typeof(p_receipt#>'{usage,input_tokens_details,text_tokens}')='number'
  and jsonb_typeof(p_receipt#>'{usage,input_tokens_details,image_tokens}')='number'
  and jsonb_typeof(p_receipt#>'{usage,output_tokens_details,image_tokens}')='number'
 then (5*(p_receipt#>>'{usage,input_tokens_details,text_tokens}')::numeric
       +8*(p_receipt#>>'{usage,input_tokens_details,image_tokens}')::numeric
       +30*(p_receipt#>>'{usage,output_tokens_details,image_tokens}')::numeric)/1000000
 end;
$$;

create table private.dish_image_attempts (
 generation_id uuid primary key,
 dish_id uuid not null references private.dish_names(id),
 dish_name text not null,
 status text not null check(status in ('running','ready','failed')),
 started_at timestamptz not null,
 finished_at timestamptz,
 error_code text,
 receipt jsonb,
 model text generated always as (coalesce(receipt->>'model','gpt-image-2.6-sunburst')) stored,
 usage jsonb generated always as (receipt->'usage') stored,
 generation_ms jsonb generated always as (receipt->'generation_ms') stored,
 webp_bytes jsonb generated always as (receipt->'webp_bytes') stored,
 estimated_usd numeric generated always as (private.dish_image_v1_estimate(receipt)) stored
);
create index dish_image_attempts_by_dish on private.dish_image_attempts(dish_id,started_at desc);
alter table private.dish_image_attempts enable row level security;
revoke all on private.dish_image_attempts from public,anon,authenticated,service_role;

insert into private.dish_image_attempts(generation_id,dish_id,dish_name,status,started_at,finished_at,error_code,receipt)
 select i.generation_id,i.dish_id,d.name,case when i.image_status in ('ready','failed') then i.image_status else 'running' end,
  i.started_at,case when i.image_status in ('ready','failed') then i.updated_at end,i.last_error,i.generation_receipt
 from private.dish_images i join private.dish_names d on d.id=i.dish_id
 where i.started_at is not null and i.generation_id is not null;

create function private.record_dish_image_attempt() returns trigger
language plpgsql set search_path='' as $$
begin
 insert into private.dish_image_attempts(generation_id,dish_id,dish_name,status,started_at,finished_at,error_code,receipt)
 select new.generation_id,new.dish_id,d.name,case when new.image_status in ('ready','failed') then new.image_status else 'running' end,
  new.started_at,case when new.image_status in ('ready','failed') then new.updated_at end,new.last_error,new.generation_receipt
 from private.dish_names d where d.id=new.dish_id
 on conflict(generation_id) do update set status=excluded.status,finished_at=excluded.finished_at,
  error_code=excluded.error_code,receipt=coalesce(excluded.receipt,dish_image_attempts.receipt);
 return new;
end;
$$;
create trigger record_dish_image_attempt after update of started_at,image_status,generation_receipt on private.dish_images
 for each row when (new.started_at is not null and new.generation_id is not null)
 execute function private.record_dish_image_attempt();
revoke all on function private.record_dish_image_attempt(),private.dish_image_v1_estimate(jsonb) from public,anon,authenticated,service_role;

create or replace function public.claim_dish_image() returns table(dish_id uuid,generation_id uuid,dish_name text,storage_path text)
language plpgsql security definer set search_path='' as $$
declare settings private.dish_image_settings; job private.dish_images;
begin
 -- Serialize every reservation, including automatic requests and operator regenerations.
 select * into strict settings from private.dish_image_settings where singleton for update;
 for job in select i.* from private.dish_images i
  where i.image_status='pending' and i.started_at is not null and i.lease_until<=now() for update
 loop
  perform public.finish_dish_image(job.dish_id,job.generation_id,'DISH_IMAGE_OUTCOME_UNKNOWN');
 end loop;
 if not settings.launches_enabled or (not settings.automatic_enabled and settings.remaining_launches=0) or exists(
  select 1 from private.dish_images i where i.image_status='pending' and i.started_at is not null
 ) then return; end if;
 select i.* into job from private.dish_images i
 where i.image_status='pending' and i.started_at is null
  and (settings.automatic_enabled or i.dish_id=any(settings.allowed_dish_ids))
  and private.dish_image_eligible(i.dish_id)
 order by i.created_at,i.dish_id limit 1 for update of i;
 if not found then return; end if;
 if not settings.automatic_enabled then
  update private.dish_image_settings set remaining_launches=remaining_launches-1 where singleton;
 end if;
 update private.dish_images i set started_at=now(),lease_until=now()+interval '5 minutes',updated_at=now() where i.dish_id=job.dish_id;
 return query select job.dish_id,job.generation_id,n.name,job.dish_id::text||'/'||job.generation_id::text||'.webp'
  from private.dish_names n where n.id=job.dish_id;
end;
$$;

select cron.schedule('home-reviews-dish-image-worker','* * * * *',$cron$
 select net.http_post(
  url:=s.project_url||'/functions/v1/process-dish-image-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',token.decrypted_secret),
  body:='{}'::jsonb,timeout_milliseconds:=150000)
 from vault.decrypted_secrets token cross join private.dish_image_settings s
 where token.name='home_reviews_scheduler_token' and s.singleton and s.project_url is not null and exists(
  select 1 from private.dish_images i where i.image_status='pending' and
   ((i.started_at is not null and i.lease_until<=now()) or
    (s.launches_enabled and i.started_at is null and private.dish_image_eligible(i.dish_id) and
     (s.automatic_enabled or (s.remaining_launches>0 and i.dish_id=any(s.allowed_dish_ids)))))
 );
$cron$);

commit;
