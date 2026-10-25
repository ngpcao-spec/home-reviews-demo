create index current_report_publications_organization on public.current_report_publications(organization_id);
-- Source cleanup no longer performs table DDL. Replace its former global DDL
-- lock with the same establishment lock used by ingestion and finalization.
-- This avoids lock inversion when the periodic sweep visits another restaurant.
do $$declare d text;a text;begin
 d=pg_get_functiondef('private.retention_retire_source(uuid,text)'::regprocedure);
 a='perform pg_advisory_xact_lock(hashtextextended(''retention-source-cleanup'',0));';
 if position(a in d)=0 then raise exception 'PUBLICATION_CLEANUP_LOCK_ANCHOR_CHANGED';end if;
 d=replace(d,a,'');
 a='if s.id is null then return true;end if;';
 d=replace(d,a,a||' perform pg_advisory_xact_lock(hashtextextended(''recent-text-corpus:''||s.establishment_id::text,0)); select * into s from public.historical_report_runs where id=p_source for update; if s.id is null then return true;end if;');execute d;
 d=pg_get_functiondef('private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean)'::regprocedure);
 a='if is_stale and not p_recovery then return false;end if;';
 if position(a in d)=0 then raise exception 'PUBLICATION_SCOPE_ANCHOR_CHANGED';end if;
 d=replace(d,a,'is_stale=is_stale or not exists(select 1 from public.review_corpus_policy where enabled and not paused and epoch::text=sc->>''policy_epoch''); if not p_recovery and not exists(select 1 from public.historical_report_runs where id=(p->>''current_source_run_id'')::uuid and establishment_id=(p->>''establishment_id'')::uuid and organization_id=(p->>''organization_id'')::uuid and language=p->>''language'') then raise exception ''PUBLICATION_TENANT_OR_LANGUAGE_CHANGED'';end if; '||a);execute d;
end $$;
