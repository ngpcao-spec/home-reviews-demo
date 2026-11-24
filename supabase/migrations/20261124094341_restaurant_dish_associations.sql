-- Additive, provider-free culinary associations. Does not alter menus/reviews/reports.
begin;
create function private.dish_key(p text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(lower(translate(regexp_replace(pg_catalog.normalize(coalesce(p,''),'NFD'),U&'[\0300-\036f]','','g'),'Đđ','Dd')),'[^[:alnum:]]+',' ','g'))
$$;
create table private.dish_names (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 key text not null unique, parent_id uuid references private.dish_names, aliases text[] not null default '{}',
 check(parent_id is distinct from id)
);
create index dish_names_parent on private.dish_names(parent_id);
create table private.restaurant_dish_profiles (
 scope text primary key, revision integer not null default 0, source_run text,
 specialty_id uuid references private.dish_names, specialty_status text not null default 'proposed' check(specialty_status in ('proposed','confirmed')),
 specialty_origin text not null default 'automatic' check(specialty_origin in ('automatic','manual')),
 specialty_evidence jsonb not null default '[]', updated_at timestamptz not null default now()
);
create table private.restaurant_dishes (
 scope text references private.restaurant_dish_profiles on delete cascade, dish_id uuid references private.dish_names,
 status text not null check(status in ('proposed','confirmed')), origin text not null check(origin in ('automatic','manual')),
 enabled boolean not null default true, evidence jsonb not null default '[]', updated_at timestamptz not null default now(),
 primary key(scope,dish_id)
);
create index restaurant_dishes_lookup on private.restaurant_dishes(dish_id,scope) where enabled;
create table private.dish_menu_evidence (
 scope text not null, run_id text not null, source_row integer not null, original jsonb not null,
 decision text not null, reason text not null, dish_id uuid references private.dish_names,
 collected_at timestamptz, primary key(scope,run_id,source_row)
);
create table private.dish_edit_history (
 id bigint generated always as identity primary key, scope text not null, actor uuid not null,
 action text not null, before_state jsonb not null, after_state jsonb not null, created_at timestamptz not null default now()
);
alter table private.dish_names enable row level security;
alter table private.restaurant_dish_profiles enable row level security;
alter table private.restaurant_dishes enable row level security;
alter table private.dish_menu_evidence enable row level security;
alter table private.dish_edit_history enable row level security;
revoke all on private.dish_names,private.restaurant_dish_profiles,private.restaurant_dishes,private.dish_menu_evidence,private.dish_edit_history from public,anon,authenticated,service_role;

insert into private.dish_names(name,key,aliases) select name,private.dish_key(name),aliases from (values
 ('Bánh căn',array['banh can']),('Phở',array['pho']),('Pizza',array['pizza']),('Xíu mại',array['xiu mai']),
 ('Bò bít tết',array['beef steak','bo bit tet']),('Bít tết cá ngừ',array['tuna steak','bit tet ca ngu']),
 ('Tôm hùm đút lò',array['oven lobster','tom hum dut lo']),('Spaghetti',array['spaghetti']),('Panini',array['panini'])
) x(name,aliases);
insert into private.dish_names(name,key,parent_id,aliases)
 select x.name,private.dish_key(x.name),d.id,x.aliases from (values
 ('Phở bò','pho',array['pho bo','beef pho']),('Phở gà','pho',array['pho ga','chicken pho']),
 ('Pizza Margherita','pizza',array['pizza margherita'])
) x(name,parent,aliases) join private.dish_names d on d.key=x.parent;

