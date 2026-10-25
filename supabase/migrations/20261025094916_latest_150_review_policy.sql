-- 150 latest unique published reviews, all stars, with or without text.
alter table public.review_corpus_policy drop constraint review_corpus_policy_max_text_reviews_check;
alter table public.review_corpus_policy drop constraint review_corpus_policy_months_check;
alter table public.review_corpus_policy alter column months drop not null;
update public.review_corpus_policy set max_text_reviews=150,months=null where id;
alter table public.review_corpus_policy add constraint review_corpus_policy_max_text_reviews_check check(max_text_reviews=150);
alter table public.review_corpus_policy add constraint review_corpus_policy_months_check check(months is null);
alter table public.review_corpus_policy alter column max_text_reviews set default 150;
alter table public.review_corpus_policy alter column months set default null;
alter table public.review_corpus_policy alter column version set default 'latest_reviews_150_v1';
alter table public.review_corpus_states drop constraint review_corpus_states_retained_count_check;
alter table public.review_corpus_states add constraint review_corpus_states_retained_count_check check(retained_count between 0 and 150);
alter table public.review_corpus_states add column text_count integer not null default 0 check(text_count between 0 and 150);
alter table public.report_corpus_scopes drop constraint report_corpus_scopes_review_count_check;
alter table public.report_corpus_scopes add constraint report_corpus_scopes_review_count_check check(review_count between 1 and 150);
alter table public.report_corpus_scopes alter column cutoff drop not null;
alter table public.review_retention_events alter column cutoff drop not null;
update public.review_corpus_policy set version='latest_reviews_150_v1',max_text_reviews=150,months=null,epoch=gen_random_uuid(),updated_at=now() where id;
create or replace function public.retained_review_ids(p_establishment uuid,p_as_of timestamptz default now())
returns setof uuid language sql stable set search_path='' as $$
 with candidates as (
  select r.*,min(r.published_at) over(partition by btrim(r.external_review_id)) first_publication,
   row_number() over(partition by btrim(r.external_review_id) order by (public.review_usable_text(r.original_text,r.text) is not null) desc,r.updated_at desc,r.id) duplicate_rank
  from public.reviews r where r.establishment_id=p_establishment
 ) select id from candidates where duplicate_rank=1 and first_publication<=p_as_of
 order by first_publication desc,btrim(external_review_id) collate "C",id limit 150
$$;
CREATE OR REPLACE FUNCTION public.review_corpus_fingerprint(p_establishment uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'rating',r.rating,'review_detailed_rating',r.review_detailed_rating,'review_context',r.review_context,'published_at',r.published_at,'original_text',coalesce(nullif(r.original_text,''),r.text),
  'original_language',r.original_language,
  'english',(select translated_text from public.review_translations t where t.review_id=r.id and t.language='en'),
  'override',(select jsonb_build_object('text',o.corrected_english_text,'status',o.status,'original_sha',o.original_text_sha256,'provider_sha',o.provider_translation_sha256) from public.analysis_review_english_translation_overrides o where o.review_id=r.id)
 ) order by r.id),'[]')::text,'sha256'),'hex')
 from public.reviews r where r.establishment_id=p_establishment and r.id in(select public.retained_review_ids(p_establishment))
