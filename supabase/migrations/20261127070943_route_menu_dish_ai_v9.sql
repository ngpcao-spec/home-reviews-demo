begin;

-- Pause classification while switching the cache namespace; the deployment restores the existing schedule.

select pg_catalog.pg_advisory_xact_lock(73116901);
lock table private.menu_dish_ai_runs in share row exclusive mode;

do $$
begin
 if exists(select 1 from private.menu_dish_ai_runs where status in ('queued','running')) then
  raise exception 'MENU_AI_PAUSE_AND_DRAIN_REQUIRED';
 end if;
end$$;

update private.menu_dish_ai_settings set enabled=false where singleton and enabled;

-- Prefer v9 for the same menu and keep compatible historical results without a replay.


-- Retain one source page only when Rainminer returned food lines without any headings.
-- The saved raw rows and their original photo URLs remain the publication source.
create or replace function private.menu_dish_ai_packet(p_raw jsonb,p_excluded jsonb,p_restaurant text)
returns jsonb language sql immutable set search_path='' as $$
 with packet as (
  select jsonb_build_object(
   'restaurant',coalesce(nullif(btrim(p_raw->0->>'placeName'),''),p_restaurant),
   'lines',coalesce(jsonb_agg(jsonb_build_object('id',n,'name',r->>'name','section',r->>'category','description',r->>'description',
    'price',r->'price','priceText',r->>'priceText','currency',r->>'currency',
    'knownDrink',exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_excluded)='array' then p_excluded else '[]' end) d
    where d->>'sourceRow'=n::text)) order by n),'[]'::jsonb)) value
  from jsonb_array_elements(case when jsonb_typeof(p_raw)='array' then p_raw else '[]'::jsonb end) with ordinality m(r,n)
 ), food as (
  select (l->>'id')::int id, l->>'name' label, nullif(btrim(l->>'section'),'') heading,
   p_raw->((l->>'id')::int-1)->>'menuImageUrl' url
  from packet, jsonb_array_elements(value->'lines') l
  where not (l->>'knownDrink')::boolean and nullif(btrim(l->>'name'),'') is not null
 ), page as (
  select split_part(url,'=',1) url, jsonb_agg(id order by id) rows
  from food
  where not exists(select 1 from food where heading is not null)
   and length(url)<=1024 and url ~ '^https://lh[0-9]+[.]googleusercontent[.]com/gps-cs-s/[A-Za-z0-9_-]+(=[A-Za-z0-9-]+)?$'
  group by split_part(url,'=',1)
  having count(distinct btrim(lower(label)))>=2
  order by count(*) desc,min(id)
  limit 1
 )
 select packet.value||coalesce(
  (select jsonb_build_object('photo',jsonb_build_object('url',url,'rows',rows)) from page),'{}'::jsonb)
 from packet
$$;

create or replace function private.refresh_restaurant_dishes(p_establishment uuid) returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.menu_dish_ai_settings; e public.establishments; s text; saved record;
 input_packet jsonb; content_hash text; text_hash text; id_out uuid; state text; gate_error text;
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
 select * into cfg from private.menu_dish_ai_settings where singleton;
 if not cfg.enabled then return; end if;
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
   text_hash:=encode(sha256(convert_to((input_packet-'photo')::text,'UTF8')),'hex');
   select id,status into id_out,state from private.menu_dish_ai_runs
    where place_id=e.place_id and model=cfg.model
     and ((contract='menu-dish-ai-v9' and fingerprint=content_hash)
       or (contract in ('menu-dish-ai-v6','menu-dish-ai-v7','menu-dish-ai-v8') and status='succeeded' and fingerprint=text_hash))
    order by case contract when 'menu-dish-ai-v9' then 0 when 'menu-dish-ai-v8' then 1 when 'menu-dish-ai-v7' then 2 else 3 end limit 1;
   -- Sharing an old menu, or receiving the same content again under a new run ID,
   -- must not create a billable job for a pre-activation menu.
   if id_out is null and (saved.collected_at<cfg.enabled_since or exists(
    select 1 from public.rainminer_menu_jobs old where old.place_id=e.place_id and old.status='completed'
     and coalesce(old.retrieved_at,old.created_at)<cfg.enabled_since and jsonb_typeof(old.raw)='array'
     and private.menu_dish_ai_packet(old.raw,old.result->'excludedDrinks',e.name)-'photo'=(input_packet-'photo')
    union all
    select 1 from private.shared_restaurant_menu_versions old join private.shared_restaurants sr on sr.id=old.restaurant_id
     where sr.place_id=e.place_id and old.collected_at<cfg.enabled_since and jsonb_typeof(old.raw)='array'
     and private.menu_dish_ai_packet(old.raw,old.menu_references->'excludedDrinks',e.name)-'photo'=(input_packet-'photo')
   )) then
    if not exists(select 1 from private.menu_dish_ai_targets where scope=s) then
     perform private.refresh_restaurant_dishes_before_ai(p_establishment);
    end if;
    return;
   end if;
   if id_out is null then
    insert into private.menu_dish_ai_runs(place_id,fingerprint,model,contract,packet,status,result,finished_at)
     values(e.place_id,content_hash,cfg.model,'menu-dish-ai-v9',input_packet,
      case when jsonb_array_length(saved.raw)=0 then 'succeeded' else 'queued' end,
      case when jsonb_array_length(saved.raw)=0 then
       '{"items":[],"specialty":null,"menu_profile":{"value":"unknown","rows":[],"sections":[]},"restaurant_type":{"value":"unknown","name_evidence":null,"rows":[]}}'::jsonb end,
      case when jsonb_array_length(saved.raw)=0 then now() end)
    on conflict(place_id,fingerprint,model,contract) do nothing;
    select id,status into strict id_out,state from private.menu_dish_ai_runs
     where place_id=e.place_id and fingerprint=content_hash and model=cfg.model and contract='menu-dish-ai-v9';
   end if;
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

create or replace function public.claim_menu_dish_ai()
returns table(id uuid,lease_id uuid,model text,contract text,packet jsonb)
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.menu_dish_ai_settings where singleton and enabled) then return; end if;
 update private.menu_dish_ai_runs set status='failed',error_code='MENU_AI_OUTCOME_UNKNOWN',finished_at=now()
  where status='running' and lease_until<=now();
 return query with candidate as (
  select j.id from private.menu_dish_ai_runs j where j.status='queued' and j.contract='menu-dish-ai-v9' and exists(
   select 1 from private.menu_dish_ai_targets t where t.run_id=j.id and private.dish_scope(t.establishment_id)=t.scope
  ) order by j.created_at,j.id for update skip locked limit 1
 )
 update private.menu_dish_ai_runs r set status='running',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 from candidate c where r.id=c.id returning r.id,r.lease_id,r.model,r.contract,r.packet;
end$$;

commit;
