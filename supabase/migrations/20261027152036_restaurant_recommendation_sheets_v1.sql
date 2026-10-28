-- Internal, organization-scoped projection of the LAST DURABLE publication.
-- No supplier call, request, worker dispatch or mutation of published reports.
begin;

create function private.recommendation_key_v1(s text) returns text
language sql immutable set search_path='' as $$
 select btrim(regexp_replace(regexp_replace(replace(lower(normalize(s,NFD)),'đ','d'),'[̀-ͯ]','','g'),'[_\s-]+',' ','g'))
$$;

-- Same accepted values/aliases as customer-ratings.ts; conflicting aliases
-- are unknown, never averaged, and the overall star rating is never used.
create function private.recommendation_rating_v1(raw jsonb,category text) returns numeric
language sql immutable set search_path='' as $$
 with entries as (
  select private.recommendation_key_v1(key) k,btrim(value #>> '{}') v,jsonb_typeof(value) typ
  from jsonb_each(case when jsonb_typeof(raw)='object' then raw else '{}' end)
 ), accepted as (
  select replace(btrim(split_part(v,'/',1)),',','.')::numeric n from entries
  where typ in('number','string') and v ~ '^[1-5]([.,][0-9]+)?(\s*/\s*5)?$'
  and case category
   when 'quality' then k in('food','cuisine','nourriture','qualite','qualite des plats','do an','thuc an','food rating')
   when 'service' then k in('service','dich vu','service rating')
   when 'ambiance' then k in('atmosphere','ambience','ambiance','khong gian','bau khong khi','atmosphere rating')
   else false end
 ) select case when count(distinct n)=1 then min(n) end from accepted where n between 1 and 5
$$;

create function private.recommendation_score_v1(b numeric,p integer,n integer,t integer) returns numeric
language sql immutable set search_path='' as $$
 select case when b is not null and t>0 and p>=0 and n>=0 and p+n<=t
 then greatest(0::numeric,least(6::numeric,b+(p-2::numeric*n)/t)) end
$$;

-- Pure calculation, also used by the offline audit. Inputs are a publication,
-- not live reviews or the 32 selected Sol associations. No text is needed.
create function private.recommendation_calculation_v1(pub jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
 doc jsonb=pub->'document';sc jsonb=pub->'scope';bindings jsonb=pub->'source_bindings';
 stats jsonb=pub#>'{document,statistics}';counts jsonb=pub#>'{document,statistics,counts}';
 cats jsonb='{}';issues jsonb='[]';all_ok boolean=true;class_ok boolean;rating_ok boolean;
 t integer;texts integer;ids text[];text_ids text[];category text;rating_name text;
 c jsonb;ex jsonb;native_value jsonb;b numeric;rs numeric;rc integer;p integer;n integer;score numeric;
 pos text[];neg text[];common integer;total integer;reported jsonb;source text;binding_ratings boolean;
 global_score numeric;num numeric;den numeric;global_num numeric;global_den numeric;
begin
 if jsonb_typeof(bindings) is distinct from 'array' or jsonb_typeof(sc->'review_ids') is distinct from 'array'
 or doc->>'id' is distinct from pub->>'report_id' or doc->>'current_source_run_id' is distinct from pub->>'source_run_id'
 or sc->>'source_run_id' is distinct from pub->>'source_run_id' or sc->>'organization_id' is distinct from pub->>'organization_id'
 or sc->>'establishment_id' is distinct from pub->>'establishment_id'
 or doc->>'state' is distinct from 'completed' or doc#>>'{controls,technical_checks_passed}' is distinct from 'true'
 then raise exception 'INCOMPATIBLE_PUBLICATION_BINDING' using errcode='22023';end if;
 t=(sc->>'review_count')::int;texts=(stats#>>'{scope,analysed_text_reviews}')::int;
 select array_agg(x->>'id' order by x->>'id'),array_agg(x->>'id' order by x->>'id') filter(where
  x->>'analysis_text_sha256' is not null and x->>'analysis_text_sha256'<>'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
 into ids,text_ids from jsonb_array_elements(bindings) x;
 ids=coalesce(ids,'{}');text_ids=coalesce(text_ids,'{}');
 if t is null or t<0 or t>150 or texts is null or texts<0 or texts>t
 or cardinality(ids)<>t or (select count(distinct x) from unnest(ids) x)<>t or array_position(ids,null) is not null
 or ids is distinct from (select coalesce(array_agg(x order by x),'{}') from jsonb_array_elements_text(sc->'review_ids') x)
 or (stats#>>'{scope,source_reviews}')::int is distinct from t
 or (stats#>>'{scope,textless_statistics_only}')::int is distinct from t-texts
 or (counts->>'total_reviews')::int is distinct from texts or cardinality(text_ids)<>texts
 or counts->>'aggregation' is distinct from 'one_review_once_per_category; mixed_in_both_polarities; total_is_unique_source_reviews_never_sum_of_categories'
 or counts->>'confidence_filter_applied' is distinct from 'false'
 or doc#>>'{derived_report,statistics_sha256}' is distinct from public.jls_restaurant_hash(stats)
 then raise exception 'INCOMPATIBLE_FROZEN_CORPUS' using errcode='22023';end if;
 if t=0 then issues=issues||'"EMPTY_CORPUS"'::jsonb;end if;
 binding_ratings=not exists(select 1 from jsonb_array_elements(bindings) x where not x?'review_detailed_rating');
 foreach category in array array['quality','service','ambiance'] loop
  rating_name=case category when 'quality' then 'food' when 'ambiance' then 'atmosphere' else category end;
  c=counts#>array['categories',category];ex=c->'exclusive';class_ok=true;rating_ok=true;rs=null;rc=0;b=null;score=null;num=null;den=null;
  if jsonb_typeof(ex) is distinct from 'object' or jsonb_typeof(c->'positive_review_ids') is distinct from 'array'
   or jsonb_typeof(c->'negative_review_ids') is distinct from 'array' then class_ok=false;
  else
   total=0;
   foreach source in array array['positive','negative','mixed','neutral','not_mentioned','uncertain','refused','unavailable'] loop
    native_value=ex->source;
    if jsonb_typeof(native_value) is distinct from 'number' or native_value::text !~ '^[0-9]+$' then class_ok=false;
    else total=total+(native_value::text)::int;end if;
   end loop;
   select coalesce(array_agg(x order by x),'{}') into pos from jsonb_array_elements_text(c->'positive_review_ids') x;
   select coalesce(array_agg(x order by x),'{}') into neg from jsonb_array_elements_text(c->'negative_review_ids') x;
   select count(*) into common from unnest(pos) x where x=any(neg);
   p=(ex->>'positive')::int;n=(ex->>'negative')::int;
   if total<>texts or (c->>'denominator_reviews')::int is distinct from texts
    or (select count(distinct x) from unnest(pos) x)<>cardinality(pos)
    or (select count(distinct x) from unnest(neg) x)<>cardinality(neg)
    or not pos<@text_ids or not neg<@text_ids or array_position(pos,null) is not null or array_position(neg,null) is not null
    or common is distinct from (ex->>'mixed')::int or cardinality(pos)-common is distinct from p
    or cardinality(neg)-common is distinct from n or (ex->>'unavailable')::int<>0
    or (counts->>'received_results')::int is distinct from texts then class_ok=false;end if;
  end if;
  reported=doc#>array['source_report','customer_rating_statistics','categories',rating_name];
  if binding_ratings then
   source='frozen_review_detailed_ratings';
   select sum(v),count(v) into rs,rc from (select private.recommendation_rating_v1(x->'review_detailed_rating',category) v from jsonb_array_elements(bindings) x) q;
   if rc>0 then b=rs/rc;end if;
   -- Floating-point historical averages are cross-checked, never used to
   -- replace recomputable sums. The tolerance is validation, not rounding.
   if reported is not null and reported<>'null'::jsonb and ((reported->>'count')::int is distinct from rc
    or (rc>0 and (jsonb_typeof(reported->'average') is distinct from 'number' or abs((reported->>'average')::numeric-b)>0.000000000001))
    or (rc=0 and reported->>'average' is not null)) then rating_ok=false;end if;
  else
   source='frozen_report_rating_aggregate';
   if (doc#>>'{source_report,customer_rating_statistics,total_reviews}')::int is distinct from t
    or jsonb_typeof(reported->'count') is distinct from 'number' then rating_ok=false;
   else
    rc=(reported->>'count')::int;b=(reported->>'average')::numeric;
    if rc<0 or rc>t or (rc=0 and b is not null) or (rc>0 and (b is null or b<1 or b>5)) then rating_ok=false;end if;
    rs=b*rc;
   end if;
  end if;
  if not class_ok then issues=issues||jsonb_build_array(category||':CLASSIFICATIONS_INCOMPLETE_OR_INCONSISTENT');end if;
  if not rating_ok then issues=issues||jsonb_build_array(category||':RATINGS_INCONSISTENT_OR_MISSING');end if;
  if rc=0 then issues=issues||jsonb_build_array(category||':NO_CATEGORY_RATINGS');end if;
  if class_ok and rating_ok then
   score=private.recommendation_score_v1(b,p,n,t);
   if score is not null then
    -- Exact rational retained in addition to unrounded numeric scores.
    num=greatest(0::numeric,least(6::numeric*rc*t,rs*t+(p-2::numeric*n)*rc));den=rc::numeric*t;score=num/den;
   end if;
  end if;
  if score is null then all_ok=false;end if;
  cats=cats||jsonb_build_object(category,jsonb_build_object('base_average',b,'rating_count',rc,'rating_sum',rs,'rating_source',source,
   'exclusive',ex,'positive',case when class_ok then p end,'negative',case when class_ok then n end,'denominator',t,
   'score',score,'score_numerator',num,'score_denominator',den,'classifications_coherent',class_ok,'ratings_coherent',rating_ok));
 end loop;
 if all_ok then
  global_den=3*(cats#>>'{quality,score_denominator}')::numeric*(cats#>>'{service,score_denominator}')::numeric*(cats#>>'{ambiance,score_denominator}')::numeric;
  global_num=(cats#>>'{quality,score_numerator}')::numeric*(cats#>>'{service,score_denominator}')::numeric*(cats#>>'{ambiance,score_denominator}')::numeric
   +(cats#>>'{service,score_numerator}')::numeric*(cats#>>'{quality,score_denominator}')::numeric*(cats#>>'{ambiance,score_denominator}')::numeric
   +(cats#>>'{ambiance,score_numerator}')::numeric*(cats#>>'{quality,score_denominator}')::numeric*(cats#>>'{service,score_denominator}')::numeric;
  global_score=global_num/global_den;
 end if;
 return jsonb_build_object('version','internal-recommendation-v1','scale',jsonb_build_array(0,6),'total_reviews',t,'analysed_text_reviews',texts,
  'categories',cats,'global_score',global_score,'global_score_numerator',global_num,'global_score_denominator',global_den,
  'comparable',all_ok,'status',case when all_ok then 'ready' else 'partial' end,'issues',issues);
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('version','internal-recommendation-v1','scale',jsonb_build_array(0,6),'categories','{}'::jsonb,
  'global_score',null,'comparable',false,'status','unavailable','issues',jsonb_build_array(sqlerrm));
end $$;

-- Retain only the explicit spending field, never unrelated context or prose.
create function private.recommendation_spend_context_v1(raw jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce((select jsonb_build_object('price_per_person',btrim(value #>> '{}'))
 from jsonb_each(case when jsonb_typeof(raw)='object' then raw else '{}' end)
 where private.recommendation_key_v1(key) in('price per person','prix par personne','gia moi nguoi')
 and jsonb_typeof(value)='string' and btrim(value #>> '{}')<>'' order by key limit 1),'{}'::jsonb)
$$;

-- Only explicit provider metadata. No sentiment or review prose is inspected.
create function private.recommendation_metadata_v1(identity jsonb,observation jsonb,bindings jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare raw jsonb=coalesce(observation->'raw','{}');categories jsonb;cuisines jsonb;spend jsonb;context_count int;lat numeric;lng numeric;
begin
 select coalesce(jsonb_agg(v order by v),'[]') into categories from (
  select distinct btrim(x #>> '{}') v from jsonb_array_elements(case when jsonb_typeof(raw->'categories')='array' then raw->'categories' else '[]' end) x
  where jsonb_typeof(x)='string' and btrim(x #>> '{}')<>''
  union select btrim(raw->>'categoryName') where nullif(btrim(raw->>'categoryName'),'') is not null) q;
 -- Explicit cuisine fields plus exact Google cuisine categories. Generic
 -- restaurant/bar/music categories remain available but imply no cuisine.
 select coalesce(jsonb_agg(v order by v),'[]') into cuisines from (
  select distinct case private.recommendation_key_v1(v)
   when 'nha hang y' then 'italian' when 'italian restaurant' then 'italian' when 'restaurant italien' then 'italian'
   when 'nha hang viet nam' then 'vietnamese' when 'vietnamese restaurant' then 'vietnamese' when 'restaurant vietnamien' then 'vietnamese'
   when 'nha hang hai san' then 'seafood' when 'seafood restaurant' then 'seafood' when 'restaurant de fruits de mer' then 'seafood'
   when 'nha hang pizza' then 'pizza' when 'pizza restaurant' then 'pizza' when 'pizzeria' then 'pizza'
   when 'nha hang chau au' then 'european' when 'european restaurant' then 'european' when 'restaurant europeen' then 'european'
  end v from jsonb_array_elements_text(categories) v
  union select btrim(x #>> '{}') from jsonb_array_elements(case when jsonb_typeof(raw->'cuisines')='array' then raw->'cuisines' else '[]' end) x where jsonb_typeof(x)='string' and btrim(x #>> '{}')<>''
  union select btrim(raw->>'cuisine') where jsonb_typeof(raw->'cuisine')='string' and btrim(raw->>'cuisine')<>'') q where v is not null;
 if jsonb_typeof(raw#>'{location,lat}')='number' and jsonb_typeof(raw#>'{location,lng}')='number' then
  lat=(raw#>>'{location,lat}')::numeric;lng=(raw#>>'{location,lng}')::numeric;
  if lat not between -90 and 90 or lng not between -180 and 180 then lat=null;lng=null;end if;
 end if;
 select count(*) into context_count from jsonb_array_elements(bindings) x where x?'review_context';
 with amounts as (
  select x->>'id' id,(select btrim(value #>> '{}') from jsonb_each(case when jsonb_typeof(x->'review_context')='object' then x->'review_context' else '{}' end)
   where private.recommendation_key_v1(key) in('price per person','prix par personne','gia moi nguoi') and jsonb_typeof(value)='string' and btrim(value #>> '{}')<>'' order by key limit 1) v
  from jsonb_array_elements(bindings) x
 ), ranges as (select v,count(distinct id) n from amounts where v is not null group by v)
 select coalesce(jsonb_agg(jsonb_build_object('value',v,'review_count',n) order by n desc,v),'[]') into spend from ranges;
 return jsonb_build_object('identity',identity,'google_metadata',jsonb_build_object('provider',observation->'provider','source','google_maps_import',
  'observed_at',observation->'observed_at','provider_scraped_at',raw->'scrapedAt','coordinates',case when lat is not null then jsonb_build_object('latitude',lat,'longitude',lng) end,
  'google_categories',categories,'cuisine_types',cuisines,'cuisine_mapping','explicit-google-categories-v1'),
  'budget',jsonb_build_object('establishment_price',jsonb_build_object('price',raw->'price','price_level',raw->'priceLevel','price_range',raw->'priceRange',
   'status',case when coalesce(nullif(raw->>'price',''),nullif(raw->>'priceLevel',''),nullif(raw->>'priceRange','')) is null then 'not_provided' else 'provided' end,
   'source','google_maps_import','observed_at',observation->'observed_at'),
   'customer_spend_per_person',jsonb_build_object('ranges',spend,'context_reviews',context_count,'missing_context_reviews',jsonb_array_length(bindings)-context_count,
    'status',case when context_count<jsonb_array_length(bindings) then 'frozen_context_incomplete' when spend='[]'::jsonb then 'not_provided' else 'provided' end,
    'source','frozen_report_review_context')));
end $$;

create table public.restaurant_recommendation_sheets(
 establishment_id uuid not null,language text not null,organization_id uuid not null references public.organizations(id),
 report_id uuid not null,source_run_id uuid not null,report_generated_at timestamptz not null,
 calculation_version text not null default 'internal-recommendation-v1' check(calculation_version='internal-recommendation-v1'),
 corpus jsonb not null,calculation jsonb not null,metadata jsonb not null,report_sections jsonb not null,
 stale boolean not null,stale_reason text,calculated_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 quality_score numeric generated always as ((calculation#>>'{categories,quality,score}')::numeric) stored,
 service_score numeric generated always as ((calculation#>>'{categories,service,score}')::numeric) stored,
 ambiance_score numeric generated always as ((calculation#>>'{categories,ambiance,score}')::numeric) stored,
 global_score numeric generated always as ((calculation->>'global_score')::numeric) stored,
 primary key(establishment_id,language),foreign key(establishment_id,language) references public.current_report_publications(establishment_id,language) on delete cascade
);
create index restaurant_recommendation_sheets_organization on public.restaurant_recommendation_sheets(organization_id);
alter table public.restaurant_recommendation_sheets enable row level security;
revoke all on public.restaurant_recommendation_sheets from public,anon,authenticated,service_role;
grant select on public.restaurant_recommendation_sheets to authenticated,service_role;
create policy recommendation_sheet_read on public.restaurant_recommendation_sheets for select to authenticated using(exists(
 select 1 from public.organization_members m where m.organization_id=restaurant_recommendation_sheets.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));

create function private.write_recommendation_sheet_v1(pub public.current_report_publications) returns void
language plpgsql set search_path='' as $$
declare e public.establishments;identity jsonb;observation jsonb;calc jsonb;meta jsonb;
begin
 select * into e from public.establishments where id=pub.establishment_id and organization_id=pub.organization_id;
 if e.id is null then raise exception 'RECOMMENDATION_TENANT_MISMATCH';end if;
 identity=jsonb_build_object('establishment_id',e.id,'organization_id',e.organization_id,'name',e.name,'google_id',e.google_id,'place_id',e.place_id,'address',e.address,'google_maps_url',e.google_maps_url,'recorded_at',now());
 select jsonb_build_object('provider',p.provider,'observed_at',p.provider_last_seen_at,'raw',jsonb_build_object('location',p.raw_payload->'location','categories',p.raw_payload->'categories',
  'categoryName',p.raw_payload->'categoryName','cuisine',p.raw_payload->'cuisine','cuisines',p.raw_payload->'cuisines','price',p.raw_payload->'price','priceLevel',p.raw_payload->'priceLevel','priceRange',p.raw_payload->'priceRange','scrapedAt',p.raw_payload->'scrapedAt')) into observation
 from public.review_provider_payloads p join public.reviews r on r.id=p.review_id
 where r.establishment_id=e.id and r.organization_id=e.organization_id and p.provider in('apify','outscraper')
  and (p.raw_payload->>'placeId'=e.place_id or p.raw_payload->>'cid'=e.google_id)
  and (nullif(p.raw_payload->>'placeId','') is null or e.place_id is null or p.raw_payload->>'placeId'=e.place_id)
  and (nullif(p.raw_payload->>'cid','') is null or e.google_id is null or p.raw_payload->>'cid'=e.google_id)
 order by p.provider_last_seen_at desc,p.id desc limit 1;
 calc=private.recommendation_calculation_v1(to_jsonb(pub));
 meta=private.recommendation_metadata_v1(identity,observation,case when jsonb_typeof(pub.source_bindings)='array' then pub.source_bindings else '[]' end);
 insert into public.restaurant_recommendation_sheets(establishment_id,language,organization_id,report_id,source_run_id,report_generated_at,corpus,calculation,metadata,report_sections,stale,stale_reason)
 values(pub.establishment_id,pub.language,pub.organization_id,pub.report_id,pub.source_run_id,pub.generated_at,
  jsonb_build_object('fingerprint',pub.scope->'fingerprint','total_reviews',pub.scope->'review_count','period_start',pub.scope->'period_start','period_end',pub.scope->'period_end','as_of',pub.scope->'as_of'),calc,meta,
  jsonb_build_object('report_id',pub.report_id,'positive_aspects',pub.document#>'{derived_report,report,positive_aspects}','reservations',pub.document#>'{derived_report,report,negative_aspects}'),pub.stale,pub.stale_reason)
 on conflict(establishment_id,language) do update set organization_id=excluded.organization_id,report_id=excluded.report_id,source_run_id=excluded.source_run_id,
  report_generated_at=excluded.report_generated_at,corpus=excluded.corpus,calculation=excluded.calculation,metadata=excluded.metadata,report_sections=excluded.report_sections,
  stale=excluded.stale,stale_reason=excluded.stale_reason,calculated_at=now(),updated_at=now();
end $$;

create function private.capture_recommendation_sheet_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (new.report_id,new.document,new.scope,new.source_bindings) is not distinct from (old.report_id,old.document,old.scope,old.source_bindings) then
   update public.restaurant_recommendation_sheets set stale=new.stale,stale_reason=new.stale_reason,updated_at=now()
    where establishment_id=new.establishment_id and language=new.language and (stale,stale_reason) is distinct from (new.stale,new.stale_reason);
   return new;
  end if;
 end if;
 perform private.write_recommendation_sheet_v1(new);return new;
end $$;
create trigger internal_recommendation_sheet after insert or update on public.current_report_publications
for each row execute function private.capture_recommendation_sheet_v1();

-- Keep only descriptive price context in FUTURE frozen bindings. Never read
-- current contexts to fill an old report; never change an existing document.
do $$declare d text;a text;begin
 d=pg_get_functiondef('private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean)'::regprocedure);
 a='''review_detailed_rating'',r->''review_detailed_rating'',';
 if position(a in d)=0 then raise exception 'RECOMMENDATION_CONTEXT_BINDING_ANCHOR_CHANGED';end if;
 execute replace(d,a,a||'''review_context'',private.recommendation_spend_context_v1(r->''review_context''),');
end $$;

-- Idempotent initial projection from durable publications, including dated
-- stale reports. Missing/incompatible inputs produce explicit unknown scores.
do $$declare p public.current_report_publications;begin
 for p in select * from public.current_report_publications order by establishment_id,language loop
  perform private.write_recommendation_sheet_v1(p);
 end loop;
end $$;

revoke all on function private.recommendation_key_v1(text),private.recommendation_rating_v1(jsonb,text),private.recommendation_score_v1(numeric,integer,integer,integer),
 private.recommendation_calculation_v1(jsonb),private.recommendation_spend_context_v1(jsonb),private.recommendation_metadata_v1(jsonb,jsonb,jsonb),private.write_recommendation_sheet_v1(public.current_report_publications),private.capture_recommendation_sheet_v1()
 from public,anon,authenticated,service_role;
comment on table public.restaurant_recommendation_sheets is 'Private last-report projection, not Google stars. Score=clamp(B+(exclusive_positive-2*exclusive_negative)/all_corpus_reviews,0,6). No live-review score inputs; no provider calls.';
commit;