-- Use the existing verified shared identity and pilot/subscription gates. Never join by name.
create function private.dish_scope(p_establishment uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce('shared:'||public.shared_restaurant_for_establishment(e.id)::text,'establishment:'||e.id::text)
 from public.establishments e where e.id=p_establishment and e.active
$$;
create function private.dish_access(p_establishment uuid,p_edit boolean default false) returns text
 language plpgsql stable security definer set search_path='' as $$
declare s text;
begin
 if auth.uid() is null or not exists(select 1 from public.establishments e join public.organization_members m on m.organization_id=e.organization_id
  where e.id=p_establishment and e.active and m.user_id=auth.uid() and (not p_edit or m.role in ('owner','admin','manager')))
 then raise exception 'DISH_FORBIDDEN'; end if;
 s:=private.dish_scope(p_establishment);
 if s is null then raise exception 'DISH_FORBIDDEN'; end if;
 return s;
end$$;

-- Phrase tokens, not arbitrary substrings. Catalog identities are language-independent.
create function private.dish_phrase(p_text text,p_phrase text) returns boolean language sql immutable set search_path='' as $$
 select position(' '||p_phrase||' ' in ' '||p_text||' ')>0
$$;
create function private.derive_menu_dishes(p_scope text,p_name text,p_place text,p_run text,p_raw jsonb,p_date timestamptz,p_excluded jsonb default '[]')
 returns void language plpgsql security definer set search_path='' as $$
declare item record; row_name text; section text; restaurant_name text:=private.dish_key(p_name);
 d private.dish_names; root private.dish_names; decision text; reason text; proof jsonb; candidates uuid[]; chosen uuid;
begin
 if jsonb_typeof(p_raw) is distinct from 'array' or p_run is null then return; end if;
 -- Catalog rows can be encountered in opposite orders in two menu imports.
 -- Serialize catalog writers before taking a profile lock to avoid deadlocks.
 perform pg_catalog.pg_advisory_xact_lock(73116901);
 insert into private.restaurant_dish_profiles(scope) values(p_scope) on conflict do nothing;
 perform 1 from private.restaurant_dish_profiles where scope=p_scope for update;
 if (select source_run from private.restaurant_dish_profiles where scope=p_scope)=p_run then return; end if;
 -- Previous evidence is archived; only the automatic current projection is replaced.
 update private.restaurant_dishes set enabled=false where scope=p_scope and origin='automatic';
 for item in select value,ordinality::integer n from jsonb_array_elements(p_raw) with ordinality loop
  if item.value->>'placeId' is distinct from p_place then raise exception 'DISH_MENU_IDENTITY_MISMATCH'; end if;
  row_name:=private.dish_key(item.value->>'name'); section:=private.dish_key(item.value->>'category');
  d:=null;root:=null;decision:='review';reason:='unrecognized_or_ambiguous';
  -- Only names/sections are considered, never ingredients mentioned in descriptions.
  if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_excluded)='array' then p_excluded else '[]' end) x where x->>'sourceRow'=item.n::text)
   or row_name in ('tra da','nuoc ngot','nuoc suoi','dua xiem','iced tea','soft drinks','coffee','beer','wine') then
   decision:='excluded';reason:='beverage';
  elsif section ~ '^(do uong|drinks|beverages|boissons)( |$)' then
   if exists(select 1 from private.dish_names where key=row_name or row_name=any(aliases))
    or row_name ~ '\m(pizza|steak|cake|gateau|chicken|beef|salad|soup|sauce)\M' then
    decision:='review';reason:='food_beverage_context_conflict';
   else decision:='excluded';reason:='beverage';end if;
  elsif row_name in ('khan lanh','cold wet tissue','wet tissue','serviette') then
   decision:='excluded';reason:='non_food';
  else
   select * into d from private.dish_names where key=row_name or row_name=any(aliases) order by key limit 1;
   if d.id is not null then reason:='exact_menu_name'; end if;
   if d.id is null and private.dish_phrase(section,'banh can')
    and row_name ~ '^(trung ga|trung cut|thap cam)( |$)' then
    select * into root from private.dish_names where key='banh can';
   elsif d.id is null and (section='pho' or section='pho bo' or section='pho ga') and row_name in ('bo','ga') then
    select * into d from private.dish_names where key='pho '||row_name;
    reason:='explicit_menu_context';
   end if;
   -- Preparation context wins over a topping that also names another dish.
   if (section='pizza' or section='classic pizza') and row_name<>'' then
    select * into root from private.dish_names where key='pizza';
    if d.id=root.id or d.parent_id=root.id then root:=null; else d:=null; end if;
   end if;
   if root.id is not null and length(root.name||' · '||btrim(item.value->>'name'))<=100 then
    insert into private.dish_names(name,key,parent_id) values(root.name||' · '||btrim(item.value->>'name'),private.dish_key(root.name||' '||row_name),root.id)
     on conflict(key) do nothing;
    select * into d from private.dish_names where key=private.dish_key(root.name||' '||row_name) and parent_id=root.id;
    reason:='explicit_menu_context';
   end if;
   if d.id is not null then
    decision:='associated';
    proof:=jsonb_build_object('runId',p_run,'sourceRow',item.n,'name',item.value->>'name','section',item.value->>'category',
      'restaurantName',p_name,'photo',item.value->>'menuImageUrl','collectedAt',p_date,'reason',reason,'variantOf',root.name);
    insert into private.restaurant_dishes(scope,dish_id,status,origin,evidence)
     values(p_scope,d.id,'proposed','automatic',jsonb_build_array(proof))
     on conflict(scope,dish_id) do update set enabled=case when restaurant_dishes.origin='automatic' then true else restaurant_dishes.enabled end,
      evidence=case when restaurant_dishes.origin='automatic' and not restaurant_dishes.enabled then excluded.evidence
       when not restaurant_dishes.evidence @> excluded.evidence then restaurant_dishes.evidence||excluded.evidence else restaurant_dishes.evidence end,
      updated_at=now();
   end if;
  end if;
  insert into private.dish_menu_evidence(scope,run_id,source_row,original,decision,reason,dish_id,collected_at)
   values(p_scope,p_run,item.n,item.value,decision,reason,d.id,p_date) on conflict do nothing;
 end loop;
 select array_agg(distinct coalesce(n.parent_id,n.id)) into candidates
  from private.restaurant_dishes a join private.dish_names n on n.id=a.dish_id
  join private.dish_names r on r.id=coalesce(n.parent_id,n.id)
  where a.scope=p_scope and a.enabled and exists(select 1 from private.dish_menu_evidence v where v.scope=p_scope and v.run_id=p_run and v.dish_id=a.dish_id and v.decision='associated')
   and private.dish_phrase(restaurant_name,r.key)
   and not (r.key='pho' and private.dish_phrase(restaurant_name,'pho mai'));
 if cardinality(candidates)=1 then chosen:=candidates[1]; end if;
 update private.restaurant_dish_profiles set source_run=p_run,revision=revision+1,updated_at=now(),
  specialty_id=case when specialty_origin='automatic' then chosen else specialty_id end,
  specialty_evidence=case when specialty_origin='automatic' then jsonb_build_object('restaurantName',p_name,'runId',p_run,'reason','concordant_name_and_menu') else specialty_evidence end
 where scope=p_scope;
