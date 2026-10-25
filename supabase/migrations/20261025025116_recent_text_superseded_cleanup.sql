-- Failed drafts are obsolete too once a newer report is available. Preserve
-- their consumed attempts in the text-free ledger, not full duplicate corpora.
-- Never ALTER a table from a live ingestion/enqueue/maintenance query. Only
-- trusted internal DELETE maintenance may pass the existing immutable guards.
do $$declare d text;f record;begin
 for f in select distinct p.oid from pg_trigger t join pg_proc p on p.oid=t.tgfoid
  where not t.tgisinternal and (t.tgtype&8)=8 and (t.tgtype&1)=1
  and t.tgrelid in('public.report_generation_abandonments'::regclass,'public.report_generation_requests'::regclass,'public.analysis_jev_batch_tasks'::regclass,'public.analysis_jev_batch_runs'::regclass,'public.analysis_parallel_reports'::regclass,'public.analysis_parallel_launch_preparations'::regclass,'public.historical_report_runs'::regclass)
 loop
  d=pg_get_functiondef(f.oid);
  d=overlay(d placing 'begin if tg_op=''DELETE'' and current_user in(''postgres'',''supabase_admin'') and current_setting(''home.retention_maintenance'',true)=''on'' then return old;end if;' from position('begin' in d) for 5);execute d;
 end loop;
 d=pg_get_functiondef('private.retention_retire_source(uuid,text)'::regprocedure);
 d=regexp_replace(d,'foreach t in array array\[[^;]+disable trigger user[^;]+;end loop;','','g');
 d=regexp_replace(d,'foreach t in array array\[[^;]+enable trigger user[^;]+;end loop;','','g');
 if d like '%alter table%' then raise exception 'RETENTION_CLEANUP_DDL_REMAINS';end if;execute d;
end $$;
create or replace function public.maintain_recent_review_corpora() returns jsonb language plpgsql security definer set search_path='' as $$
declare e record;s record;n integer=0;begin
 if not exists(select 1 from public.review_corpus_policy where enabled and not paused) then return jsonb_build_object('paused',true);end if;
 for e in select id from public.establishments order by id loop perform private.apply_recent_review_retention(e.id);n=n+1;end loop;
 for s in select old.id source_id from public.historical_report_runs old join public.report_corpus_scopes sc on sc.source_run_id=old.id
  where old.status in('completed','failed') and exists(
   select 1 from public.analysis_parallel_reports newer join public.historical_report_runs src on src.id=newer.current_source_run_id
   where newer.establishment_id=old.establishment_id and newer.language=old.language and newer.state in('completed','needs_review')
   and (src.created_at,src.id)>(old.created_at,old.id))
 loop perform private.retention_retire_source(s.source_id,'SUPERSEDED_REPORT');end loop;
 delete from public.review_retention_events where created_at<now()-interval '90 days';
 return jsonb_build_object('establishments_checked',n);
end $$;
