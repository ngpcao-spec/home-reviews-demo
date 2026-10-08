-- V10 is opt-in and experimental: no migration-time enqueue, source updates or provider calls.
-- Independent ledger: preserve all V9 metrics and their single-threshold schema.
create table public.historical_jev_v10_run_metrics (like public.historical_jev_run_metrics including all);
-- Empty new table: remove its inherited V9-only policy field before it can contain data.
alter table public.historical_jev_v10_run_metrics drop column threshold;
alter table public.historical_jev_v10_run_metrics add column threshold_version text not null check(threshold_version='jev-theme-thresholds-v1');
alter table public.historical_jev_v10_run_metrics add column question_set text not null check(question_set='themes_v10_calibrated_v1');
alter table public.historical_jev_v10_run_metrics add column thresholds jsonb not null;
alter table public.historical_jev_v10_run_metrics add foreign key(run_id) references public.historical_report_runs(id);
alter table public.historical_jev_v10_run_metrics add foreign key(organization_id) references public.organizations(id);
alter table public.historical_jev_v10_run_metrics enable row level security;
revoke all on public.historical_jev_v10_run_metrics from public,anon,authenticated;
grant select,insert,update,delete on public.historical_jev_v10_run_metrics to service_role;
create policy historical_jev_v10_metrics_org_read on public.historical_jev_v10_run_metrics for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));

create function public.historical_v10_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;
begin
 if tg_table_name='historical_report_runs' then
  if old.snapshot->>'analysis_version' is distinct from '10' then if tg_op='DELETE' then return old;end if;return new;end if;
  if old.status='completed' then raise exception 'REPORT_V10_IMMUTABLE';end if;
  if tg_op='UPDATE' and (old.snapshot-'publication') is distinct from (new.snapshot-'publication') then raise exception 'REPORT_V10_SOURCE_IMMUTABLE';end if;
 else
  select status into state from public.historical_report_runs where id=case when tg_op='DELETE' then old.run_id else new.run_id end for update;
  if state='completed' then raise exception 'REPORT_V10_IMMUTABLE';end if;
  if tg_op='UPDATE' and (to_jsonb(old)-array['served_models','jev_theme_requests','jev_sentiment_requests','jev_input_tokens','jev_output_tokens','jev_retry_count','jev_elapsed_ms','sol_narrative_calls','sol_narrative_input_tokens','sol_narrative_output_tokens','sol_narrative_elapsed_ms','narrative_state','narrative_error','narrative_result','usage_complete']) is distinct from (to_jsonb(new)-array['served_models','jev_theme_requests','jev_sentiment_requests','jev_input_tokens','jev_output_tokens','jev_retry_count','jev_elapsed_ms','sol_narrative_calls','sol_narrative_input_tokens','sol_narrative_output_tokens','sol_narrative_elapsed_ms','narrative_state','narrative_error','narrative_result','usage_complete']) then raise exception 'REPORT_V10_CONFIG_IMMUTABLE';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger historical_v10_source_guard before update or delete on public.historical_report_runs for each row execute function public.historical_v10_immutable();
create trigger historical_v10_metrics_guard before insert or update or delete on public.historical_jev_v10_run_metrics for each row execute function public.historical_v10_immutable();
revoke all on function public.historical_v10_immutable() from public,anon,authenticated;

