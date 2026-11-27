begin;

create table private.menu_dish_ai_settings (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false,
 enabled_since timestamptz check (not enabled or enabled_since is not null),
 model text not null default 'gpt-5.4-nano' check (model ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$')
);
insert into private.menu_dish_ai_settings default values;

create table private.menu_dish_ai_runs (
 id uuid primary key default gen_random_uuid(),
 place_id text not null,
 fingerprint text not null,
 model text not null,
 contract text not null,
 packet jsonb not null,
 status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
 lease_id uuid,
 lease_until timestamptz,
 result jsonb,
 usage jsonb,
 raw_response text,
 error_code text,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(place_id,fingerprint,model,contract)
);
create index menu_dish_ai_due on private.menu_dish_ai_runs(status,created_at,id)
 where status in ('queued','running');

create table private.menu_dish_ai_targets (
 scope text primary key,
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 source_run text not null,
 collected_at timestamptz,
 source_raw jsonb not null,
 run_id uuid references private.menu_dish_ai_runs,
 admission_error text,
 published_id uuid references private.menu_dish_ai_runs,
 published_source_run text
);
create index menu_dish_ai_targets_run on private.menu_dish_ai_targets(run_id);
alter table private.menu_dish_ai_settings enable row level security;
alter table private.menu_dish_ai_runs enable row level security;
alter table private.menu_dish_ai_targets enable row level security;
revoke all on private.menu_dish_ai_settings,private.menu_dish_ai_runs,private.menu_dish_ai_targets from public,anon,authenticated,service_role;

-- Identity and projection are separate: cache the interpretation by Google
-- Place ID, but publish it only through the existing authorized menu scopes.
create function private.menu_dish_ai_name(p_name text)
returns uuid language plpgsql set search_path='' as $$
declare k text:=private.dish_key(p_name); id_out uuid;
begin
 if length(p_name) not between 1 and 100 or k='' then raise exception 'MENU_AI_INVALID_NAME'; end if;
 select n.id into id_out from private.dish_names n
 where n.key=k or k=any(n.aliases) order by (n.key=k) desc,n.key limit 1;
 if id_out is null then
  insert into private.dish_names(name,key) values(p_name,k) returning id into id_out;
 end if;
 return id_out;
end$$;

create function private.publish_menu_dish_ai(p_scope text) returns void
language plpgsql set search_path='' as $$
declare t private.menu_dish_ai_targets; ai private.menu_dish_ai_runs; item jsonb; source jsonb;
 n int; d uuid; decision text; reason text; proof jsonb; chosen uuid; inserted int;
begin
 select * into strict t from private.menu_dish_ai_targets where scope=p_scope;
 if private.dish_scope(t.establishment_id) is distinct from p_scope then return; end if;
 if t.published_id=t.run_id and t.published_source_run=t.source_run then return; end if;
 select * into strict ai from private.menu_dish_ai_runs where id=t.run_id and status='succeeded';
 if not exists(select 1 from public.establishments where id=t.establishment_id and active and place_id=ai.place_id)
  then return; end if;
 insert into private.restaurant_dish_profiles(scope) values(p_scope) on conflict do nothing;
 perform 1 from private.restaurant_dish_profiles where scope=p_scope for update;
 update private.restaurant_dishes set enabled=false where scope=p_scope and origin='automatic';

 for item in select value from jsonb_array_elements(ai.result->'items') loop
  d:=null;
  if item->>'kind'='dish' then
   d:=private.menu_dish_ai_name(item->>'name');
   decision:='associated'; reason:='ai_menu_classification';
  elsif item->>'kind'='other' then
   decision:='review'; reason:='other';
  else
   decision:='excluded';
   reason:=case item->>'kind' when 'drink' then 'beverage' else 'non_food' end;
  end if;
  n:=(item->>'row')::int;
  source:=t.source_raw->(n-1);
  if n is null or n<1 or source is null or source->>'placeId' is distinct from ai.place_id
   then raise exception 'MENU_AI_SOURCE_CHANGED'; end if;
  insert into private.dish_menu_evidence(scope,run_id,source_row,original,decision,reason,dish_id,collected_at)
   values(p_scope,t.source_run,n,source,decision,reason,d,t.collected_at)
  on conflict(scope,run_id,source_row) do update
  set decision=excluded.decision,reason=excluded.reason,dish_id=excluded.dish_id
  where dish_menu_evidence.original=excluded.original;
  get diagnostics inserted=row_count;
  if inserted<>1 then raise exception 'MENU_AI_SOURCE_CHANGED'; end if;
  if d is not null then
   proof:=jsonb_build_array(jsonb_build_object('runId',t.source_run,'sourceRow',n,'name',source->>'name',
    'section',source->>'category','photo',source->>'menuImageUrl','collectedAt',t.collected_at,'reason',reason));
   insert into private.restaurant_dishes(scope,dish_id,status,origin,evidence)
    values(p_scope,d,'proposed','automatic',proof)
   on conflict(scope,dish_id) do update set
    enabled=case when restaurant_dishes.origin='manual' then restaurant_dishes.enabled else true end,
    evidence=case when restaurant_dishes.origin='manual' then restaurant_dishes.evidence
     when restaurant_dishes.enabled then restaurant_dishes.evidence||excluded.evidence else excluded.evidence end,
    updated_at=now();
  end if;
 end loop;
 if ai.result#>>'{specialty,name}' is not null then
  chosen:=private.menu_dish_ai_name(ai.result#>>'{specialty,name}');
  -- A manually removed dish cannot still produce an automatic specialty.
  if not exists(select 1 from private.restaurant_dishes a
   where a.scope=p_scope and a.enabled and a.dish_id=chosen
    and exists(select 1 from private.dish_menu_evidence e
     where e.scope=p_scope and e.run_id=t.source_run and e.dish_id=a.dish_id
      and (ai.result->'specialty'->'rows') @> jsonb_build_array(e.source_row))) then chosen:=null; end if;
 end if;
 update private.restaurant_dish_profiles set source_run=t.source_run,revision=revision+1,updated_at=now(),
   specialty_id=case when specialty_origin='automatic' then chosen else specialty_id end,
   specialty_evidence=case when specialty_origin='automatic' then
    jsonb_build_object('reason','ai_menu_classification','runId',t.source_run,'rows',ai.result#>'{specialty,rows}')
    else specialty_evidence end
 where scope=p_scope;
 update private.menu_dish_ai_targets
 set published_id=ai.id,published_source_run=t.source_run,admission_error=null where scope=p_scope;
end$$;

create function private.menu_dish_ai_packet(p_raw jsonb,p_excluded jsonb,p_restaurant text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'restaurant',coalesce(nullif(btrim(p_raw->0->>'placeName'),''),p_restaurant),
  'lines',coalesce(jsonb_agg(jsonb_build_object('id',n,'name',r->>'name','section',r->>'category','description',r->>'description',
   'price',r->'price','priceText',r->>'priceText','currency',r->>'currency',
   'knownDrink',exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_excluded)='array' then p_excluded else '[]' end) d
   where d->>'sourceRow'=n::text)) order by n),'[]'::jsonb))
 from jsonb_array_elements(case when jsonb_typeof(p_raw)='array' then p_raw else '[]'::jsonb end) with ordinality m(r,n)