$function$
;
CREATE OR REPLACE FUNCTION private.retention_review_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.review_corpus_policy;seen private.review_seen_keys;sha text;first_seen boolean;oldest public.reviews;valid_n integer;begin
 if current_user in('postgres','supabase_admin') and current_setting('home.retention_maintenance',true)='on' then return new;end if;
 select * into p from public.review_corpus_policy where id for share;
 if not p.enabled then return new;end if;
 if p.paused or p.ingestions_paused then raise exception 'RETENTION_INGESTION_PAUSED';end if;
 if not exists(select 1 from public.establishments where id=new.establishment_id and organization_id=new.organization_id)
 or current_setting('role',true)='authenticated' and not exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=(select auth.uid())) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||new.establishment_id::text,0));
 if tg_op='UPDATE' then
  if new.establishment_id<>old.establishment_id or new.organization_id<>old.organization_id or btrim(new.external_review_id)<>btrim(old.external_review_id) then raise exception 'REVIEW_IDENTITY_IMMUTABLE';end if;
  new.published_at=least(old.published_at,new.published_at);
 end if;
 new.external_review_id=btrim(new.external_review_id);
 if nullif(btrim(new.original_text),'') is null and nullif(btrim(new.text),'') is not null then new.original_text=new.text;end if;
 sha=encode(extensions.digest(new.external_review_id,'sha256'),'hex');
 select * into seen from private.review_seen_keys where establishment_id=new.establishment_id and external_key_sha256=sha;
 first_seen=seen.establishment_id is null;
 new.published_at=least(new.published_at,seen.first_published_at);
 insert into private.review_seen_keys(establishment_id,external_key_sha256,first_published_at) values(new.establishment_id,sha,new.published_at)
 on conflict(establishment_id,external_key_sha256) do update set first_published_at=least(review_seen_keys.first_published_at,excluded.first_published_at);
 if tg_op='UPDATE' or exists(select 1 from public.reviews where establishment_id=new.establishment_id and external_review_id=new.external_review_id) then return new;end if;
 if new.published_at is null or new.published_at>now() then return null;end if;
 select count(*) into valid_n from public.retained_review_ids(new.establishment_id);
 if valid_n>=150 then
  select r.* into oldest from public.reviews r where id in(select public.retained_review_ids(new.establishment_id)) order by published_at,external_review_id collate "C" desc,id desc limit 1;
  if new.published_at<oldest.published_at or new.published_at=oldest.published_at and new.external_review_id collate "C">=oldest.external_review_id collate "C" then return null;end if;
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.apply_recent_review_retention(p_establishment uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.review_corpus_policy;e public.establishments;keep uuid[];excluded uuid[];before_n integer;after_n integer;f text;prior text;s record;begin
 select * into p from public.review_corpus_policy where id for share;
 if not p.enabled then return jsonb_build_object('enabled',false);end if;
 select * into e from public.establishments where id=p_establishment;
 if e.id is null then raise exception 'ESTABLISHMENT_NOT_FOUND';end if;
 if current_setting('role',true)='authenticated' and not exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=(select auth.uid())) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 select coalesce(array_agg(id),'{}') into keep from public.retained_review_ids(p_establishment,p_as_of) id;
 select count(*),coalesce(array_agg(id) filter(where not(id=any(keep))),'{}') into before_n,excluded from public.reviews where establishment_id=p_establishment;
 prior=current_setting('home.retention_maintenance',true);perform set_config('home.retention_maintenance','on',true);
 for s in select source_run_id from public.report_corpus_scopes where establishment_id=p_establishment and not(review_ids<@keep) loop perform private.retention_retire_source(s.source_run_id,'CORPUS_REVIEW_REMOVED');end loop;
 -- All other review FK dependents were retired during the explicit cutover.
 -- These are the ongoing, review-scoped dependencies inspected before deletion.
 delete from public.analysis_review_english_translation_overrides where review_id=any(excluded);
 delete from public.notifications where review_id=any(excluded);
 delete from public.push_test_deliveries where review_id=any(excluded);
 delete from public.review_reply_drafts where review_id=any(excluded);
 delete from public.review_translations where review_id=any(excluded);
 delete from public.review_provider_payloads where review_id=any(excluded);
 delete from public.reviews where id=any(excluded);
 select count(*) into after_n from public.reviews where establishment_id=p_establishment;
 f=public.review_corpus_fingerprint(p_establishment);
 insert into public.review_corpus_states(establishment_id,organization_id,policy_epoch,checked_at,retained_count,text_count,period_start,period_end,fingerprint)
 select e.id,e.organization_id,p.epoch,p_as_of,after_n,count(*) filter(where public.review_usable_text(original_text,text) is not null),min(published_at),max(published_at),f from public.reviews where establishment_id=p_establishment
 on conflict(establishment_id) do update set policy_epoch=excluded.policy_epoch,checked_at=excluded.checked_at,retained_count=excluded.retained_count,text_count=excluded.text_count,period_start=excluded.period_start,period_end=excluded.period_end,fingerprint=excluded.fingerprint,changed_at=case when review_corpus_states.fingerprint<>excluded.fingerprint then now() else review_corpus_states.changed_at end;
 update public.report_corpus_scopes set stale=stale or fingerprint<>f,stale_reason=case when stale then coalesce(stale_reason,'CORPUS_CHANGED') when fingerprint<>f then 'CORPUS_CHANGED' end where establishment_id=p_establishment;
 update public.current_report_publications set stale=true,stale_reason='CORPUS_CHANGED',updated_at=now() where establishment_id=p_establishment and scope->>'fingerprint' is distinct from f;
 for s in select source_run_id from public.report_corpus_scopes where establishment_id=p_establishment and stale loop perform private.retention_retire_source(s.source_run_id,'CORPUS_CHANGED');end loop;
 if before_n<>after_n then insert into public.review_retention_events(organization_id,establishment_id,policy_epoch,as_of,cutoff,before_count,after_count,purged_count) values(e.organization_id,e.id,p.epoch,p_as_of,null,before_n,after_n,before_n-after_n);end if;
 perform set_config('home.retention_maintenance',coalesce(prior,''),true);
 return jsonb_build_object('establishment_id',e.id,'retained',after_n,'purged',before_n-after_n,'fingerprint',f);