create function public.enqueue_first_v10_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_source_generation_id uuid,p_audit_id uuid,p_rates jsonb,p_config jsonb)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;s public.historical_report_runs;a public.analysis_v9_finding_audits;seed jsonb;item jsonb;pos integer;sha text;audit_snapshot jsonb;
begin
 if p_language not in ('fr','vi') or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_establishment_id is distinct from 'd57ed022-5924-41f2-a53f-685eb4de4d50'::uuid or p_source_generation_id is distinct from '91b77ec8-b58c-4735-a96d-496fa1a5404a'::uuid or p_audit_id is distinct from '9da6153d-3501-4df1-8266-f27398d3f0de'::uuid then raise exception 'REPORT_V10_SOURCE_REQUIRED';end if;
 select * into s from public.historical_report_runs where generation_id=p_source_generation_id and establishment_id=p_establishment_id and organization_id=p_organization_id and status='completed' and snapshot->>'analysis_version'='9';
 if s.id is null or jsonb_array_length(s.snapshot->'reviews')=0 or exists(select 1 from jsonb_array_elements(s.snapshot->'reviews') x where btrim(coalesce(x->>'analysis_text',''))<>'' and x->>'analysis_language' is distinct from 'en') then raise exception 'REPORT_V10_SOURCE_REQUIRED';end if;
 select * into a from public.analysis_v9_finding_audits where id=p_audit_id and organization_id=p_organization_id and establishment_id=p_establishment_id and status='completed' and source_v9_generation_id=p_source_generation_id and taxonomy_version='gold-taxonomy-v1';
 if a.id is null or (select count(*) from public.analysis_v9_finding_audit_items where audit_id=a.id)<>30 or (select count(*) from public.analysis_v9_finding_audit_labels where audit_id=a.id)<>30 then raise exception 'REPORT_V10_AUDIT_REQUIRED';end if;
 if p_config->>'analysis_engine' is distinct from 'jev_hybrid_calibrated' or p_config->>'threshold_version' is distinct from 'jev-theme-thresholds-v1' or p_config->>'question_set' is distinct from 'themes_v10_calibrated_v1' or p_config->>'requested_model' is distinct from 'jev-latest' or p_config->>'theme_repeat_count' is distinct from '3' or p_config->>'sentiment_repeat_count' is distinct from '1' or p_config->>'concurrency' is distinct from '8' or coalesce(jsonb_typeof(p_config->'thresholds'),'null')<>'object' or (select count(*) from jsonb_object_keys(p_config->'thresholds'))<>25 then raise exception 'REPORT_V10_CONFIG_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment_id::text||':'||p_language,0));
 select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and status in ('queued','running','retry') for update;
 if found then if r.snapshot->>'analysis_version'<>'10' or r.snapshot->>'source_generation_id'<>p_source_generation_id::text then raise exception 'REPORT_OTHER_VERSION_RUNNING';end if;return r;end if;
 select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and snapshot->>'analysis_version'='10' and snapshot->>'source_generation_id'=p_source_generation_id::text order by created_at desc,id desc limit 1;
 if found then if r.status='completed' then return r;end if;if r.status='failed' then update public.historical_report_runs set status='queued',attempt_count=0,next_retry_at=null,error_code=null,last_error=null,locked_by=null,lease_until=null,updated_at=now() where id=r.id returning * into r;return r;end if;end if;
 sha:=encode(extensions.digest(s.snapshot::text,'sha256'),'hex');
 audit_snapshot:=jsonb_build_object('id',a.id,'status',a.status,'source_v8_generation_id',a.source_v8_generation_id,'source_v9_generation_id',a.source_v9_generation_id,'taxonomy_version',a.taxonomy_version,'comparison',a.comparison,
  'items',(select jsonb_agg(to_jsonb(i) order by position) from public.analysis_v9_finding_audit_items i where audit_id=a.id),'labels',(select jsonb_agg(to_jsonb(l) order by item_id) from public.analysis_v9_finding_audit_labels l where audit_id=a.id));
 seed:=jsonb_build_object('analysis_version',10,'analysis_engine','jev_hybrid_calibrated','source_generation_id',s.generation_id,'source_snapshot_sha256',sha,'source_snapshot',s.snapshot,'reviews',s.snapshot->'reviews','base',(s.snapshot->'base')||jsonb_build_object('analysis_version',10,'preferred_language',p_language),'v10_config',p_config,'calibration_audit',audit_snapshot);
 insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model,total_steps) values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued',seed,'gpt-6.1-sol',(select count(*)*4+1 from jsonb_array_elements(s.snapshot->'reviews') x where btrim(coalesce(x->>'analysis_text',''))<>'')) returning * into r;
 insert into public.historical_jev_v10_run_metrics(run_id,organization_id,source_generation_id,source_snapshot_sha256,rates,threshold_version,question_set,thresholds) values(r.id,p_organization_id,s.generation_id,sha,p_rates,p_config->>'threshold_version',p_config->>'question_set',p_config->'thresholds');
 for item,pos in select value,ordinality::integer from jsonb_array_elements(s.snapshot->'reviews') with ordinality loop
  if btrim(coalesce(item->>'analysis_text',''))<>'' then
   insert into public.historical_jev_analysis_tasks(run_id,organization_id,review_id,review_alias,position,kind,repeat) values(r.id,p_organization_id,(item->>'id')::uuid,'r'||pos,pos,'sentiment',0);
   insert into public.historical_jev_analysis_tasks(run_id,organization_id,review_id,review_alias,position,kind,repeat) select r.id,p_organization_id,(item->>'id')::uuid,'r'||pos,pos,'themes',n from generate_series(1,3) n;
  end if;
 end loop;return r;
