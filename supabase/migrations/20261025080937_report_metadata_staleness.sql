-- The original text fingerprint deliberately remains immutable. Detect changes
-- to the report's star/context inputs separately, including deferred bulk ingests.
create or replace function private.retention_review_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('home.retention_maintenance',true)='on' then return null;end if;
 if tg_op='UPDATE' then
  if (old.rating,old.review_context,old.review_detailed_rating) is distinct from (new.rating,new.review_context,new.review_detailed_rating) then
   update public.report_corpus_scopes set stale=true,stale_reason='REVIEW_METADATA_CHANGED' where establishment_id=new.establishment_id;
   update public.current_report_publications set stale=true,stale_reason='REVIEW_METADATA_CHANGED',updated_at=now() where establishment_id=new.establishment_id;
  end if;
 end if;
 if current_setting('home.retention_ingest',true)='on' then return null;end if;
 perform private.apply_recent_review_retention(case when tg_op='DELETE' then old.establishment_id else new.establishment_id end);return null;
end $$;
do $$declare d text;a text;begin
 d=pg_get_functiondef('private.apply_recent_review_retention(uuid,timestamptz)'::regprocedure);
 a='update public.report_corpus_scopes set stale=fingerprint<>f,stale_reason=case when fingerprint<>f then ''CORPUS_CHANGED'' end where establishment_id=p_establishment;';
 if position(a in d)=0 then raise exception 'PUBLICATION_STALE_ANCHOR_CHANGED';end if;
 d=replace(d,a,'update public.report_corpus_scopes set stale=stale or fingerprint<>f,stale_reason=case when stale then coalesce(stale_reason,''CORPUS_CHANGED'') when fingerprint<>f then ''CORPUS_CHANGED'' end where establishment_id=p_establishment;');execute d;
end $$;
-- Detect any already-changed frozen metadata without changing a source hash.
update public.report_corpus_scopes sc set stale=true,stale_reason='REVIEW_METADATA_CHANGED'
where exists(select 1 from public.historical_report_runs s cross join lateral jsonb_array_elements(s.snapshot->'retention_frozen_rows') b
 join public.reviews r on r.id=(b->>'id')::uuid where s.id=sc.source_run_id
 and (b->'rating',coalesce(b->'review_context','null'),coalesce(b->'review_detailed_rating','null')) is distinct from (to_jsonb(r.rating),coalesce(r.review_context,'null'),coalesce(r.review_detailed_rating,'null')));
update public.current_report_publications p set stale=true,stale_reason='REVIEW_METADATA_CHANGED'
where exists(select 1 from public.report_corpus_scopes sc where sc.source_run_id=p.source_run_id and sc.stale);
