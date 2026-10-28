begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.current_report_publications in share mode nowait;
lock table public.restaurant_recommendation_sheets in share row exclusive mode nowait;

-- Retain only Google identity, prices and observation date. In particular no
-- review, author, translation, response or arbitrary place blob survives here.
create function private.google_price_fields_v1(raw jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,case when key='priceRange' and jsonb_typeof(value)='object' then
  (select coalesce(jsonb_object_agg(x.key,x.value),'{}') from jsonb_each(value) x
   where x.key in('minimum','maximum') and jsonb_typeof(x.value)='number' or x.key='currency' and jsonb_typeof(x.value)='string')
  else value end),'{}')
 from jsonb_each(case when jsonb_typeof(raw)='object' then raw else '{}' end)
 where key in('placeId','cid','scrapedAt','price','priceLevel','priceRange')
  and (jsonb_typeof(value) in('string','number','null') or key='priceRange' and jsonb_typeof(value)='object')
$$;
create or replace function private.retention_sanitize_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.review_corpus_policy where enabled) then
  new.raw_place_payload=private.google_price_fields_v1(new.raw_place_payload);
 end if;
 return new;
end $$;

-- Future frozen publications keep the original field name as provenance too.
create or replace function private.recommendation_spend_context_v1(raw jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce((select jsonb_build_object('price_per_person',min(v),'price_per_person_source_key',min(k)) from (
  select key k,btrim(value#>>'{}') v from jsonb_each(case when jsonb_typeof(raw)='object' then raw else '{}' end)
  where private.recommendation_key_v1(key) in('price per person','prix par personne','gia moi nguoi')
   and jsonb_typeof(value)='string' and btrim(value#>>'{}')<>''
 ) q having count(distinct v)=1),'{}'::jsonb)
$$;

create function private.recommendation_google_budget_v1(est uuid,org uuid,bindings jsonb,frozen_at text) returns jsonb
language plpgsql stable set search_path='' as $$
declare e public.establishments;ob jsonb;ep jsonb;spend jsonb;contexts int;total int;conflicts int;
begin
 select * into e from public.establishments where id=est and organization_id=org;
 if e.id is null then raise exception 'RECOMMENDATION_TENANT_MISMATCH';end if;
 -- Prefer the last actual price observation; a later null does not invent a
 -- refresh of an older price. Each price retains its real observation date.
 with observations as (
  select private.google_price_fields_v1(p.raw_payload) raw,p.provider_last_seen_at seen,p.id::text id,'review_provider_payloads' tab
  from public.review_provider_payloads p join public.reviews r on r.id=p.review_id
  where r.establishment_id=est and r.organization_id=org and p.provider='apify'
  union all
  select private.google_price_fields_v1(s.raw_place_payload),s.captured_at,s.id::text,'establishment_snapshots'
  from public.establishment_snapshots s where s.establishment_id=est and s.organization_id=org and s.provider='apify'
 ), matched as (
  select * from observations where (raw->>'placeId'=e.place_id or raw->>'cid'=e.google_id)
   and (nullif(raw->>'placeId','') is null or e.place_id is null or raw->>'placeId'=e.place_id)
   and (nullif(raw->>'cid','') is null or e.google_id is null or raw->>'cid'=e.google_id)
 ), scored as (
  select *,exists(select 1 from (values(raw->'price'),(raw->'priceLevel'),(raw->'priceRange')) x(value)
   where x.value not in('null'::jsonb,'""'::jsonb,'{}'::jsonb,'[]'::jsonb)
    and (jsonb_typeof(x.value)<>'string' or btrim(x.value#>>'{}')<>'')) supplied from matched
 ) select jsonb_build_object('raw',raw,'observed_at',seen,'source_id',id,'source_table',tab,'supplied',supplied) into ob
 from scored order by supplied desc,seen desc,id desc limit 1;
 ep=jsonb_build_object('price',ob#>'{raw,price}','price_level',ob#>'{raw,priceLevel}','price_range',ob#>'{raw,priceRange}',
  'status',case when (ob->>'supplied')::boolean then 'provided' else 'not_provided' end,'source','google_maps_import',
  'observed_at',ob->'observed_at','provider_scraped_at',ob#>'{raw,scrapedAt}','source_table',ob->'source_table','source_id',ob->'source_id',
  'source_fields',coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(coalesce(ob->'raw','{}')) k where k in('price','priceLevel','priceRange')),'[]'),
  'missing_reason',case when ob is null then 'NO_IDENTITY_MATCHED_OBSERVATION' when (ob->>'supplied')::boolean then null
   when (ob->'raw')?'price' or (ob->'raw')?'priceLevel' or (ob->'raw')?'priceRange' then 'PROVIDER_PRICE_NULL_OR_EMPTY' else 'PRICE_FIELDS_ABSENT' end);
 if jsonb_typeof(bindings) is distinct from 'array' then bindings='[]';end if;
 total=jsonb_array_length(bindings);
 select count(*) filter(where x?'review_context') into contexts from jsonb_array_elements(bindings) x;
 with fields as (
  select b->>'id' id,b->>'published_at' published_at,k.key,
   btrim(k.value#>>'{}') value
  from jsonb_array_elements(bindings) b cross join lateral jsonb_each(case when jsonb_typeof(b->'review_context')='object' then b->'review_context' else '{}' end) k
  where private.recommendation_key_v1(k.key) in('price per person','prix par personne','gia moi nguoi') and jsonb_typeof(k.value)='string' and btrim(k.value#>>'{}')<>''
 ), per_review as (
  select id,min(value) value,min(published_at) published_at,jsonb_agg(distinct ('source_bindings[].review_context.'||key)) paths,count(distinct value) variants
  from fields where id is not null group by id
 ), grouped as (
  select value,count(*) n,min(published_at::timestamptz) first_at,max(published_at::timestamptz) last_at,
   (select jsonb_agg(distinct p) from per_review r2 cross join lateral jsonb_array_elements_text(r2.paths) p where r2.value=r.value and r2.variants=1) paths
  from per_review r where variants=1 group by value
 ) select coalesce(jsonb_agg(jsonb_build_object('value',value,'review_count',n,'source_fields',paths,'period_start',first_at,'period_end',last_at) order by n desc,value),'[]') into spend from grouped;
 -- Conflicting aliases/duplicate bindings never add a second client vote.
 with f as (
  select b->>'id' id,btrim(k.value#>>'{}') value from jsonb_array_elements(bindings) b
  cross join lateral jsonb_each(case when jsonb_typeof(b->'review_context')='object' then b->'review_context' else '{}' end) k
  where private.recommendation_key_v1(k.key) in('price per person','prix par personne','gia moi nguoi') and jsonb_typeof(k.value)='string' and btrim(k.value#>>'{}')<>''
 ) select count(*) into conflicts from (select id from f group by id having count(distinct value)>1) q;
 return jsonb_build_object('version','google-maps-prices-v1','establishment_price',ep,'customer_spend_per_person',jsonb_build_object(
  'ranges',spend,'context_reviews',contexts,'missing_context_reviews',total-contexts,'conflicting_reviews',conflicts,
  'status',case when conflicts>0 then 'conflicting_context' when contexts<total then 'frozen_context_incomplete' when spend='[]' then 'not_provided' else 'provided' end,
  'source','frozen_report_review_context','observed_at',frozen_at,'date_kind','report_snapshot_as_of','guaranteed_tariff',false));
end $$;

-- Only the active V2 writer's metadata plumbing changes. Scoring and report
-- document code are neither replaced nor invoked during this backfill.
do $$declare d text;a text;begin
 d=pg_get_functiondef('private.write_recommendation_sheet_v2(public.current_report_publications)'::regprocedure);
 a=$old$ meta=private.recommendation_metadata_v1(identity,observation,case when jsonb_typeof(pub.source_bindings)='array' then pub.source_bindings else '[]' end);$old$;
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'RECOMMENDATION_WRITER_CHANGED';end if;
 d=replace(d,a,a||$new$
 meta=jsonb_set(meta,'{budget}',private.recommendation_google_budget_v1(pub.establishment_id,pub.organization_id,pub.source_bindings,pub.scope->>'as_of'));
$new$);
 execute d;
end$$;

-- One refresh at the completed snapshot stage, not one trigger per review.
-- Spend data always comes from each sheet's own durable publication.
create function private.refresh_recommendation_google_prices() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.restaurant_recommendation_sheets s set metadata=jsonb_set(s.metadata,'{budget}',
  private.recommendation_google_budget_v1(s.establishment_id,s.organization_id,p.source_bindings,p.scope->>'as_of')),updated_at=clock_timestamp()
 from public.current_report_publications p
 where s.establishment_id=new.establishment_id and s.organization_id=new.organization_id
  and p.establishment_id=s.establishment_id and p.language=s.language and p.organization_id=s.organization_id
  and p.report_id=s.report_id and p.source_run_id=s.source_run_id;
 return new;
end$$;
create trigger recommendation_google_price_snapshot after insert or update of raw_place_payload on public.establishment_snapshots
for each row when(new.provider='apify' and new.raw_place_payload<>'{}'::jsonb) execute function private.refresh_recommendation_google_prices();

do $$begin
 if exists(select 1 from public.restaurant_recommendation_sheets s left join public.current_report_publications p using(establishment_id,language)
  where p.report_id is null or (s.report_id,s.source_run_id,s.organization_id,s.corpus->'fingerprint') is distinct from (p.report_id,p.source_run_id,p.organization_id,p.scope->'fingerprint'))
 then raise exception 'RECOMMENDATION_SHEET_FROZEN_REPORT_MISMATCH';end if;
end$$;
update public.restaurant_recommendation_sheets s set metadata=jsonb_set(s.metadata,'{budget}',
 private.recommendation_google_budget_v1(s.establishment_id,s.organization_id,p.source_bindings,p.scope->>'as_of')),updated_at=clock_timestamp()
from public.current_report_publications p where p.establishment_id=s.establishment_id and p.language=s.language;

revoke all on function private.recommendation_google_budget_v1(uuid,uuid,jsonb,text),private.recommendation_spend_context_v1(jsonb),private.retention_sanitize_snapshot(),private.refresh_recommendation_google_prices(),private.google_price_fields_v1(jsonb)
from public,anon,authenticated,service_role;
commit;
