set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if not exists(select 1 from public.review_corpus_policy where enabled and version='latest_reviews_150_v1' and max_text_reviews=150 and months is null) then raise exception 'LATEST_150_POLICY_REQUIRED';end if;
end$$;
alter table public.establishments add column collection_language text not null default 'fr' check(collection_language in('fr','vi'));
alter table public.review_sync_jobs add column collection_language text not null default 'fr' check(collection_language in('fr','vi')),
 add column provider_start_attempted_at timestamptz,add column apify_run_id text,add column apify_dataset_id text;
alter table public.review_translations add column source_text_sha256 text check(source_text_sha256 ~ '^[0-9a-f]{64}$');

create function private.freeze_collection_language() returns trigger language plpgsql security definer set search_path='' as $$
declare l text;j jsonb;begin
 if tg_table_name='initial_import_jobs' then
  if tg_op='INSERT' and exists(select 1 from public.initial_import_jobs q where q.organization_id=new.organization_id and q.expected_google_id=new.expected_google_id and q.provider_start_attempted_at is not null and q.provider_run_id is null) then raise exception 'APIFY_START_OUTCOME_UNKNOWN';end if;
  if tg_op='UPDATE' and old.preferred_language is distinct from new.preferred_language then raise exception 'FROZEN_COLLECTION_LANGUAGE';end if;
  return new;
 elsif tg_table_name='establishments' then
  if tg_op='INSERT' then
   select preferred_language into l from public.initial_import_jobs where id=new.initial_import_job_id;
   if l is not null then new.collection_language=l;end if;
  elsif old.collection_language is distinct from new.collection_language then raise exception 'FROZEN_COLLECTION_LANGUAGE';end if;
 elsif tg_table_name='review_sync_jobs' then
  if tg_op='INSERT' then
   if exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) then raise exception 'RETENTION_INGESTION_PAUSED';end if;
   if exists(select 1 from public.review_sync_jobs q where q.establishment_id=new.establishment_id and q.provider_start_attempted_at is not null and q.apify_run_id is null) then return null;end if;
   select collection_language into new.collection_language from public.establishments where id=new.establishment_id;
  elsif old.collection_language is distinct from new.collection_language then raise exception 'FROZEN_COLLECTION_LANGUAGE';end if;
  if new.pagination_cursor like '{%' then
   j=new.pagination_cursor::jsonb;
   if j->>'provider'='apify' then
    if j->>'language' is distinct from new.collection_language or nullif(j->>'runId','') is null or nullif(j->>'datasetId','') is null then raise exception 'SYNC_PROVIDER_IDENTITY_INVALID';end if;
    if new.apify_run_id is not null and new.apify_run_id<>j->>'runId' or new.apify_dataset_id is not null and new.apify_dataset_id<>j->>'datasetId' then raise exception 'SYNC_PROVIDER_IDENTITY_CHANGED';end if;
    new.apify_run_id=j->>'runId';new.apify_dataset_id=j->>'datasetId';
   end if;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.freeze_collection_language() from public,anon,authenticated,service_role;
create trigger initial_import_language_frozen before insert or update of preferred_language on public.initial_import_jobs for each row execute function private.freeze_collection_language();
create trigger establishment_collection_language before insert or update of collection_language on public.establishments for each row execute function private.freeze_collection_language();
create trigger sync_collection_language before insert or update of collection_language,pagination_cursor on public.review_sync_jobs for each row execute function private.freeze_collection_language();

create function public.reserve_review_sync_start(p_job uuid,p_worker text) returns boolean language sql security definer set search_path='' as $$
 with saved as(update public.review_sync_jobs set provider_start_attempted_at=clock_timestamp(),provider_requests=provider_requests+1 where id=p_job and status='running' and locked_by=left(p_worker,120) and lease_until>clock_timestamp() and provider_start_attempted_at is null and apify_run_id is null and not exists(select 1 from public.review_corpus_policy where paused or ingestions_paused) returning 1) select exists(select 1 from saved)