end $function$
;
CREATE OR REPLACE FUNCTION public.freeze_recent_review_source(p_establishment uuid, p_organization uuid, p_language text, p_as_of timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.review_corpus_policy;rows jsonb;overrides jsonb;meta jsonb;e jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.review_corpus_policy where id for share;
 if p.paused or not p.enabled then raise exception 'RETENTION_TRANSITION_ACTIVE';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 perform private.apply_recent_review_retention(p_establishment,p_as_of);
 select jsonb_build_object('id',id,'organization_id',organization_id,'name',name,'rating',(select avg(rating) from public.reviews where establishment_id=p_establishment),'total_reviews',(select count(*) from public.reviews where establishment_id=p_establishment),'created_at',created_at) into e from public.establishments where id=p_establishment and organization_id=p_organization;
 if e is null then raise exception 'FORBIDDEN';end if;
 select jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'original_text',coalesce(nullif(r.original_text,''),r.text),'original_language',r.original_language,'text',r.text,'published_at',r.published_at,
  'historical_import',r.historical_import,'has_negative_feedback',r.has_negative_feedback,'status',r.status,'review_detailed_rating',r.review_detailed_rating,'review_context',r.review_context,
  'ai_status',r.ai_status,'ai_suggested_reply',r.ai_suggested_reply,'ai_suggested_reply_language',r.ai_suggested_reply_language,'reply_draft_text',r.reply_draft_text,'reply_draft_language',r.reply_draft_language,
  'review_translations',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'language',t.language,'translated_text',t.translated_text,'created_at',t.created_at,'updated_at',t.updated_at) order by t.language) from public.review_translations t where t.review_id=r.id),'[]'),
  'review_reply_drafts',coalesce((select jsonb_agg(jsonb_build_object('language',d.language,'ai_status',d.ai_status,'draft_text',d.draft_text,'ai_suggested_reply',d.ai_suggested_reply)) from public.review_reply_drafts d where d.review_id=r.id),'[]')) order by r.id),
  jsonb_build_object('epoch',p.epoch,'version',p.version,'as_of',p_as_of,'cutoff',null,'review_count',count(*),'period_start',min(r.published_at),'period_end',max(r.published_at),
   'review_ids',jsonb_agg(r.id order by r.id),'fingerprint',public.review_corpus_fingerprint(p_establishment)) into rows,meta
 from public.reviews r where r.establishment_id=p_establishment and r.id in(select public.retained_review_ids(p_establishment,p_as_of));
 if rows is null then raise exception 'NO_REVIEWS_AVAILABLE';end if; if not exists(select 1 from public.reviews where establishment_id=p_establishment and public.review_usable_text(original_text,text) is not null) then raise exception 'NO_TEXT_REVIEWS_AVAILABLE';end if;
 select coalesce(jsonb_agg(to_jsonb(o)),'[]') into overrides from public.analysis_review_english_translation_overrides o where o.review_id in(select public.retained_review_ids(p_establishment,p_as_of));
 return jsonb_build_object('analysis_version',8,'english_translation_override_policy','verified_english_translation_overrides_v1','retention',meta,'retention_frozen_rows',rows,'retention_english_overrides',overrides,'retention_establishment',e);
