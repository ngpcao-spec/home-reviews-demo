-- Preserve native receipts and existing consumer identities. Only route
-- compatible consumers to one native analysis; never fabricate a receipt.
create table private.shared_restaurant_jev_keys(
 restaurant_id uuid not null references private.shared_restaurants,
 compatibility_sha256 text not null,
 identity_sha256 text not null references private.shared_jev_analyses,
 primary key(restaurant_id,compatibility_sha256)
);
create table private.shared_restaurant_jev_aliases(
 consumer_id uuid not null,review_id uuid not null,local_identity jsonb not null,
 primary key(consumer_id,review_id),
 foreign key(consumer_id,review_id) references private.shared_jev_consumers(consumer_id,review_id) on delete cascade
);
alter table private.shared_restaurant_jev_keys enable row level security;
alter table private.shared_restaurant_jev_aliases enable row level security;
grant all on private.shared_restaurant_jev_keys,private.shared_restaurant_jev_aliases to service_role;

alter function public.jev_shared_read(uuid) rename to jev_shared_read_before_restaurants;
create function public.jev_shared_read(p_consumer uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare rows jsonb;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN'; end if;
 rows:=public.jev_shared_read_before_restaurants(p_consumer);
 return (select coalesce(jsonb_agg(case when a.local_identity is not null then x.value||jsonb_build_object('identity',a.local_identity) else x.value end order by x.ordinality),'[]')
  from jsonb_array_elements(rows) with ordinality x(value,ordinality)
  left join private.shared_restaurant_jev_aliases a on a.consumer_id=p_consumer and a.review_id=(x.value->>'review_id')::uuid);
end $$;

alter function public.jev_shared_allocate(uuid,jsonb) rename to jev_shared_allocate_before_restaurants;
create function public.jev_shared_allocate(p_consumer uuid,p_refs jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb; restaurant uuid; x jsonb; compatibility text; target text; previous integer;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN'; end if;
 src:=private.shared_jev_source(p_consumer);
 restaurant:=public.shared_restaurant_for_establishment((src->>'establishment_id')::uuid);
 if restaurant is null then return public.jev_shared_allocate_before_restaurants(p_consumer,p_refs); end if;
 perform 1 from private.shared_restaurants where id=restaurant for update;
 select count(*) into previous from private.shared_restaurant_jev_aliases where consumer_id=p_consumer;
 if previous>0 then
  if previous<>jsonb_array_length(p_refs) or exists(select 1 from jsonb_array_elements(p_refs) r
    where not exists(select 1 from private.shared_restaurant_jev_aliases a where a.consumer_id=p_consumer
      and a.review_id=(r->>'review_id')::uuid and a.local_identity=r)) then raise exception 'SHARED_JEV_FROZEN_REFERENCE_CHANGED'; end if;
  return public.jev_shared_read(p_consumer);
 end if;
 -- Retain the production verification of frozen text, Google ID, model,
 -- instructions, parser, configuration, language and the full reference set.
 perform public.jev_shared_allocate_before_restaurants(p_consumer,p_refs);
 for x in select value from jsonb_array_elements(p_refs) loop
  compatibility:=public.jls_restaurant_hash((x->'body')-'organization_id'-'establishment_id');
  -- Discover compatible native results that predate the shared catalog, too.
  -- Prefer a successful receipt; otherwise preserve an existing reservation or
  -- unresolved/failed attempt rather than silently starting it again.
  select a.identity_sha256 into target from private.shared_jev_analyses a
   join private.shared_restaurant_establishments l on l.establishment_id=a.establishment_id
   where l.restaurant_id=restaurant and a.google_review_id=x#>>'{body,google_review_id}'
    and public.jls_restaurant_hash(a.identity-'organization_id'-'establishment_id')=compatibility
   order by case a.state when 'ready' then 0 when 'pending' then 1 else 2 end,a.created_at,a.identity_sha256 limit 1;
  insert into private.shared_restaurant_jev_keys values(restaurant,compatibility,coalesce(target,x->>'sha256')) on conflict do nothing;
  select identity_sha256 into strict target from private.shared_restaurant_jev_keys
    where restaurant_id=restaurant and compatibility_sha256=compatibility;
  update private.shared_jev_consumers set identity_sha256=target where consumer_id=p_consumer and review_id=(x->>'review_id')::uuid;
  insert into private.shared_restaurant_jev_aliases values(p_consumer,(x->>'review_id')::uuid,x);
 end loop;
 return public.jev_shared_read(p_consumer);
end $$;

-- Shared successful results outlive the first organization's rolling corpus.
-- Failed/unknown attempts and the rules for new manual report attempts retain
-- their existing behavior. No pin/retry/publication rule is replaced here.
do $$declare d text;anchor text:='delete from private.shared_jev_analyses a where state=''ready''';begin
 d:=pg_get_functiondef('private.cleanup_shared_jev()'::regprocedure);
 if strpos(d,anchor)=0 then raise exception 'SHARED_JEV_CLEANUP_DEFINITION_CHANGED'; end if;
 execute replace(d,anchor,anchor||' and not exists(select 1 from private.shared_restaurant_jev_keys k where k.identity_sha256=a.identity_sha256)');
end $$;
revoke all on function public.jev_shared_read(uuid),public.jev_shared_allocate(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.jev_shared_read(uuid),public.jev_shared_allocate(uuid,jsonb) to service_role;