$$;
revoke all on function public.reserve_review_sync_start(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_review_sync_start(uuid,text) to service_role;

create or replace function public.claim_review_sync_jobs(p_worker_id text,p_limit integer default 25,p_lease_seconds integer default 240)
returns table(id uuid,establishment_id uuid,organization_id uuid,status text,attempts integer,pagination_cursor text,checkpoint_review_id text,checkpoint_review_at timestamptz,head_review_id text,head_review_at timestamptz,provider_requests integer,reviews_fetched integer,reviews_inserted integer,google_id text,google_maps_url text)
language sql security definer set search_path='' as $$
 with unknown_attempts as(update public.review_sync_jobs set status='dead',error_code='APIFY_START_OUTCOME_UNKNOWN',locked_by=null,lease_until=null,finished_at=clock_timestamp()
  where provider_start_attempted_at is not null and apify_run_id is null and (status in('queued','retry') or status='running' and lease_until<clock_timestamp()) returning id),
 candidates as(select j.id from public.review_sync_jobs j where not exists(select 1 from public.review_corpus_policy where paused or ingestions_paused)
  and not(j.provider_start_attempted_at is not null and j.apify_run_id is null)
  and ((j.status in('queued','retry') and j.available_at<=now()) or (j.status='running' and j.lease_until<now()))
  order by j.available_at,j.scheduled_for,j.id for update skip locked limit least(greatest(coalesce(p_limit,25),1),100)),
 claimed as(update public.review_sync_jobs j set status='running',locked_by=left(p_worker_id,120),lease_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,240),30),900)),started_at=coalesce(j.started_at,now()),finished_at=null,claim_count=j.claim_count+1,updated_at=now() from candidates c where j.id=c.id returning j.*)
 select c.id,c.establishment_id,c.organization_id,c.status,c.attempts,c.pagination_cursor,c.checkpoint_review_id,c.checkpoint_review_at,c.head_review_id,c.head_review_at,c.provider_requests,c.reviews_fetched,c.reviews_inserted,e.google_id,e.google_maps_url from claimed c join public.establishments e on e.id=c.establishment_id order by c.scheduled_for,c.id
$$;
do $$declare d text;begin
 d=pg_get_functiondef('public.fail_review_sync_job(uuid,text,text,boolean,integer,integer)'::regprocedure);
 if position('case when p_retryable' in d)=0 then raise exception 'SYNC_FAILURE_DEFINITION_CHANGED';end if;
 d=replace(d,'case when p_retryable','case when p_retryable and not exists(select 1 from public.review_sync_jobs where id=p_job_id and provider_start_attempted_at is not null and apify_run_id is null)');execute d;
end$$;

-- Only the atomic native ingestion can bind a Google translation to an original.
create function private.bind_google_translation_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('home.retention_ingest',true) is distinct from 'on' then raise exception 'NATIVE_TRANSLATION_INGESTION_REQUIRED';end if;
 select encode(extensions.digest(coalesce(nullif(original_text,''),text,''),'sha256'),'hex') into new.source_text_sha256 from public.reviews where id=new.review_id;
 if new.source_text_sha256 is null then raise exception 'TRANSLATION_REVIEW_MISSING';end if;
 return new;
end$$;
revoke all on function private.bind_google_translation_source() from public,anon,authenticated,service_role;
create trigger google_translation_source before insert or update of translated_text on public.review_translations for each row execute function private.bind_google_translation_source();
create function private.invalidate_google_translation_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(nullif(old.original_text,''),old.text,'') is distinct from coalesce(nullif(new.original_text,''),new.text,'') then delete from public.review_translations where review_id=new.id;end if;
 return new;
end$$;
revoke all on function private.invalidate_google_translation_source() from public,anon,authenticated,service_role;
create trigger google_original_changed after update of original_text,text on public.reviews for each row execute function private.invalidate_google_translation_source();

