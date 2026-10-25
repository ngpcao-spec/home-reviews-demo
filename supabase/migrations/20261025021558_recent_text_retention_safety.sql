-- Keep absence of a receipt distinct from a native JSON receipt.
do $$declare d text;begin
 d=pg_get_functiondef('private.record_retention_attempt(text,jsonb)'::regprocedure);
 d=replace(d,'rec=coalesce(j->''sol_receipt'',j->''receipt'',j->''response'');','rec=coalesce(nullif(j->''sol_receipt'',''null''),nullif(j->''receipt'',''null''),nullif(j->''response'',''null''));');
 d=replace(d,'outcome=case when j->>''status'' in(''completed'',''reused'',''success'')','outcome=case when j->>''status'' in(''unknown'',''billing_uncertain'') then ''unknown'' when j->>''status'' in(''completed'',''reused'',''success'')');
 execute d;
end $$;

create or replace function public.retention_write_guard() returns trigger language plpgsql set search_path='' as $$
declare p public.review_corpus_policy;begin
 if current_user in('postgres','supabase_admin') and current_setting('home.retention_maintenance',true)='on' then return null;end if;
 select * into p from public.review_corpus_policy where id for share;
 if p.paused then raise exception 'RETENTION_TRANSITION_ACTIVE';end if;
 if tg_table_schema||'.'||tg_table_name=any(p.retired_relations) then raise exception 'REPORT_PIPELINE_RETIRED';end if;
 if p.ingestions_paused and tg_table_name in('reviews','review_translations','review_provider_payloads','review_reply_drafts','initial_import_jobs','review_sync_jobs','sync_runs','establishment_snapshots') then raise exception 'RETENTION_INGESTION_PAUSED';end if;
 return null;
end $$;