$$;

alter function private.refresh_restaurant_dishes(uuid) rename to refresh_restaurant_dishes_before_ai;
create function private.refresh_restaurant_dishes(p_establishment uuid) returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.menu_dish_ai_settings; e public.establishments; s text; saved record;
 input_packet jsonb; content_hash text; id_out uuid; state text; gate_error text;
begin
 select * into cfg from private.menu_dish_ai_settings where singleton;
 s:=private.dish_scope(p_establishment);
 if s is null then return; end if;
 if not cfg.enabled then
  if not exists(select 1 from private.menu_dish_ai_targets where scope=s) then
   perform private.refresh_restaurant_dishes_before_ai(p_establishment);
  end if;
  return;
 end if;
 -- Follow the same lock order as manual edits and publication.
 perform pg_catalog.pg_advisory_xact_lock(73116901);
 select * into e from public.establishments where id=p_establishment and active;
 if e.id is null or e.place_id is null then return; end if;
 select * into saved from (
  select coalesce(j.run_id,j.reused_run_id) run_id,j.raw,coalesce(j.retrieved_at,j.created_at) collected_at,j.result->'excludedDrinks' excluded
  from public.rainminer_menu_jobs j where j.status='completed' and j.place_id=e.place_id and
   (j.establishment_id=e.id or exists(select 1 from private.rainminer_menu_requests r where r.job_id=j.id and r.establishment_id=e.id and r.place_id=e.place_id))
  union all
  select v.run_id,v.raw,v.collected_at,v.menu_references->'excludedDrinks' from private.shared_restaurant_menu_versions v
   where v.restaurant_id=public.shared_restaurant_for_establishment(e.id)
 ) m where jsonb_typeof(raw)='array' and run_id is not null order by collected_at desc,run_id limit 1;
 if saved.run_id is null then return; end if;
 if jsonb_array_length(saved.raw)>100 or exists(select 1 from jsonb_array_elements(saved.raw) x
   where x->>'placeId' is distinct from e.place_id) then
  gate_error:='MENU_AI_SOURCE_INVALID';
 else
  input_packet:=private.menu_dish_ai_packet(saved.raw,saved.excluded,e.name);
  if octet_length(input_packet::text)>48000 then
   gate_error:='MENU_AI_SOURCE_TOO_LARGE';
  else
   content_hash:=encode(sha256(convert_to(input_packet::text,'UTF8')),'hex');
   select id,status into id_out,state from private.menu_dish_ai_runs
    where place_id=e.place_id and fingerprint=content_hash and model=cfg.model and contract='menu-dish-ai-v6';
   -- Sharing an old menu, or receiving the same content again under a new run ID,
   -- must not create a billable job for a pre-activation menu.
   if id_out is null and (saved.collected_at<cfg.enabled_since or exists(
    select 1 from public.rainminer_menu_jobs old where old.place_id=e.place_id and old.status='completed'
     and coalesce(old.retrieved_at,old.created_at)<cfg.enabled_since and jsonb_typeof(old.raw)='array'
     and private.menu_dish_ai_packet(old.raw,old.result->'excludedDrinks',e.name)=input_packet
    union all
    select 1 from private.shared_restaurant_menu_versions old join private.shared_restaurants sr on sr.id=old.restaurant_id
     where sr.place_id=e.place_id and old.collected_at<cfg.enabled_since and jsonb_typeof(old.raw)='array'
     and private.menu_dish_ai_packet(old.raw,old.menu_references->'excludedDrinks',e.name)=input_packet
   )) then
    if not exists(select 1 from private.menu_dish_ai_targets where scope=s) then
     perform private.refresh_restaurant_dishes_before_ai(p_establishment);
    end if;
    return;
   end if;
   insert into private.menu_dish_ai_runs(place_id,fingerprint,model,contract,packet,status,result,finished_at)
    values(e.place_id,content_hash,cfg.model,'menu-dish-ai-v6',input_packet,
     case when jsonb_array_length(saved.raw)=0 then 'succeeded' else 'queued' end,
     case when jsonb_array_length(saved.raw)=0 then
      '{"items":[],"specialty":null,"menu_profile":{"value":"unknown","rows":[],"sections":[]},"restaurant_type":{"value":"unknown","name_evidence":null,"rows":[]}}'::jsonb end,
     case when jsonb_array_length(saved.raw)=0 then now() end)
   on conflict(place_id,fingerprint,model,contract) do nothing;
   select id,status into strict id_out,state from private.menu_dish_ai_runs
    where place_id=e.place_id and fingerprint=content_hash and model=cfg.model and contract='menu-dish-ai-v6';
  end if;
 end if;
 insert into private.menu_dish_ai_targets(scope,establishment_id,source_run,collected_at,source_raw,run_id,admission_error)
  values(s,e.id,saved.run_id,saved.collected_at,saved.raw,id_out,gate_error)
 on conflict(scope) do update set establishment_id=excluded.establishment_id,source_run=excluded.source_run,
  collected_at=excluded.collected_at,source_raw=excluded.source_raw,run_id=excluded.run_id,admission_error=excluded.admission_error
 where (menu_dish_ai_targets.run_id,menu_dish_ai_targets.source_run,menu_dish_ai_targets.establishment_id)
   is distinct from (excluded.run_id,excluded.source_run,excluded.establishment_id);
 if state='succeeded' then
  begin
   perform private.publish_menu_dish_ai(s);
  exception when others then
   update private.menu_dish_ai_targets set admission_error='MENU_AI_PUBLISH_FAILED' where scope=s;
  end;
 end if;
