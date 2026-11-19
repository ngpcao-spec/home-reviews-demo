-- Both aggregate and keyset detail use the same authorized durable corpus.
begin;
create or replace function private.statistics_context(p_establishment uuid) returns jsonb
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
  -- Seed dates and provider totals do not certify either comparison period.
  'complete_candidate',false,
  'history_started_at',(select min(h.started_at) from private.review_history_scopes h
    where (h.scope_kind='local' and h.scope_id=e.id) or (h.scope_kind='shared' and h.scope_id=shared)));
end $$;

create or replace function private.statistics_rows(p_establishment uuid)
returns table(source_id text,review_id uuid,published_at timestamptz,rating integer,original_text text,
 display_text text,translated boolean,author_name text,review_url text,categories jsonb)
language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=private.statistics_context(p_establishment); shared uuid:=(c->>'restaurant')::uuid;
begin
 return query
 with candidates as (
  select h.external_id sid,h.source_review_id rid,h.published_at pub,h.rating stars,h.original_text original,
   h.public_payload->>'original_language' lang,h.public_payload->>'author_name' author,h.public_payload->>'review_url' url,
   case h.scope_kind when 'shared' then 0 else 1 end priority,h.observed_at modified
  from private.review_history h where (h.scope_kind='local' and h.scope_id=p_establishment)
    or (h.scope_kind='shared' and h.scope_id=shared)
 ), dedup as (
  select distinct on(coalesce(nullif(sid,''),rid::text)) * from candidates
   order by coalesce(nullif(sid,''),rid::text),priority,modified desc nulls last,rid
 ), localized as (
  select coalesce(nullif(d.sid,''),d.rid::text) sid,coalesce(d.rid,local.id) rid,d.pub,d.stars,d.original,
   coalesce(d.lang,local.original_language,'und') lang,coalesce(d.author,local.author_name) author,coalesce(d.url,local.review_url) url,
   case when lower(split_part(replace(coalesce(d.lang,local.original_language,''),'_','-'),'-',1))=c->>'language'
     or nullif(btrim(d.original),'') is null then null else tr.translated_text end translation
  from dedup d left join lateral (
   select h.source_review_id id,h.public_payload->>'original_language' original_language,
     h.public_payload->>'author_name' author_name,h.public_payload->>'review_url' review_url
   from private.review_history h where h.scope_kind='local' and h.scope_id=p_establishment and h.external_id=d.sid
  ) local on true
  left join lateral (
   select t.translated_text from private.review_history_translations t
    where t.external_id=d.sid and t.language=c->>'language'
     and ((t.scope_kind='local' and t.scope_id=p_establishment) or (t.scope_kind='shared' and t.scope_id=shared))
     and t.source_text_sha256=encode(extensions.digest(d.original,'sha256'),'hex')
     and nullif(btrim(t.translated_text),'') is not null and t.translated_text<>d.original
    order by case t.scope_kind when 'shared' then 0 else 1 end,t.observed_at desc limit 1
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

create or replace function private.restaurant_statistics(p_establishment uuid,p_period text) returns jsonb
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
    'count_change',null,'average_change',null,
    'low_percent_change',null) end,
  'coverage',jsonb_build_object('stored', (select count(*) from corpus),'dated',(select count(*) from usable),
    'excluded',(select count(*) from corpus)-(select count(*) from usable),'google_total',c->'google_total',
    'complete',(c->>'complete_candidate')::boolean and (select count(*) from usable)=(c->>'google_total')::integer
      and (select count(*) from corpus)=(select count(*) from usable),
    'first_date',(select min(published_at) from usable),'last_date',(select max(published_at) from usable),'checked_at',c->'checked_at','history_started_at',c->'history_started_at','history_version','retained-review-history-v1'),
  'series',coalesce((select jsonb_agg(jsonb_build_object('date',bucket_date,'average',average,'count',n) order by bucket_date) from buckets),'[]'),
  'distribution',(select jsonb_agg(jsonb_build_object('rating',s,'count',(select count(*) from current_rows where rating=s)) order by s desc) from generate_series(1,5) s),
  'topics',jsonb_build_object('text_count',m.text_count,'analyzed',m.analyzed,'items',(select jsonb_agg(to_jsonb(t) order by key) from topics t))
 ) into result from current_metrics m cross join previous_metrics p;
 return result;
end $$;
commit;