end$$;

create function private.refresh_restaurant_dishes(p_establishment uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.establishments; s text; saved record;
begin
 select * into e from public.establishments where id=p_establishment and active;
 if e.id is null then return; end if;
 s:=private.dish_scope(e.id);
 select * into saved from (
  select coalesce(j.run_id,j.reused_run_id) run_id,j.raw,coalesce(j.retrieved_at,j.created_at) collected_at,j.result->'excludedDrinks' excluded from public.rainminer_menu_jobs j
   where j.status='completed' and j.place_id=e.place_id and (j.establishment_id=e.id or exists(select 1 from private.rainminer_menu_requests r where r.job_id=j.id and r.establishment_id=e.id))
  union all
  select v.run_id,v.raw,v.collected_at,v.menu_references->'excludedDrinks' from private.shared_restaurant_menu_versions v
   where v.restaurant_id=public.shared_restaurant_for_establishment(e.id)
 ) t where jsonb_typeof(raw)='array' and run_id is not null order by collected_at desc,run_id limit 1;
 if saved.run_id is not null then perform private.derive_menu_dishes(s,e.name,e.place_id,saved.run_id,saved.raw,saved.collected_at,saved.excluded); end if;
end$$;
create function private.capture_menu_dishes() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 for target in select establishment_id from (select new.establishment_id establishment_id union select establishment_id from private.rainminer_menu_requests where job_id=new.id) t where establishment_id is not null order by establishment_id loop
  perform private.refresh_restaurant_dishes(target);
 end loop;
 return new;
end$$;
create trigger capture_menu_dishes after insert or update of status,raw on public.rainminer_menu_jobs
 for each row when(new.status='completed') execute function private.capture_menu_dishes();
create function private.capture_dish_target() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.refresh_restaurant_dishes(new.establishment_id);return new;end$$;
create trigger capture_dish_menu_request after insert on private.rainminer_menu_requests for each row execute function private.capture_dish_target();
create trigger capture_dish_shared_link after insert or update on private.shared_restaurant_establishments for each row execute function private.capture_dish_target();

create function public.read_restaurant_dishes(p_establishment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s text:=private.dish_access(p_establishment); output jsonb;
begin
 select jsonb_build_object('revision',coalesce(p.revision,0),'shared',s like 'shared:%',
 'canEdit',exists(select 1 from public.organization_members m join public.establishments e on e.organization_id=m.organization_id where e.id=p_establishment and m.user_id=auth.uid() and m.role in ('owner','admin','manager')),
 'specialty',case when d.id is not null then jsonb_build_object('id',d.id,'name',d.name,'status',p.specialty_status,'origin',p.specialty_origin,'evidence',p.specialty_evidence) end,
 'associations',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'parentId',n.parent_id,'parentName',r.name,'status',a.status,'origin',a.origin,'evidence',a.evidence) order by n.key)
  from private.restaurant_dishes a join private.dish_names n on n.id=a.dish_id left join private.dish_names r on r.id=n.parent_id where a.scope=s and a.enabled),'[]'),
 'unresolved',coalesce((select jsonb_agg(jsonb_build_object('name',v.original->>'name','section',v.original->>'category','sourceRow',v.source_row,'runId',v.run_id,'reason',v.reason)) from private.dish_menu_evidence v where v.scope=s and v.run_id=p.source_run and v.decision='review'),'[]'))
 into output from (select 1) seed left join private.restaurant_dish_profiles p on p.scope=s left join private.dish_names d on d.id=p.specialty_id;
 return output;
