-- Use precise menu headings as evidence for a variant. Category aliases are
-- application configuration; result lines cannot create new section aliases.
begin;

create table private.dish_menu_context_sections (
 section_key text primary key check(section_key<>''),
 dish_id uuid not null references private.dish_names(id)
);
alter table private.dish_menu_context_sections enable row level security;
revoke all on private.dish_menu_context_sections from public,anon,authenticated,service_role;

insert into private.dish_menu_context_sections(section_key,dish_id)
select labels.section_key,d.id
from (values
 ('pho','pho'),('pho nam bac','pho'),('pho bac nam','pho'),
 ('pho bo','pho bo'),('beef pho','pho bo'),
 ('pho ga','pho ga'),('chicken pho','pho ga'),
 ('pizza','pizza'),('pizzas','pizza'),('classic pizza','pizza'),('gourmet pizza','pizza'),
 ('pizzas classiques','pizza'),('pizzas gourmet','pizza'),
 ('spaghetti','spaghetti'),('panini','panini'),('banh can','banh can')
) labels(section_key,dish_key)
join private.dish_names d on d.key=labels.dish_key;

create or replace function private.derive_menu_dishes(p_scope text,p_name text,p_place text,p_run text,p_raw jsonb,p_date timestamptz,p_excluded jsonb default '[]')
 returns void language plpgsql security definer set search_path='' as $$
