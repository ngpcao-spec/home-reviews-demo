begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- This switch is enabled explicitly only after the server function is deployed.
create table private.google_place_price_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false,last_wake_at timestamptz);
insert into private.google_place_price_config(singleton,enabled) values(true,false);
create table private.google_place_price_jobs(
 id uuid primary key default gen_random_uuid(),
 establishment_id uuid unique references public.establishments(id) on delete set null,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 google_id text not null,place_id text,google_maps_url text not null,language text not null check(language in('fr','vi')),
 actor text not null default 'compass~crawler-google-places',build text not null default '0.14.777',
 status text not null default 'queued' check(status in('queued','running','completed','not_provided','failed','unknown','identity_mismatch','cancelled')),
 created_at timestamptz not null default clock_timestamp(),available_at timestamptz not null default clock_timestamp(),
 locked_by text,lease_until timestamptz,slot_number smallint,
 start_attempted_at timestamptz,attempts integer not null default 0 check(attempts between 0 and 1),
 request_input jsonb,run_id text unique,dataset_id text,provider_status text,receipt jsonb,
 observation jsonb,error_code text,finished_at timestamptz,reused boolean not null default false,
 check((attempts=0)=(start_attempted_at is null))
);
create index google_place_price_ready on private.google_place_price_jobs(available_at,created_at) where status in('queued','running');
create index google_place_price_org on private.google_place_price_jobs(organization_id);
alter table private.google_place_price_jobs enable row level security;
alter table private.google_place_price_config enable row level security;
revoke all on private.google_place_price_jobs,private.google_place_price_config from public,anon,authenticated,service_role;

-- Keep the prior frozen customer-spending implementation unchanged.
do $$declare d text;begin
 d=pg_get_functiondef('private.recommendation_google_budget_v1(uuid,uuid,jsonb,text)'::regprocedure);
 d=replace(d,'private.recommendation_google_budget_v1(','private.recommendation_google_budget_retained_v1(');
 execute d;