end $$;

-- Experimental completion saves only its own immutable run, not the current manager report.
create function public.complete_experimental_v10_report(p_run_id uuid,p_generation_id uuid,p_worker_id uuid,p_cursor integer,p_report jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
 select * into r from public.historical_report_runs where id=p_run_id and generation_id=p_generation_id and locked_by=p_worker_id and lease_until>now() and status='running' and cursor=p_cursor and snapshot->>'analysis_version'='10' for update;if not found then return false;end if;
 if p_report is distinct from r.snapshot->'publication' or p_report->>'generation_id' is distinct from r.generation_id::text or p_report->>'establishment_id' is distinct from r.establishment_id::text or p_report->>'organization_id' is distinct from r.organization_id::text or p_report->>'preferred_language' is distinct from r.language or p_report->>'analysis_version' is distinct from '10' or p_report->'consultant_report'->>'analysis_engine' is distinct from 'jev_hybrid_calibrated' or p_report->>'ai_status' is distinct from 'completed' or exists(select 1 from public.historical_jev_analysis_tasks where run_id=r.id and status in ('pending','running')) then raise exception 'REPORT_INVALID_PUBLICATION';end if;
 update public.historical_report_runs set status='completed',completed_at=now(),updated_at=now(),locked_by=null,lease_until=null,attempt_count=0,next_retry_at=null,error_code=null,last_error=null where id=r.id;return true;
end $$;
create function public.claim_historical_jev_v10_tasks(p_run_id uuid,p_worker_id uuid,p_limit integer default 8) returns setof public.historical_jev_analysis_tasks language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;t public.historical_jev_analysis_tasks;lost integer;
begin
 select * into r from public.historical_report_runs where id=p_run_id and locked_by=p_worker_id and status='running' and lease_until>now() and snapshot->>'analysis_version'='10' for update;if not found then raise exception 'REPORT_LEASE_LOST';end if;
 -- An interrupted paid request has unknown outcome. Do not replay it on recovery.
 update public.historical_jev_analysis_tasks set status='failed',error_code='JEV_INTERRUPTED_UNCONFIRMED',usage_complete=false,completed_at=now() where run_id=p_run_id and status='running' and locked_by is distinct from p_worker_id;
 get diagnostics lost=row_count;if lost>0 then update public.historical_report_runs set cursor=cursor+lost,token_usage_complete=false where id=p_run_id;update public.historical_jev_v10_run_metrics set usage_complete=false where run_id=p_run_id;end if;
 for t in select * from public.historical_jev_analysis_tasks where run_id=p_run_id and status='pending' order by position,case when kind='sentiment' then 0 else 1 end,repeat limit greatest(1,least(p_limit,8)) for update loop
  update public.historical_jev_analysis_tasks set status='running',locked_by=p_worker_id,started_at=now() where id=t.id returning * into t;return next t;
 end loop;
 update public.historical_report_runs set lease_until=now()+interval '240 seconds' where id=p_run_id;
end $$;

create function public.complete_historical_jev_v10_task(p_run_id uuid,p_worker_id uuid,p_task_id uuid,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;t public.historical_jev_analysis_tasks;
begin
 select * into r from public.historical_report_runs where id=p_run_id and locked_by=p_worker_id and status='running' and lease_until>now() and snapshot->>'analysis_version'='10' for update;if not found then return false;end if;
 select * into t from public.historical_jev_analysis_tasks where id=p_task_id and run_id=p_run_id and status='running' and locked_by=p_worker_id for update;if not found then return false;end if;
 if p_values->>'status' not in ('completed','failed') then raise exception 'JEV_TASK_RESULT_INVALID';end if;
 update public.historical_jev_analysis_tasks set status=p_values->>'status',result=p_values->'result',error_code=p_values->>'error_code',served_model=p_values->>'served_model',request_count=(p_values->>'request_count')::integer,retry_count=(p_values->>'retry_count')::integer,input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,duration_ms=(p_values->>'duration_ms')::bigint,usage_complete=(p_values->>'usage_complete')::boolean,completed_at=now() where id=t.id;
 update public.historical_jev_v10_run_metrics set jev_theme_requests=jev_theme_requests+case when t.kind='themes' then (p_values->>'request_count')::integer else 0 end,jev_sentiment_requests=jev_sentiment_requests+case when t.kind='sentiment' then (p_values->>'request_count')::integer else 0 end,jev_input_tokens=jev_input_tokens+(p_values->>'input_tokens')::bigint,jev_output_tokens=jev_output_tokens+(p_values->>'output_tokens')::bigint,jev_retry_count=jev_retry_count+(p_values->>'retry_count')::integer,usage_complete=usage_complete and (p_values->>'usage_complete')::boolean,served_models=case when p_values->>'served_model' is null then served_models else array(select distinct unnest(served_models||array[p_values->>'served_model']) order by 1) end where run_id=p_run_id;
 update public.historical_report_runs set cursor=cursor+1,lease_until=now()+interval '240 seconds',updated_at=now(),token_usage_complete=token_usage_complete and (p_values->>'usage_complete')::boolean where id=p_run_id;return true;
end $$;

create function public.historical_v10_metrics_update(p_run_id uuid,p_worker_id uuid,p_action text,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;m public.historical_jev_v10_run_metrics;
begin
 select * into r from public.historical_report_runs where id=p_run_id and locked_by=p_worker_id and status='running' and lease_until>now() and snapshot->>'analysis_version'='10' for update;if not found then return false;end if;
 select * into m from public.historical_jev_v10_run_metrics where run_id=p_run_id for update;
 if p_action='jev_elapsed' then update public.historical_jev_v10_run_metrics set jev_elapsed_ms=jev_elapsed_ms+(p_values->>'duration_ms')::bigint where run_id=p_run_id;
 elsif p_action='narrative_begin' then
  if m.narrative_state<>'pending' or exists(select 1 from public.historical_jev_analysis_tasks where run_id=p_run_id and status in ('pending','running')) then return false;end if;
  update public.historical_jev_v10_run_metrics set narrative_state='attempted',sol_narrative_calls=1 where run_id=p_run_id;update public.historical_report_runs set ai_calls=1 where id=p_run_id;
 elsif p_action='narrative_usage' then
  if m.narrative_state<>'attempted' then return false;end if;
  update public.historical_jev_v10_run_metrics set sol_narrative_input_tokens=(p_values->>'input_tokens')::bigint,sol_narrative_output_tokens=(p_values->>'output_tokens')::bigint where run_id=p_run_id;
  update public.historical_report_runs set input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint where id=p_run_id;
 elsif p_action='narrative_finish' then
  if m.narrative_state in ('completed','fallback') then return true;end if;
  update public.historical_jev_v10_run_metrics set narrative_state=case when (p_values->>'success')::boolean then 'completed' else 'fallback' end,narrative_result=p_values->'result',narrative_error=p_values->>'error_code',sol_narrative_elapsed_ms=coalesce((p_values->>'duration_ms')::bigint,0),usage_complete=usage_complete and coalesce((p_values->>'usage_complete')::boolean,true) where run_id=p_run_id;
 else raise exception 'V10_METRIC_ACTION_INVALID';end if;return true;
end $$;

revoke all on function public.enqueue_first_v10_report(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb),public.claim_historical_jev_v10_tasks(uuid,uuid,integer),public.complete_historical_jev_v10_task(uuid,uuid,uuid,jsonb),public.historical_v10_metrics_update(uuid,uuid,text,jsonb),public.complete_experimental_v10_report(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_first_v10_report(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb),public.claim_historical_jev_v10_tasks(uuid,uuid,integer),public.complete_historical_jev_v10_task(uuid,uuid,uuid,jsonb),public.historical_v10_metrics_update(uuid,uuid,text,jsonb),public.complete_experimental_v10_report(uuid,uuid,uuid,integer,jsonb) to service_role;