end$$;

-- A lost response or expired worker does not reserve another paid attempt.
create function public.claim_menu_dish_ai()
returns table(id uuid,lease_id uuid,model text,contract text,packet jsonb)
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.menu_dish_ai_settings where singleton and enabled) then return; end if;
 update private.menu_dish_ai_runs set status='failed',error_code='MENU_AI_OUTCOME_UNKNOWN',finished_at=now()
  where status='running' and lease_until<=now();
 return query with candidate as (
  select j.id from private.menu_dish_ai_runs j where j.status='queued' and exists(
   select 1 from private.menu_dish_ai_targets t where t.run_id=j.id and private.dish_scope(t.establishment_id)=t.scope
  ) order by j.created_at,j.id for update skip locked limit 1
 )
 update private.menu_dish_ai_runs r set status='running',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 from candidate c where r.id=c.id returning r.id,r.lease_id,r.model,r.contract,r.packet;
end$$;

create function public.finish_menu_dish_ai(p_id uuid,p_lease uuid,p_result jsonb,p_usage jsonb,p_error text,p_raw_response text default null)
returns text language plpgsql security definer set search_path='' as $$
declare target text;
begin
 perform pg_catalog.pg_advisory_xact_lock(73116901);
 perform 1 from private.menu_dish_ai_runs where id=p_id and status='running' and lease_id=p_lease and lease_until>now() for update;
 if not found then return null; end if;
 if p_result is not null and p_error is null then
  begin
   update private.menu_dish_ai_runs set status='succeeded',result=p_result,usage=p_usage,raw_response=p_raw_response,finished_at=now() where id=p_id;
   for target in select scope from private.menu_dish_ai_targets where run_id=p_id order by scope loop
    perform private.publish_menu_dish_ai(target);
   end loop;
   return 'succeeded';
  exception when others then
   p_error:='MENU_AI_PUBLISH_FAILED';
  end;
 end if;
 update private.menu_dish_ai_runs set status='failed',usage=p_usage,raw_response=p_raw_response,
  error_code=coalesce(p_error,'MENU_AI_INVALID_RESULT'),finished_at=now() where id=p_id;
 return 'failed';
