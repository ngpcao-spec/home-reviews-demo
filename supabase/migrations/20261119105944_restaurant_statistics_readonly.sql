-- Read-only statistics. No retention, provider, generation or subscription changes.
begin;
-- Supports the shared OR local analysis lookup without scanning every organization's analyses.
create index statistics_ready_jev_source on private.shared_jev_analyses(google_review_id,updated_at desc) where state='ready';
create function private.statistics_context(p_establishment uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.establishments; l text; tz text; shared uuid;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into e from public.establishments where id=p_establishment and active
  and exists(select 1 from public.organization_members m where m.organization_id=establishments.organization_id and m.user_id=auth.uid());
 if e.id is null then raise exception 'FORBIDDEN'; end if;
 select preferred_language into l from public.profiles where user_id=auth.uid();
 if l is null or l not in('fr','vi') then raise exception 'PREFERRED_LANGUAGE_REQUIRED'; end if;
 -- The application currently has a single restaurant timezone policy, not a per-place column.
 select timezone into tz from public.review_corpus_policy where id;
 if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'TIMEZONE_UNAVAILABLE';end if;
 shared:=public.shared_restaurant_for_establishment(e.id);
 return jsonb_build_object('organization',e.organization_id,'restaurant',shared,'language',l,'timezone',tz,
  'name',e.name,'google_total',e.total_reviews,'checked_at',e.review_collection_checked_at,
  'complete_candidate',coalesce(e.review_collection_status='complete'
    and e.review_collection_expected=e.total_reviews and e.review_collection_unique=e.total_reviews
    and (e.review_collection_checked_at at time zone tz)::date=(now() at time zone tz)::date
    and not exists(select 1 from public.review_retention_events where establishment_id=e.id and purged_count>0),false));
end $$;

create function private.statistics_bounds(p_period text,p_timezone text,p_now timestamptz default now())
returns table(start_at timestamptz,end_at timestamptz,previous_start timestamptz,start_date date,end_date date,bucket text)
language plpgsql stable set search_path='' as $$
declare today date:=(p_now at time zone p_timezone)::date; first_day date;
begin
 if p_period is null or p_period not in('30d','3m','6m','1y','all') then raise exception 'INVALID_PERIOD';end if;
 first_day:=case p_period when '30d' then today-29 when '3m' then (today-interval '3 months')::date
  when '6m' then (today-interval '6 months')::date when '1y' then (today-interval '1 year')::date else null end;
 return query select first_day::timestamp at time zone p_timezone,(today+1)::timestamp at time zone p_timezone,
  (first_day-(today+1-first_day))::timestamp at time zone p_timezone,first_day,today,
  case when p_period in('30d','3m') then 'week' else 'month' end;
end $$;

-- One row per source review. Shared canonical rows win over local projections.
-- No LIMIT 150, retained_review_ids(), import-date filter or cross-organization scan.
create function private.statistics_rows(p_establishment uuid)
returns table(source_id text,review_id uuid,published_at timestamptz,rating integer,original_text text,
 display_text text,translated boolean,author_name text,review_url text,categories jsonb)
language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=private.statistics_context(p_establishment); shared uuid:=(c->>'restaurant')::uuid;
begin
 return query
 with candidates as (
  select r.external_review_id sid,r.id rid,r.published_at pub,r.rating::integer stars,
   coalesce(nullif(r.original_text,''),r.text,'') original,r.original_language lang,r.author_name author,r.review_url url,1 priority,r.updated_at modified
   from public.reviews r where r.establishment_id=p_establishment and r.organization_id=(c->>'organization')::uuid
  union all
  select r.external_id,null::uuid,r.published_at,r.rating,r.original_text,r.public_payload->>'original_language',
   r.public_payload->>'author_name',r.public_payload->>'review_url',0,null::timestamptz
   from private.shared_restaurant_reviews r where r.restaurant_id=shared
 ), dedup as (
  select distinct on(coalesce(nullif(sid,''),rid::text)) * from candidates
   order by coalesce(nullif(sid,''),rid::text),priority,modified desc nulls last,rid
 ), localized as (
  select coalesce(nullif(d.sid,''),d.rid::text) sid,coalesce(d.rid,local.id) rid,d.pub,d.stars,d.original,
   coalesce(d.lang,local.original_language,'und') lang,coalesce(d.author,local.author_name) author,coalesce(d.url,local.review_url) url,
   case when lower(split_part(replace(coalesce(d.lang,local.original_language,''),'_','-'),'-',1))=c->>'language'
     or nullif(btrim(d.original),'') is null then null else tr.translated_text end translation
  from dedup d left join lateral (
   select r.id,r.original_language,r.author_name,r.review_url from public.reviews r
    where r.establishment_id=p_establishment and r.organization_id=(c->>'organization')::uuid and r.external_review_id=d.sid
    order by r.updated_at desc,r.id limit 1
  ) local on true
  left join lateral (
   select t.translated_text from (
    select t.translated_text,0 priority from public.review_translations t
      where t.review_id=coalesce(d.rid,local.id) and t.language=c->>'language'
       and t.source_text_sha256=encode(extensions.digest(d.original,'sha256'),'hex')
    union all
    select t.translated_text,1 from private.shared_restaurant_review_translations t
      where t.restaurant_id=shared and t.external_id=d.sid and t.language=c->>'language'
       and t.original_text_sha256=encode(extensions.digest(d.original,'sha256'),'hex')
   ) t where nullif(btrim(t.translated_text),'') is not null and t.translated_text<>d.original order by priority limit 1
  ) tr on true
 )
 select d.sid,d.rid,d.pub,d.stars,d.original,coalesce(d.translation,d.original),d.translation is not null,
  coalesce(d.author,''),d.url,a.result->'categories'
 from localized d left join lateral (
  select a.result from private.shared_jev_analyses a
   where a.google_review_id=d.sid and a.state='ready'
    and (a.establishment_id=p_establishment or exists(select 1 from private.shared_restaurant_jev_keys k
      where k.restaurant_id=shared and k.identity_sha256=a.identity_sha256))
    and a.identity->>'analysis_text_sha256'=encode(extensions.digest(coalesce(d.translation,d.original),'sha256'),'hex')
    and a.identity->>'analysis_language'=case when d.translation is not null then c->>'language' else d.lang end
    and jsonb_typeof(a.result->'categories')='object' and nullif(btrim(d.original),'') is not null
   order by a.updated_at desc,a.identity_sha256 limit 1
 ) a on true;
end $$;

create function private.restaurant_statistics(p_establishment uuid,p_period text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=private.statistics_context(p_establishment); b record; result jsonb;
begin
 select * into b from private.statistics_bounds(p_period,c->>'timezone');
 with corpus as materialized(select * from private.statistics_rows(p_establishment)),
 usable as materialized(select * from corpus where published_at is not null and published_at<=now() and rating between 1 and 5),
 current_rows as materialized(select * from usable where (b.start_at is null or published_at>=b.start_at) and published_at<b.end_at),
 previous_rows as (select * from usable where published_at>=b.previous_start and published_at<b.start_at),
 current_metrics as (select count(*) n,avg(rating) average,count(*) filter(where rating<=3) low,
  count(*) filter(where nullif(btrim(original_text),'') is not null) text_count,
  count(*) filter(where categories is not null) analyzed from current_rows),
 previous_metrics as (select count(*) n,avg(rating) average,count(*) filter(where rating<=3) low from previous_rows),
 buckets as (select date_trunc(b.bucket,published_at at time zone (c->>'timezone'))::date bucket_date,avg(rating) average,count(*) n
  from current_rows group by 1),
 topics as (select k.key,
  count(*) filter(where r.categories->k.key->>'classification' in('positive','mixed') and r.categories->k.key->>'status'='classified') positive,
  count(*) filter(where r.categories->k.key->>'classification' in('negative','mixed') and r.categories->k.key->>'status'='classified') negative
  from (values('service'),('quality'),('price'),('ambiance')) k(key) left join current_rows r on true group by k.key)
 select jsonb_build_object('version','restaurant-statistics-v1','establishment_id',p_establishment,'language',c->>'language',
  'timezone',c->>'timezone','as_of',now(),'period',p_period,
  'start_date',coalesce(b.start_date,(select min(published_at at time zone (c->>'timezone'))::date from usable)),
  'end_date',b.end_date,'bucket',b.bucket,
  'metrics',jsonb_build_object('count',m.n,'average',m.average,'low_count',m.low,
    'low_percent',100.0*m.low/nullif(m.n,0)),
  'comparison',case when p_period='all' then null else jsonb_build_object(
    'reliable',(c->>'complete_candidate')::boolean and (select count(*) from usable)=(c->>'google_total')::integer
      and (select count(*) from corpus)=(select count(*) from usable),
    'previous_start',(b.previous_start at time zone (c->>'timezone'))::date,'previous_end',b.start_date-1,
    'count_change',100.0*(m.n-p.n)/nullif(p.n,0),'average_change',m.average-p.average,
    'low_percent_change',100.0*m.low/nullif(m.n,0)-100.0*p.low/nullif(p.n,0)) end,
  'coverage',jsonb_build_object('stored', (select count(*) from corpus),'dated',(select count(*) from usable),
    'excluded',(select count(*) from corpus)-(select count(*) from usable),'google_total',c->'google_total',
    'complete',(c->>'complete_candidate')::boolean and (select count(*) from usable)=(c->>'google_total')::integer
      and (select count(*) from corpus)=(select count(*) from usable),
    'first_date',(select min(published_at) from usable),'last_date',(select max(published_at) from usable),'checked_at',c->'checked_at'),
  'series',coalesce((select jsonb_agg(jsonb_build_object('date',bucket_date,'average',average,'count',n) order by bucket_date) from buckets),'[]'),
  'distribution',(select jsonb_agg(jsonb_build_object('rating',s,'count',(select count(*) from current_rows where rating=s)) order by s desc) from generate_series(1,5) s),
  'topics',jsonb_build_object('text_count',m.text_count,'analyzed',m.analyzed,'items',(select jsonb_agg(to_jsonb(t) order by key) from topics t))
 ) into result from current_metrics m cross join previous_metrics p;
 return result;
end $$;

-- Keyset pagination on the same deduplicated corpus. No dependence on the application's 150-row list.
create function private.restaurant_statistic_reviews(p_establishment uuid,p_period text,p_ratings integer[],
 p_topic text,p_polarity text,p_before timestamptz,p_before_id text,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=private.statistics_context(p_establishment); b record; result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>50 or (p_before is null)<>(p_before_id is null)
  or (p_ratings is not null and (cardinality(p_ratings)<1 or array_position(p_ratings,null) is not null or not p_ratings<@array[1,2,3,4,5]))
  or (p_topic is not null and p_topic not in('service','quality','price','ambiance'))
  or ((p_topic is null)<>(p_polarity is null)) or (p_polarity is not null and p_polarity not in('positive','negative'))
 then raise exception 'INVALID_FILTER';end if;
 select * into b from private.statistics_bounds(p_period,c->>'timezone');
 with filtered as materialized(
  select * from private.statistics_rows(p_establishment) r
  where r.published_at is not null and r.published_at<=now() and r.published_at<b.end_at and r.rating between 1 and 5
   and (b.start_at is null or r.published_at>=b.start_at) and (p_ratings is null or r.rating=any(p_ratings))
   and (p_topic is null or (r.categories->p_topic->>'status'='classified'
     and r.categories->p_topic->>'classification' in(p_polarity,'mixed')))
 ), page as materialized(
  select * from filtered where p_before is null or (published_at,source_id)<(p_before,p_before_id)
  order by published_at desc,source_id desc limit p_limit+1
 ), shown as (select * from page order by published_at desc,source_id desc limit p_limit)
 select jsonb_build_object('language',c->>'language','total',(select count(*) from filtered),
  'items',coalesce((select jsonb_agg(to_jsonb(s)-'categories' order by published_at desc,source_id desc) from shown s),'[]'),
  'next',case when (select count(*) from page)>p_limit then (select jsonb_build_object('before',published_at,'id',source_id)
     from shown order by published_at,source_id limit 1) else null end) into result;
 return result;
end $$;

create function public.read_restaurant_statistics(p_establishment uuid,p_period text default '3m') returns jsonb
 language sql stable security invoker set search_path='' as $$ select private.restaurant_statistics(p_establishment,p_period) $$;
create function public.read_restaurant_statistic_reviews(p_establishment uuid,p_period text default '3m',
 p_ratings integer[] default null,p_topic text default null,p_polarity text default null,
 p_before timestamptz default null,p_before_id text default null,p_limit integer default 30) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select private.restaurant_statistic_reviews(p_establishment,p_period,p_ratings,p_topic,p_polarity,p_before,p_before_id,p_limit) $$;

revoke all on function private.statistics_context(uuid),private.statistics_bounds(text,text,timestamptz),private.statistics_rows(uuid),
 private.restaurant_statistics(uuid,text),private.restaurant_statistic_reviews(uuid,text,integer[],text,text,timestamptz,text,integer),
 public.read_restaurant_statistics(uuid,text),public.read_restaurant_statistic_reviews(uuid,text,integer[],text,text,timestamptz,text,integer)
 from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.restaurant_statistics(uuid,text),private.restaurant_statistic_reviews(uuid,text,integer[],text,text,timestamptz,text,integer),
 public.read_restaurant_statistics(uuid,text),public.read_restaurant_statistic_reviews(uuid,text,integer[],text,text,timestamptz,text,integer) to authenticated;
commit;