-- Retire the extra translation provider and all preparation side effects.
drop trigger if exists review_display_source_changed on public.reviews;
update private.review_display_runtime set enabled=false where singleton;
select cron.alter_job(jobid,active:=false) from cron.job where jobname in('home-reviews-display-translations-v1','home-reviews-english-backfill-worker-v1');
create or replace function private.read_review_display(p_reviews uuid[],p_prepare boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare l text;result jsonb;begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 if cardinality(p_reviews)>30 or cardinality(p_reviews)<1 then raise exception 'DISPLAY_BATCH_INVALID';end if;
 select preferred_language into l from public.profiles where user_id=auth.uid();if l not in('fr','vi') or l is null then raise exception 'PREFERRED_LANGUAGE_REQUIRED';end if;
 if exists(select 1 from unnest(p_reviews) i where not exists(select 1 from public.reviews r where r.id=i and private.is_org_member(r.organization_id))) then raise exception 'FORBIDDEN';end if;
 select jsonb_agg(jsonb_build_object('review_id',r.id,'language',l,'original_text',s.original,'source_sha256',s.sha,'source_language',r.original_language,
  'status',case when public.review_usable_text(r.original_text,r.text) is null or lower(split_part(replace(coalesce(r.original_language,''),'_','-'),'-',1))=l or t.translated_text=s.original then 'original' when t.translated_text is not null then 'translated' else 'missing' end,
  'translated_text',case when lower(split_part(replace(coalesce(r.original_language,''),'_','-'),'-',1)) is distinct from l and t.translated_text<>s.original then t.translated_text end)) into result
 from public.reviews r cross join lateral(select coalesce(nullif(r.original_text,''),r.text,'') original,encode(extensions.digest(coalesce(nullif(r.original_text,''),r.text,''),'sha256'),'hex') sha)s
 left join public.review_translations t on t.review_id=r.id and t.language=l and t.source_text_sha256=s.sha and nullif(btrim(t.translated_text),'') is not null where r.id=any(p_reviews);
 return coalesce(result,'[]');
end$$;
create or replace function public.wake_review_display_queue() returns bigint language sql security definer set search_path='' as $$select null::bigint$$;
create or replace function public.claim_review_display(p_worker text) returns setof jsonb language sql security definer set search_path='' as $$select null::jsonb where false$$;
create or replace function public.reserve_review_display(p_review uuid,p_language text,p_sha text,p_worker text) returns uuid language sql security definer set search_path='' as $$select null::uuid$$;

create or replace function public.review_corpus_fingerprint(p_establishment uuid) returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'review_detailed_rating',r.review_detailed_rating,'review_context',r.review_context,'published_at',r.published_at,'original_text',coalesce(nullif(r.original_text,''),r.text),'original_language',r.original_language,
  'translations',(select jsonb_agg(jsonb_build_object('language',t.language,'text',t.translated_text,'source_sha',t.source_text_sha256) order by t.language) from public.review_translations t where t.review_id=r.id and t.language in('fr','vi'))) order by r.id),'[]')::text,'sha256'),'hex') from public.reviews r where r.establishment_id=p_establishment and r.id in(select public.retained_review_ids(p_establishment))
$$;
do $$declare d text;begin
 d=pg_get_functiondef('public.freeze_recent_review_source(uuid,uuid,text,timestamptz)'::regprocedure);
 d=replace(d,'''translated_text'',t.translated_text,','''translated_text'',t.translated_text,''source_text_sha256'',t.source_text_sha256,');
 d=replace(d,'''english_translation_override_policy'',''verified_english_translation_overrides_v1''','''analysis_text_policy'',''account_google_or_original_v1''');
 d=replace(d,'''retention_english_overrides'',overrides,','');
 d=replace(d,$old$select coalesce(jsonb_agg(to_jsonb(o)),'[]') into overrides from public.analysis_review_english_translation_overrides o where o.review_id in(select public.retained_review_ids(p_establishment,p_as_of));$old$,'');
 execute d;
 d=pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
 d=replace(d,'"english_translation_override_policy":"verified_english_translation_overrides_v1"','"analysis_text_policy":"account_google_or_original_v1"');execute d;
 d=pg_get_functiondef('private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean)'::regprocedure);
 d=replace(d,$old$'atmosphere_review_count');$old$,$new$'atmosphere_review_count','customer_rating_statistics','analysis_input_stats');$new$);
 d=replace(d,$old$'analysis_source',r->'analysis_source',$old$,$new$'analysis_source',r->'analysis_source','translation_provenance',r->'translation_provenance','review_detailed_rating',r->'review_detailed_rating',$new$);execute d;
 -- Current publication source validation must accept the chosen native version.
 for d in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f' and p.proname in('read_current_report_publication') loop
  d=replace(d,'language=''en''','language in(''fr'',''vi'')');
  d=replace(d,$old$ union all
    select corrected_english_text from public.analysis_review_english_translation_overrides where review_id=r.id$old$,'');execute d;
 end loop;
end$$;