declare item record; display_name text; row_name text; section text; restaurant_name text:=private.dish_key(p_name);
 pho_variant boolean; pho_parent_key text; variant_name text; variant_key text; extra_context boolean;
 d private.dish_names; root private.dish_names; section_dish private.dish_names;
 decision text; reason text; proof jsonb; candidates uuid[]; chosen uuid;
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
  -- Menu ordinals may be glued to the label, e.g. "20.Phở Đuôi Bò".
  -- Keep the source name intact and strip only a leading numbered label.
  display_name:=btrim(regexp_replace(coalesce(item.value->>'name',''),'^[[:space:]]*[0-9]{1,4}[.)][[:space:]]*(?=[[:alpha:]])',''));
  display_name:=btrim(regexp_replace(display_name,'^[-–—•]+[[:space:]]*',''));
  row_name:=private.dish_key(display_name); section:=private.dish_key(item.value->>'category');
  pho_variant:=row_name ~ '^pho ((bo )?(tai|nam|chin|gau|gan|loi|duoi|suon|steak)( (tai|nam|chin|gau|gan|loi|duoi|suon|steak|bo))*|sot vang)$';
  select n.* into section_dish from private.dish_menu_context_sections s join private.dish_names n on n.id=s.dish_id
   where s.section_key=section;
  extra_context:=section ~ '(^| )(goi them|an kem|side dish(es)?|extras?|add ons?|supplements?|toppings?)( |$)'
   or row_name ~ '^(goi them|an kem|extras?|add ons?|supplements?|toppings?)( |$)';
  d:=null;root:=null;decision:='review';reason:='unrecognized_or_ambiguous';variant_name:=null;
  -- Only names/sections are considered, never ingredients mentioned in descriptions.
  if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_excluded)='array' then p_excluded else '[]' end) x where x->>'sourceRow'=item.n::text)
   or row_name in ('tra da','nuoc ngot','nuoc suoi','dua xiem','iced tea','soft drinks','coffee','beer','wine') then
   decision:='excluded';reason:='beverage';
  elsif section ~ '^(do uong|drinks|beverages|boissons)( |$)' then
   if exists(select 1 from private.dish_names where key=row_name or row_name=any(aliases))
    or pho_variant or row_name ~ '\m(pizza|steak|cake|gateau|chicken|beef|salad|soup|sauce)\M' then
    decision:='review';reason:='food_beverage_context_conflict';
   else decision:='excluded';reason:='beverage';end if;
  elsif row_name in ('khan lanh','cold wet tissue','wet tissue','serviette') then
   decision:='excluded';reason:='non_food';
  elsif extra_context and (pho_variant or section_dish.id is not null) then
   reason:='side_dish_context';
  elsif section_dish.id is not null and exists (
   select 1 from private.dish_names other
   where other.id in (select dish_id from private.dish_menu_context_sections)
    and (row_name=other.key or row_name like other.key||' %')
    and (
     coalesce(other.parent_id,other.id)<>coalesce(section_dish.parent_id,section_dish.id)
     or (section_dish.parent_id is not null and other.parent_id=section_dish.parent_id and other.id<>section_dish.id)
    )
  ) then
   reason:='conflicting_dish_section';
  else
   select * into d from private.dish_names where key=row_name or row_name=any(aliases) order by key limit 1;
   if d.id is not null then reason:='exact_menu_name'; end if;
   if d.id is null and not extra_context and private.dish_phrase(section,'banh can')
    and row_name ~ '^(trung ga|trung cut|thap cam)( |$)' then
    select * into root from private.dish_names where key='banh can';
   elsif d.id is null and section_dish.key='pho' and row_name in ('bo','ga') then
    select * into d from private.dish_names where key='pho '||row_name;
    reason:='explicit_menu_context';
   end if;
   -- Preparation context wins over a topping that also names another dish.
   if section_dish.key='pizza' and d.id<>section_dish.id and d.parent_id is distinct from section_dish.id then
    d:=null;
   end if;
   variant_name:=root.name||' · '||display_name;
   if d.id is null and root.id is null and pho_variant then
    -- Only labels with an explicit beef token qualify for the beef subtree.
    pho_parent_key:=case when private.dish_phrase(row_name,'bo') then 'pho bo' else 'pho' end;
    select * into root from private.dish_names where key=pho_parent_key;
    variant_name:=display_name;
   end if;
   -- A precise dish section supplies the missing context for a short label.
   -- Category headings such as PASTA or CHICKEN SOUP are deliberately absent.
   if d.id is null and root.id is null and section_dish.id is not null
    and row_name ~ '[[:alpha:]]' and row_name<>section
    and row_name not in ('menu','thuc don','special','specialite','chef special','house special','signature','combo') then
    root:=section_dish;
    variant_name:=case when row_name like root.key||' %' then display_name else root.name||' · '||display_name end;
   end if;
   if root.id is not null and length(variant_name)<=100 then
    variant_key:=private.dish_key(variant_name);
    insert into private.dish_names(name,key,parent_id) values(variant_name,variant_key,root.id)
     on conflict(key) do nothing;
    select * into d from private.dish_names where key=variant_key and parent_id=root.id;
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
   values(p_scope,p_run,item.n,item.value,decision,reason,d.id,p_date)
   on conflict(scope,run_id,source_row) do update
   set decision=excluded.decision,reason=excluded.reason,dish_id=excluded.dish_id
   where dish_menu_evidence.original=excluded.original
    and dish_menu_evidence.decision='review' and excluded.decision in ('associated','excluded');
 end loop;
 select array_agg(distinct r.id) into candidates
  from private.restaurant_dishes a join private.dish_names n on n.id=a.dish_id
  left join private.dish_names parent on parent.id=n.parent_id
  join private.dish_names r on r.id=coalesce(parent.parent_id,n.parent_id,n.id)
  where a.scope=p_scope and a.enabled and exists(select 1 from private.dish_menu_evidence v where v.scope=p_scope and v.run_id=p_run and v.dish_id=a.dish_id and v.decision='associated')
   and private.dish_phrase(restaurant_name,r.key)
   and not (r.key='pho' and private.dish_phrase(restaurant_name,'pho mai'));
 if cardinality(candidates)=1 then chosen:=candidates[1]; end if;
 update private.restaurant_dish_profiles set source_run=p_run,revision=revision+1,updated_at=now(),
  specialty_id=case when specialty_origin='automatic' then chosen else specialty_id end,
  specialty_evidence=case when specialty_origin='automatic' then jsonb_build_object('restaurantName',p_name,'runId',p_run,'reason','concordant_name_and_menu') else specialty_evidence end
 where scope=p_scope;
end$$;

commit;