end$$;

create function private.menu_dish_ai_status(p_scope text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('state',case when t.admission_error is not null then 'failed' else j.status end,
  'sourceRun',t.source_run,'stale',p.source_run is not null and
   (t.published_id,t.published_source_run) is distinct from (t.run_id,t.source_run),
  'specialtyNeedsConfirmation',coalesce(j.status='succeeded' and t.admission_error is null and
   t.published_id=t.run_id and p.specialty_origin='automatic' and p.specialty_id is null,false))
 from private.menu_dish_ai_targets t left join private.menu_dish_ai_runs j on j.id=t.run_id
 left join private.restaurant_dish_profiles p on p.scope=t.scope where t.scope=p_scope
$$;

alter function public.read_restaurant_dishes(uuid) rename to read_restaurant_dishes_before_ai;
revoke all on function public.read_restaurant_dishes_before_ai(uuid) from public,anon,authenticated,service_role;
create function public.read_restaurant_dishes(p_establishment uuid) returns jsonb
language sql security definer set search_path='' as $$
 select public.read_restaurant_dishes_before_ai(p_establishment)||
  jsonb_build_object('classification',private.menu_dish_ai_status(access.scope),
   'menuProfile',published.result#>>'{menu_profile,value}',
   'restaurantType',published.result#>>'{restaurant_type,value}')
 from (select private.dish_access(p_establishment) scope) access
 left join private.menu_dish_ai_targets t on t.scope=access.scope
 left join private.menu_dish_ai_runs published on published.id=t.published_id
$$;

revoke all on function private.menu_dish_ai_name(text),private.publish_menu_dish_ai(text),
 private.menu_dish_ai_packet(jsonb,jsonb,text),private.refresh_restaurant_dishes(uuid),
 private.menu_dish_ai_status(text) from public,anon,authenticated,service_role;
revoke all on function public.claim_menu_dish_ai(),public.finish_menu_dish_ai(uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_menu_dish_ai(),public.finish_menu_dish_ai(uuid,uuid,jsonb,jsonb,text,text) to service_role;
revoke all on function public.read_restaurant_dishes(uuid) from public,anon,service_role;
grant execute on function public.read_restaurant_dishes(uuid) to authenticated;

create or replace function public.search_restaurants_by_dish(p_query text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=private.dish_key(p_query);
begin
 if auth.uid() is null then raise exception 'DISH_FORBIDDEN'; end if;
 if length(q) not between 1 and 100 then return '[]'; end if;
 return (with recursive wanted as (
  select id from private.dish_names where key=q or q=any(aliases)
  union select d.id from private.dish_names d join wanted w on d.parent_id=w.id
 ), accessible as (
  select e.id,e.name,private.dish_scope(e.id) scope from public.establishments e where e.active and exists(select 1 from public.organization_members m where m.organization_id=e.organization_id and m.user_id=auth.uid())
 ), matches as (
  select e.id,e.name,coalesce((private.menu_dish_ai_status(e.scope)->>'stale')::boolean,false) stale,case when p.specialty_id in(select id from wanted) then specialty.name else d.name end dish,
   case when p.specialty_id in(select id from wanted) then p.specialty_status else a.status end status,p.specialty_id in(select id from wanted) specialized,
   row_number() over(partition by e.id order by (p.specialty_id in(select id from wanted)) desc nulls last,(a.status='confirmed') desc,d.key) n
  from accessible e join private.restaurant_dishes a on a.scope=e.scope and a.enabled
  join wanted w on w.id=a.dish_id join private.dish_names d on d.id=w.id join private.restaurant_dish_profiles p on p.scope=e.scope
  left join private.dish_names specialty on specialty.id=p.specialty_id
  where a.status='confirmed' or exists(select 1 from jsonb_array_elements(a.evidence) v where v->>'reason' in ('exact_menu_name','explicit_menu_context','ai_menu_classification'))
 ) select coalesce(jsonb_agg(jsonb_build_object('establishmentId',id,'name',name,'dish',dish,'kind',case when specialized then 'specialty' else 'menu' end,'status',status,'stale',stale)
 order by specialized desc nulls last,(status='confirmed') desc,name,id),'[]') from matches where n=1);
end$$;

select cron.schedule('home-reviews-menu-dish-ai','* * * * *',$cron$
 select net.http_post(
  url:=worker.decrypted_secret,
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',token.decrypted_secret),
  body:='{"action":"classify-menu"}'::jsonb,timeout_milliseconds:=120000
 ) from vault.decrypted_secrets worker cross join vault.decrypted_secrets token
 where worker.name='home_reviews_rainminer_worker_url' and token.name='home_reviews_scheduler_token'
  and exists(select 1 from private.menu_dish_ai_settings where enabled)
  and exists(select 1 from private.menu_dish_ai_runs where status in ('queued','running'));
$cron$);
commit;
