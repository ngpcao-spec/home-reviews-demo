create table public.rainminer_menu_jobs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  place_id text not null,
  request_id uuid not null,
  status text not null default 'queued' check (status in ('queued','starting','running','completed','failed','unknown')),
  run_id text unique,
  raw jsonb,
  result jsonb,
  error_code text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (establishment_id, request_id)
);
create unique index rainminer_one_active on public.rainminer_menu_jobs ((true))
  where status in ('queued','starting','running','unknown');
alter table public.rainminer_menu_jobs enable row level security;
revoke all on public.rainminer_menu_jobs from public, anon, authenticated;
grant select, insert, update on public.rainminer_menu_jobs to service_role;

create function public.enqueue_rainminer_menu(p_establishment uuid, p_request uuid, p_user uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare restaurant public.establishments; existing uuid;
begin
  perform pg_advisory_xact_lock(75302143);
  select * into strict restaurant from public.establishments where id=p_establishment and active;
  if not exists(select 1 from public.organization_members where organization_id=restaurant.organization_id
    and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'MENU_FORBIDDEN'; end if;
  if coalesce(restaurant.place_id,'') !~ '^ChIJ[A-Za-z0-9_-]+$' then raise exception 'MENU_PLACE_ID_REQUIRED'; end if;
  select id into existing from public.rainminer_menu_jobs where establishment_id=p_establishment
    and (request_id=p_request or status in ('queued','starting','running','unknown')) limit 1;
  if found then return existing; end if;
  if exists(select 1 from public.rainminer_menu_jobs where status in ('queued','starting','running','unknown'))
    then raise exception 'MENU_QUEUE_BUSY'; end if;
  insert into public.rainminer_menu_jobs(establishment_id,place_id,request_id)
    values(p_establishment,restaurant.place_id,p_request) returning id into existing;
  return existing;
end $$;

create function public.claim_rainminer_menu()
returns setof public.rainminer_menu_jobs language plpgsql security invoker set search_path='' as $$
begin
  update public.rainminer_menu_jobs set status='unknown',error_code='START_OUTCOME_UNKNOWN'
    where status='starting' and lease_until <= now();
  return query update public.rainminer_menu_jobs set
    status=case when status='queued' then 'starting' else status end,
    lease_until=now()+interval '3 minutes'
  where id=(select id from public.rainminer_menu_jobs
    where status in ('queued','running') and (lease_until is null or lease_until<=now())
    order by created_at for update skip locked limit 1)
  returning *;
end $$;

revoke all on function public.enqueue_rainminer_menu(uuid,uuid,uuid),public.claim_rainminer_menu() from public,anon,authenticated;
grant execute on function public.enqueue_rainminer_menu(uuid,uuid,uuid),public.claim_rainminer_menu() to service_role;

create function public.rainminer_menu_enabled(p_worker_url text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets
    where name='home_reviews_rainminer_worker_url' and decrypted_secret=p_worker_url)
$$;
revoke all on function public.rainminer_menu_enabled(text) from public,anon,authenticated;
grant execute on function public.rainminer_menu_enabled(text) to service_role;

-- The deployment supplies the worker URL in Vault for the current environment.
-- Cron dispatches existing requests only. It cannot create an extraction request.
select cron.schedule('home-reviews-rainminer-menu','* * * * *',$cron$
  select net.http_post(
    url := worker.decrypted_secret,
    headers := jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',token.decrypted_secret),
    body := '{"action":"work"}'::jsonb,
    timeout_milliseconds := 120000
  )
  from vault.decrypted_secrets worker cross join vault.decrypted_secrets token
  where worker.name='home_reviews_rainminer_worker_url' and token.name='home_reviews_scheduler_token'
    and exists(select 1 from public.rainminer_menu_jobs where status in ('queued','starting','running')
      and (lease_until is null or lease_until<=now()));
$cron$);