end$$;
create function public.list_dish_names() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'DISH_FORBIDDEN'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'parentId',parent_id) order by key),'[]') from private.dish_names);
end$$;
create function public.edit_restaurant_dishes(p_establishment uuid,p_revision integer,p_action text,p_dish uuid default null,p_name text default null,p_parent uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s text:=private.dish_access(p_establishment,true); previous jsonb; d uuid:=p_dish; k text; revision_now integer;
begin
 if p_action is null or p_action not in ('specialty','add','confirm','remove') then raise exception 'DISH_INVALID_ACTION'; end if;
 perform pg_catalog.pg_advisory_xact_lock(73116901);
 insert into private.restaurant_dish_profiles(scope) values(s) on conflict do nothing;
 select revision into revision_now from private.restaurant_dish_profiles where scope=s for update;
 if p_revision is null or revision_now<>p_revision then raise exception 'DISH_CONFLICT'; end if;
 previous:=public.read_restaurant_dishes(p_establishment);
 if p_name is not null then
  k:=private.dish_key(p_name);
  if length(btrim(p_name)) not between 1 and 100 or k='' or k in ('soupes','nouilles','soup','noodles','trung ga','trung cut','thap cam','tra da','nuoc ngot','nuoc suoi','do uong','drinks','coffee','beer','wine','khan lanh') then raise exception 'DISH_PRECISE_FOOD_NAME_REQUIRED'; end if;
  if p_parent is not null and not exists(select 1 from private.dish_names where id=p_parent and parent_id is null) then raise exception 'DISH_INVALID_PARENT'; end if;
  select id into d from private.dish_names where key=k or k=any(aliases) order by (key=k) desc limit 1;
  if d is null then
   insert into private.dish_names(name,key,parent_id) values(btrim(p_name),k,p_parent) returning id into d;
  elsif not exists(select 1 from private.dish_names where id=d and parent_id is not distinct from p_parent) then
   raise exception 'DISH_NAME_PARENT_CONFLICT';
  end if;
  if d is null then raise exception 'DISH_NAME_PARENT_CONFLICT'; end if;
 end if;
 if d is not null and not exists(select 1 from private.dish_names where id=d) then raise exception 'DISH_NOT_FOUND'; end if;
 if d is null and p_action<>'specialty' then raise exception 'DISH_REQUIRED'; end if;
 if p_action='specialty' then
  update private.restaurant_dish_profiles set specialty_id=d,specialty_status='confirmed',specialty_origin='manual',
   specialty_evidence=jsonb_build_object('reason','manual_confirmation','at',now(),'previousEvidence',specialty_evidence) where scope=s;
 elsif p_action='confirm' and not exists(select 1 from private.restaurant_dishes where scope=s and dish_id=d and enabled) then raise exception 'DISH_NOT_FOUND';
 end if;
 if d is not null then
  insert into private.restaurant_dishes(scope,dish_id,status,origin,enabled,evidence)
   values(s,d,'confirmed','manual',p_action<>'remove',jsonb_build_array(jsonb_build_object('reason','manual_confirmation','at',now())))
   on conflict(scope,dish_id) do update set status='confirmed',origin='manual',enabled=excluded.enabled,updated_at=now();
 end if;
 if p_action='remove' then update private.restaurant_dish_profiles set specialty_id=null,specialty_origin='manual' where scope=s and specialty_id=d; end if;
 update private.restaurant_dish_profiles set revision=revision+1,updated_at=now() where scope=s;
 insert into private.dish_edit_history(scope,actor,action,before_state,after_state) values(s,auth.uid(),p_action,previous,public.read_restaurant_dishes(p_establishment));
 return public.read_restaurant_dishes(p_establishment);
end$$;

create function public.search_restaurants_by_dish(p_query text) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  select e.id,e.name,d.name dish,case when p.specialty_id in(select id from wanted) then p.specialty_status else a.status end status,p.specialty_id in(select id from wanted) specialized,
   row_number() over(partition by e.id order by (p.specialty_id in(select id from wanted)) desc nulls last,(a.status='confirmed') desc,d.key) n
  from accessible e join private.restaurant_dishes a on a.scope=e.scope and a.enabled
  join wanted w on w.id=a.dish_id join private.dish_names d on d.id=w.id join private.restaurant_dish_profiles p on p.scope=e.scope
  where a.status='confirmed' or exists(select 1 from jsonb_array_elements(a.evidence) v where v->>'reason' in ('exact_menu_name','explicit_menu_context'))
 ) select coalesce(jsonb_agg(jsonb_build_object('establishmentId',id,'name',name,'dish',dish,'kind',case when specialized then 'specialty' else 'menu' end,'status',status)
 order by specialized desc nulls last,(status='confirmed') desc,name,id),'[]') from matches where n=1);
end$$;

-- Seed only already-saved menus. No external call and no historical menu mutation.
do $$declare target uuid;begin
 for target in select id from public.establishments where active order by id loop perform private.refresh_restaurant_dishes(target);end loop;
end$$;
revoke all on function private.dish_key(text),private.dish_scope(uuid),private.dish_access(uuid,boolean),private.dish_phrase(text,text),private.derive_menu_dishes(text,text,text,text,jsonb,timestamptz,jsonb),private.refresh_restaurant_dishes(uuid),private.capture_menu_dishes(),private.capture_dish_target() from public,anon,authenticated,service_role;
revoke all on function public.read_restaurant_dishes(uuid),public.list_dish_names(),public.edit_restaurant_dishes(uuid,integer,text,uuid,text,uuid),public.search_restaurants_by_dish(text) from public,anon,service_role;
grant execute on function public.read_restaurant_dishes(uuid),public.list_dish_names(),public.edit_restaurant_dishes(uuid,integer,text,uuid,text,uuid),public.search_restaurants_by_dish(text) to authenticated;
commit;