end $function$
;
CREATE OR REPLACE FUNCTION public.read_current_report_publication(p_establishment uuid, p_language text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with pub as (select * from public.current_report_publications where establishment_id=p_establishment and language=p_language),
 live as (
  select b, r.id,coalesce(nullif(r.original_text,''),r.text) original,
   (select candidate from (select coalesce(nullif(r.original_text,''),r.text) candidate union all select r.text union all
    select translated_text from public.review_translations where review_id=r.id and language='en' union all
    select corrected_english_text from public.analysis_review_english_translation_overrides where review_id=r.id) x
    where encode(extensions.digest(candidate,'sha256'),'hex')=b->>'analysis_text_sha256' limit 1) analysis
  from pub p cross join lateral jsonb_array_elements(p.source_bindings) b
  left join public.reviews r on r.id=(b->>'id')::uuid and r.establishment_id=p.establishment_id and r.organization_id=p.organization_id
   and r.published_at<=now()
 ), available as (
  select b||jsonb_build_object('original_text',original,'analysis_text',analysis) body from live
  where id is not null and analysis is not null and encode(extensions.digest(original,'sha256'),'hex')=b->>'original_text_sha256'
 ), availability as (
  select jsonb_build_object('review_id',b->>'id','available',exists(select 1 from available a where a.body->>'id'=b->>'id'),
   'reason',case when exists(select 1 from available a where a.body->>'id'=b->>'id') then null when id is null then 'review_removed' else 'review_changed' end) body from live
 ), evidence as (
  select e||jsonb_build_object('quote',(select a.body->>'analysis_text' from available a where a.body->>'id'=e->>'review_id' and a.body->>'analysis_text_sha256'=e->>'quote_sha256'),
   'available',exists(select 1 from available a where a.body->>'id'=e->>'review_id' and a.body->>'analysis_text_sha256'=e->>'quote_sha256')) body
  from pub p cross join lateral jsonb_array_elements(p.evidence_bindings) e
 )
 select jsonb_build_object('scope',p.scope||jsonb_build_object('stale',p.stale or exists(select 1 from availability a where a.body->>'available'='false')
  or p.scope->>'fingerprint' is distinct from (select fingerprint from public.review_corpus_states where establishment_id=p.establishment_id)),
  'row',p.document||jsonb_build_object('source_reviews',coalesce((select jsonb_agg(body) from available),'[]'),
   'controls',p.document->'controls'||jsonb_build_object('evidence',coalesce((select jsonb_agg(body) from evidence),'[]'),'source_availability',coalesce((select jsonb_agg(body) from availability),'[]')))) from pub p
$function$
;

-- Rating-only reviews contribute to corpus statistics, never automatic text AI.
drop trigger if exists reviews_enqueue_ai_after_insert on public.reviews;
create trigger reviews_enqueue_ai_after_insert after insert on public.reviews for each row
 when(new.historical_import=false and new.rating between 1 and 4 and public.review_usable_text(new.original_text,new.text) is not null)
 execute function private.enqueue_review_ai();
-- An explicit finite import cap is configuration, not a new provider call.
alter table public.initial_import_jobs alter column reviews_target set default 150;
do $$declare c record;d text;begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.initial_import_jobs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reviews_target%' loop
  execute format('alter table public.initial_import_jobs drop constraint %I',c.conname);
  execute format('alter table public.initial_import_jobs add constraint %I %s',c.conname,replace(c.definition,'100','150'));
 end loop;
 -- Existing enqueue function has a default from the old initial cap.
 for c in select oid from pg_proc where pronamespace='public'::regnamespace and proname='enqueue_initial_import_job' loop
  d=pg_get_functiondef(c.oid);d=replace(d,'DEFAULT 100','DEFAULT 150');d=replace(d,'least(100,','least(150,');d=replace(d,'> 100','> 150');execute d;
 end loop;
end $$;