end$$;
create or replace function private.recommendation_google_budget_v1(est uuid,org uuid,bindings jsonb,frozen_at text) returns jsonb
language plpgsql stable set search_path='' as $$
declare b jsonb;ep jsonb;j private.google_place_price_jobs;e public.establishments;latest text;begin
 b=private.recommendation_google_budget_retained_v1(est,org,bindings,frozen_at);ep=b->'establishment_price';
 select * into e from public.establishments where id=est and organization_id=org;
 select * into j from private.google_place_price_jobs q where q.establishment_id=est and q.organization_id=org
  and q.google_id=e.google_id and (q.place_id is null or q.place_id=e.place_id);
 if j.id is not null then
  latest=j.status;
  -- No null, failed, unknown or mismatched response can erase or re-date a known price.
  if j.status='completed' and (ep->>'status'<>'provided' or (j.observation#>>'{raw,scrapedAt}')::timestamptz>=coalesce((ep->>'provider_scraped_at')::timestamptz,(ep->>'observed_at')::timestamptz)) then
   ep=jsonb_build_object('status','provided','source','google_maps_place_details','price',j.observation#>'{raw,price}',
    'price_level',j.observation#>'{raw,priceLevel}','price_range',j.observation#>'{raw,priceRange}',
    'normalized_range',j.observation->'normalized_range','unit',j.observation->'unit','unit_evidence',j.observation->'unit_evidence',
    'guaranteed_tariff',false,'indicative',true,'source_fields',(select jsonb_agg(k order by k) from jsonb_object_keys(j.observation->'raw') k where k in('price','priceLevel','priceRange') and j.observation->'raw'->k not in('null'::jsonb,'""'::jsonb,'{}'::jsonb)),
    'observed_at',j.observation#>'{raw,scrapedAt}','provider_scraped_at',j.observation#>'{raw,scrapedAt}',
    'source_table','google_place_price_jobs','source_id',j.id,'run_id',j.run_id,'actor',j.actor,'build',j.build,
    'google_id',j.google_id,'place_id',j.place_id,'language',j.language,'missing_reason',null);
  end if;
  ep=ep||jsonb_build_object('collection_status',latest,'collection_error',j.error_code,'collection_finished_at',j.finished_at);
 end if;
 return jsonb_set(b,'{establishment_price}',ep);
end$$;
revoke all on function private.recommendation_google_budget_retained_v1(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

create function private.refresh_place_price_sheet(p_est uuid) returns void language sql security definer set search_path='' as $$
 update public.restaurant_recommendation_sheets s set metadata=jsonb_set(s.metadata,'{budget}',
  private.recommendation_google_budget_v1(s.establishment_id,s.organization_id,p.source_bindings,p.scope->>'as_of'))
 from public.current_report_publications p where s.establishment_id=p_est
  and (p.establishment_id,p.organization_id,p.language,p.report_id,p.source_run_id)=(s.establishment_id,s.organization_id,s.language,s.report_id,s.source_run_id)
$$;

create function private.dispatch_google_place_price_queue() returns bigint language plpgsql security definer set search_path='' as $$
declare rid bigint;ready timestamptz;last_wake timestamptz;begin
 select last_wake_at into last_wake from private.google_place_price_config where enabled for update;
 if not found or last_wake>clock_timestamp()-interval '1 second' or exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) then return null;end if;
 select min(case when status='running' then lease_until else available_at end) into ready from private.google_place_price_jobs
  where status='queued' and available_at<=clock_timestamp()+interval '5 seconds' or status='running' and lease_until<clock_timestamp();
 if ready is null then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-google-place-price-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
   (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
  body:=jsonb_build_object('ready_at',ready),timeout_milliseconds:=180000) into rid;
 update private.google_place_price_config set last_wake_at=clock_timestamp() where singleton;return rid;
exception when others then raise warning 'PLACE_PRICE_WAKE_FAILED_QUEUE_RECOVERY';return null;
end$$;
create function private.place_price_ready_wake() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.dispatch_google_place_price_queue();return new;end$$;
create trigger place_price_queue_wake after insert or update of status on private.google_place_price_jobs for each row
 when(new.status='queued') execute function private.place_price_ready_wake();

create function public.enqueue_google_place_price(p_establishment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.establishments;j uuid;begin
 if not exists(select 1 from private.google_place_price_config where enabled) then return null;end if;
 if exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) then return null;end if;
 select * into e from public.establishments where id=p_establishment and active;
 if not found or e.initialized_at is null then return null;end if;
 if e.google_id is null or e.google_maps_url is null or e.collection_language not in('fr','vi') then return null;end if;
 insert into private.google_place_price_jobs(establishment_id,organization_id,google_id,place_id,google_maps_url,language)
 values(e.id,e.organization_id,e.google_id,e.place_id,e.google_maps_url,e.collection_language)
 on conflict(establishment_id) do nothing returning id into j;
 if j is null then select id into j from private.google_place_price_jobs where establishment_id=e.id;end if;
 return j;
end$$;
create function private.price_after_initial_import() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Isolated failure: never roll back the durable completion of an import.
 perform public.enqueue_google_place_price(new.establishment_id);return new;
exception when others then raise warning 'PLACE_PRICE_ENQUEUE_FAILED_REVIEWS_AVAILABLE';return new;
end$$;
create trigger price_after_initial_import after update of status on public.initial_import_jobs for each row
 when(new.status='completed' and old.status is distinct from new.status and new.request_kind='initial' and new.establishment_id is not null)
 execute function private.price_after_initial_import();

create function public.claim_google_place_price_job(p_worker text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.google_place_price_jobs;s smallint;begin
 if not exists(select 1 from private.google_place_price_config where enabled) or exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('place-price-claim-v1',0));
 update private.google_place_price_jobs set status='unknown',error_code='PLACE_PRICE_OUTCOME_UNKNOWN',finished_at=clock_timestamp(),locked_by=null,lease_until=null
  where status='running' and lease_until<clock_timestamp() and start_attempted_at is not null and run_id is null;
 update private.google_place_price_jobs set status='cancelled',error_code='PLACE_PRICE_ESTABLISHMENT_REMOVED',finished_at=clock_timestamp()
  where status in('queued','running') and establishment_id is null;
 if exists(select 1 from private.google_place_price_jobs where status='running' and lease_until>=clock_timestamp()
  or status='unknown' and start_attempted_at>clock_timestamp()-interval '180 seconds') then return null;end if;
 if exists(select 1 from private.google_place_price_jobs where status='queued' and run_id is not null and available_at>clock_timestamp()) then return null;end if;
 select * into j from private.google_place_price_jobs where (status='queued' and available_at<=clock_timestamp() or status='running' and lease_until<clock_timestamp())
  and establishment_id is not null order by (run_id is not null) desc,created_at,id for update skip locked limit 1;
 if j.id is null then return null;end if;
 if j.run_id is null then
  if j.start_attempted_at is not null then return null;end if;
  s=public.claim_review_provider_slot('place-price:'||j.id,180);
  if s is null then return null;end if;
 else s=j.slot_number;end if;
 update private.google_place_price_jobs set status='running',slot_number=s,locked_by=p_worker,lease_until=clock_timestamp()+interval '90 seconds' where id=j.id returning * into j;
 return to_jsonb(j);
end$$;

create function public.advance_google_place_price_job(p_job uuid,p_worker text,p_action text,p_data jsonb default '{}') returns boolean
language plpgsql security definer set search_path='' as $$
declare j private.google_place_price_jobs;e public.establishments;ob jsonb;known boolean;code text;begin
 select * into j from private.google_place_price_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.locked_by is distinct from p_worker or j.lease_until<=clock_timestamp() then return false;end if;
 select * into e from public.establishments where id=j.establishment_id and organization_id=j.organization_id;
 if e.id is null or (e.google_id,e.place_id) is distinct from (j.google_id,j.place_id) then
  update private.google_place_price_jobs set status='cancelled',error_code='PLACE_PRICE_ESTABLISHMENT_CHANGED',finished_at=clock_timestamp(),locked_by=null,lease_until=null where id=j.id;
  return false;
 end if;
 if p_action='reserve' then
  if j.start_attempted_at is not null or j.run_id is not null or j.attempts<>0 then return false;end if;
  if p_data#>'{input,maxReviews}' is distinct from '0'::jsonb or p_data#>'{input,maxImages}' is distinct from '0'::jsonb
   or p_data#>'{input,maxCrawledPlacesPerSearch}' is distinct from '1'::jsonb
   or jsonb_array_length(p_data#>'{input,startUrls}')<>1 or p_data#>>'{input,startUrls,0,url}' is distinct from j.google_maps_url
   or p_data#>>'{input,language}' is distinct from j.language then raise exception 'PLACE_PRICE_INPUT_INVALID';end if;
  update private.google_place_price_jobs set start_attempted_at=clock_timestamp(),attempts=1,request_input=p_data->'input' where id=j.id;
 elsif p_action='run' then
  if j.start_attempted_at is null or nullif(p_data->>'id','') is null or nullif(p_data->>'dataset_id','') is null
   or j.run_id is not null and j.run_id<>p_data->>'id' or j.dataset_id is not null and j.dataset_id<>p_data->>'dataset_id' then raise exception 'PLACE_PRICE_RUN_BINDING_INVALID';end if;
  update private.google_place_price_jobs set run_id=p_data->>'id',dataset_id=p_data->>'dataset_id',provider_status=p_data->>'status',receipt=p_data->'receipt' where id=j.id;
 elsif p_action='defer' then
  if j.run_id is null then raise exception 'PLACE_PRICE_UNKNOWN_CANNOT_CONTINUE';end if;
  update private.google_place_price_jobs set status='queued',available_at=clock_timestamp()+interval '5 seconds',locked_by=null,lease_until=null where id=j.id;
 elsif p_action='finish' then
  ob=p_data->'observation';
  if j.run_id is null or j.provider_status<>'SUCCEEDED' then raise exception 'PLACE_PRICE_SUCCESS_REQUIRED';end if;
  if ob#>>'{raw,cid}' is distinct from j.google_id or j.place_id is not null and ob#>>'{raw,placeId}' is distinct from j.place_id
   or ob->>'language' is distinct from j.language then raise exception 'PLACE_PRICE_IDENTITY_MISMATCH';end if;
  if nullif(ob#>>'{raw,scrapedAt}','') is null then raise exception 'PLACE_PRICE_DATE_REQUIRED';end if;
  known=exists(select 1 from (values(ob#>'{raw,price}'),(ob#>'{raw,priceLevel}'),(ob#>'{raw,priceRange}')) x(v) where v not in('null'::jsonb,'""'::jsonb,'{}'::jsonb));
  update private.google_place_price_jobs set observation=ob,status=case when known then 'completed' else 'not_provided' end,receipt=p_data->'receipt',finished_at=clock_timestamp(),locked_by=null,lease_until=null where id=j.id;
  perform private.refresh_place_price_sheet(j.establishment_id);
 elsif p_action='fail' then
  code=left(coalesce(p_data->>'code','PLACE_PRICE_FAILED'),100);
  update private.google_place_price_jobs set status=case when code='PLACE_PRICE_OUTCOME_UNKNOWN' then 'unknown' when code like '%IDENTITY_MISMATCH' then 'identity_mismatch' else 'failed' end,
   error_code=code,finished_at=clock_timestamp(),locked_by=null,lease_until=null where id=j.id;
  perform private.refresh_place_price_sheet(j.establishment_id);
 else raise exception 'PLACE_PRICE_ACTION_INVALID';end if;
 if p_action in('finish','fail') then
  -- An unknown start may still be running. Keep its provider slot until expiry.
  if p_action='finish' or p_data->>'code'<>'PLACE_PRICE_OUTCOME_UNKNOWN' then
   perform public.release_review_provider_slot(j.slot_number,'place-price:'||j.id,200);
  end if;
  perform private.dispatch_google_place_price_queue();
 end if;
 return true;
end$$;

-- Explicit server-only reuse of a checked, already-paid observation. No HTTP/wake.
create function public.reuse_google_place_price(p_establishment uuid,p_run text,p_dataset text,p_observation jsonb,p_receipt jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.establishments;j uuid;begin
 select * into e from public.establishments where id=p_establishment for update;
 if e.id is null or p_observation#>>'{raw,cid}' is distinct from e.google_id
  or e.place_id is not null and p_observation#>>'{raw,placeId}' is distinct from e.place_id
  or p_observation->>'language' is distinct from e.collection_language
  or p_receipt->>'status'<>'SUCCEEDED' or p_receipt#>'{input,maxReviews}' is distinct from '0'::jsonb
  or nullif(p_observation#>>'{raw,scrapedAt}','') is null or nullif(p_observation#>>'{raw,price}','') is null
  or nullif(p_run,'') is null or nullif(p_dataset,'') is null then raise exception 'PLACE_PRICE_REUSE_INVALID';end if;
 insert into private.google_place_price_jobs(establishment_id,organization_id,google_id,place_id,google_maps_url,language,status,run_id,dataset_id,provider_status,observation,receipt,request_input,reused,finished_at)
 values(e.id,e.organization_id,e.google_id,e.place_id,e.google_maps_url,e.collection_language,'completed',p_run,p_dataset,'SUCCEEDED',p_observation,p_receipt,p_receipt->'input',true,clock_timestamp())
 on conflict(establishment_id) do nothing returning id into j;
 if j is null then select id into j from private.google_place_price_jobs where establishment_id=e.id;end if;
 perform private.refresh_place_price_sheet(e.id);return j;
end$$;

revoke all on function public.enqueue_google_place_price(uuid),public.claim_google_place_price_job(text),public.advance_google_place_price_job(uuid,text,text,jsonb),public.reuse_google_place_price(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_google_place_price(uuid),public.claim_google_place_price_job(text),public.advance_google_place_price_job(uuid,text,text,jsonb),public.reuse_google_place_price(uuid,text,text,jsonb,jsonb) to service_role;
revoke all on function private.dispatch_google_place_price_queue(),private.place_price_ready_wake(),private.price_after_initial_import(),private.refresh_place_price_sheet(uuid) from public,anon,authenticated,service_role;

-- This is queue recovery only: it cannot enqueue a place or refresh a completed one.
select cron.schedule('home-reviews-place-price-queue-v1','* * * * *','select private.dispatch_google_place_price_queue()');
commit;
