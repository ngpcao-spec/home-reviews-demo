-- V9 ledger only; no migration-time enqueue and no old-row/schema-column rewrite.
create table public.historical_jev_run_metrics(
 run_id uuid primary key references public.historical_report_runs(id),organization_id uuid not null references public.organizations(id),source_generation_id uuid not null,source_snapshot_sha256 text not null,
 requested_model text not null default 'jev-latest',served_models text[] not null default '{}',theme_repeat_count integer not null default 3 check(theme_repeat_count=3),sentiment_repeat_count integer not null default 1 check(sentiment_repeat_count=1),concurrency integer not null default 8 check(concurrency=8),threshold numeric not null default .5 check(threshold=.5),rates jsonb not null,
 jev_theme_requests bigint not null default 0,jev_sentiment_requests bigint not null default 0,jev_input_tokens bigint not null default 0,jev_output_tokens bigint not null default 0,jev_retry_count integer not null default 0,jev_elapsed_ms bigint not null default 0,
 sol_narrative_calls integer not null default 0 check(sol_narrative_calls between 0 and 1),sol_narrative_input_tokens bigint not null default 0,sol_narrative_output_tokens bigint not null default 0,sol_narrative_elapsed_ms bigint not null default 0,narrative_state text not null default 'pending' check(narrative_state in ('pending','attempted','completed','fallback')),narrative_error text,narrative_result jsonb,usage_complete boolean not null default true,created_at timestamptz not null default now()
);
create table public.historical_jev_analysis_tasks(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.historical_report_runs(id),organization_id uuid not null references public.organizations(id),review_id uuid not null,review_alias text not null,position integer not null,kind text not null check(kind in ('sentiment','themes')),repeat integer not null,check((kind='sentiment' and repeat=0) or (kind='themes' and repeat between 1 and 3)),
 status text not null default 'pending' check(status in ('pending','running','completed','failed')),locked_by uuid,started_at timestamptz,completed_at timestamptz,result jsonb,error_code text,served_model text,request_count integer not null default 0,retry_count integer not null default 0,input_tokens bigint not null default 0,output_tokens bigint not null default 0,duration_ms bigint not null default 0,usage_complete boolean not null default true,
 unique(run_id,review_id,kind,repeat)
);
create index historical_jev_tasks_run_status on public.historical_jev_analysis_tasks(run_id,status,position,kind,repeat);
create index historical_jev_metrics_org on public.historical_jev_run_metrics(organization_id);
create index historical_jev_tasks_org on public.historical_jev_analysis_tasks(organization_id);
alter table public.historical_jev_run_metrics enable row level security;
alter table public.historical_jev_analysis_tasks enable row level security;
revoke all on public.historical_jev_run_metrics,public.historical_jev_analysis_tasks from public,anon,authenticated;
grant select,insert,update,delete on public.historical_jev_run_metrics,public.historical_jev_analysis_tasks to service_role;
create policy historical_jev_metrics_org_read on public.historical_jev_run_metrics for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy historical_jev_tasks_org_read on public.historical_jev_analysis_tasks for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));

create function public.historical_v9_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;
begin
 if tg_table_name='historical_report_runs' then
  if old.snapshot->>'analysis_version' is distinct from '9' then if tg_op='DELETE' then return old;end if;return new;end if;
  if old.status='completed' then raise exception 'REPORT_V9_IMMUTABLE';end if;
  if tg_op='UPDATE' and (new.snapshot->'source_snapshot' is distinct from old.snapshot->'source_snapshot' or new.snapshot->'reviews' is distinct from old.snapshot->'reviews' or new.snapshot->'base' is distinct from old.snapshot->'base' or new.snapshot->>'source_generation_id' is distinct from old.snapshot->>'source_generation_id' or new.snapshot->>'analysis_version' is distinct from '9') then raise exception 'REPORT_V9_SOURCE_IMMUTABLE';end if;
 else
  select status into state from public.historical_report_runs where id=case when tg_op='DELETE' then old.run_id else new.run_id end for update;if state='completed' then raise exception 'REPORT_V9_IMMUTABLE';end if;
  if tg_op='UPDATE' then
   if new.run_id<>old.run_id or new.organization_id<>old.organization_id then raise exception 'REPORT_V9_SOURCE_IMMUTABLE';end if;
   if tg_table_name='historical_jev_analysis_tasks' then if old.status in ('completed','failed') then raise exception 'JEV_TASK_IMMUTABLE';end if;end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger historical_v9_source_guard before update or delete on public.historical_report_runs for each row execute function public.historical_v9_immutable();
create trigger historical_v9_metrics_guard before insert or update or delete on public.historical_jev_run_metrics for each row execute function public.historical_v9_immutable();
create trigger historical_v9_tasks_guard before insert or update or delete on public.historical_jev_analysis_tasks for each row execute function public.historical_v9_immutable();
revoke all on function public.historical_v9_immutable() from public,anon,authenticated;

create function public.enqueue_first_v9_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_source_generation_id uuid,p_rates jsonb)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;s public.historical_report_runs;seed jsonb;item jsonb;pos integer;sha text;
begin
 if p_language not in ('fr','vi') or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 select * into s from public.historical_report_runs where generation_id=p_source_generation_id and establishment_id=p_establishment_id and organization_id=p_organization_id and status='completed' and snapshot->>'analysis_version'='8';
 if s.id is null or jsonb_array_length(s.snapshot->'reviews')=0 or exists(select 1 from jsonb_array_elements(s.snapshot->'reviews') x where btrim(coalesce(x->>'analysis_text',''))<>'' and x->>'analysis_language' is distinct from 'en') then raise exception 'REPORT_V9_SOURCE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment_id::text||':'||p_language,0));
 select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and status in ('queued','running','retry') for update;
 if found then if r.snapshot->>'analysis_version'<>'9' or r.snapshot->>'source_generation_id'<>p_source_generation_id::text then raise exception 'REPORT_OTHER_VERSION_RUNNING';end if;return r;end if;
 select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and snapshot->>'analysis_version'='9' and snapshot->>'source_generation_id'=p_source_generation_id::text order by created_at desc,id desc limit 1;
 if found then if r.status='completed' then return r;end if;if r.status='failed' then update public.historical_report_runs set status='queued',attempt_count=0,next_retry_at=null,error_code=null,last_error=null,locked_by=null,lease_until=null,updated_at=now() where id=r.id returning * into r;return r;end if;end if;
 sha:=encode(extensions.digest(s.snapshot::text,'sha256'),'hex');
 seed:=jsonb_build_object('analysis_version',9,'analysis_engine','jev_hybrid','source_generation_id',s.generation_id,'source_snapshot_sha256',sha,'source_snapshot',s.snapshot,'reviews',s.snapshot->'reviews','base',(s.snapshot->'base')||jsonb_build_object('analysis_version',9,'preferred_language',p_language),'v9_config',jsonb_build_object('requested_model','jev-latest','theme_repeat_count',3,'sentiment_repeat_count',1,'concurrency',8,'threshold',.5,'question_set','themes_phase2_v7'));
 insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model,total_steps) values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued',seed,'gpt-6.1-sol',(select count(*)*4+1 from jsonb_array_elements(s.snapshot->'reviews') x where btrim(coalesce(x->>'analysis_text',''))<>'')) returning * into r;
 insert into public.historical_jev_run_metrics(run_id,organization_id,source_generation_id,source_snapshot_sha256,rates) values(r.id,p_organization_id,s.generation_id,sha,p_rates);
 for item,pos in select value,ordinality::integer from jsonb_array_elements(s.snapshot->'reviews') with ordinality loop
  if btrim(coalesce(item->>'analysis_text',''))<>'' then
   insert into public.historical_jev_analysis_tasks(run_id,organization_id,review_id,review_alias,position,kind,repeat) values(r.id,p_organization_id,(item->>'id')::uuid,'r'||pos,pos,'sentiment',0);
   insert into public.historical_jev_analysis_tasks(run_id,organization_id,review_id,review_alias,position,kind,repeat) select r.id,p_organization_id,(item->>'id')::uuid,'r'||pos,pos,'themes',n from generate_series(1,3) n;
  end if;
 end loop;return r;
end $$;

create function public.claim_historical_jev_tasks(p_run_id uuid,p_worker_id uuid,p_limit integer default 8) returns setof public.historical_jev_analysis_tasks language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;t public.historical_jev_analysis_tasks;lost integer;
begin
 select * into r from public.historical_report_runs where id=p_run_id and locked_by=p_worker_id and status='running' and lease_until>now() and snapshot->>'analysis_version'='9' for update;if not found then raise exception 'REPORT_LEASE_LOST';end if;
 -- An interrupted paid request has unknown outcome. Do not replay it on recovery.
 update public.historical_jev_analysis_tasks set status='failed',error_code='JEV_INTERRUPTED_UNCONFIRMED',usage_complete=false,completed_at=now() where run_id=p_run_id and status='running' and locked_by is distinct from p_worker_id;
 get diagnostics lost=row_count;if lost>0 then update public.historical_report_runs set cursor=cursor+lost,token_usage_complete=false where id=p_run_id;update public.historical_jev_run_metrics set usage_complete=false where run_id=p_run_id;end if;
 for t in select * from public.historical_jev_analysis_tasks where run_id=p_run_id and status='pending' order by position,case when kind='sentiment' then 0 else 1 end,repeat limit greatest(1,least(p_limit,8)) for update loop
  update public.historical_jev_analysis_tasks set status='running',locked_by=p_worker_id,started_at=now() where id=t.id returning * into t;return next t;
 end loop;
 update public.historical_report_runs set lease_until=now()+interval '240 seconds' where id=p_run_id;
end $$;

create function public.complete_historical_jev_task(p_run_id uuid,p_worker_id uuid,p_task_id uuid,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;t public.historical_jev_analysis_tasks;
begin
 select * into r from public.historical_report_runs where id=p_run_id and locked_by=p_worker_id and status='running' and lease_until>now() and snapshot->>'analysis_version'='9' for update;if not found then return false;end if;
 select * into t from public.historical_jev_analysis_tasks where id=p_task_id and run_id=p_run_id and status='running' and locked_by=p_worker_id for update;if not found then return false;end if;
 if p_values->>'status' not in ('completed','failed') then raise exception 'JEV_TASK_RESULT_INVALID';end if;
 update public.historical_jev_analysis_tasks set status=p_values->>'status',result=p_values->'result',error_code=p_values->>'error_code',served_model=p_values->>'served_model',request_count=(p_values->>'request_count')::integer,retry_count=(p_values->>'retry_count')::integer,input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,duration_ms=(p_values->>'duration_ms')::bigint,usage_complete=(p_values->>'usage_complete')::boolean,completed_at=now() where id=t.id;
 update public.historical_jev_run_metrics set jev_theme_requests=jev_theme_requests+case when t.kind='themes' then (p_values->>'request_count')::integer else 0 end,jev_sentiment_requests=jev_sentiment_requests+case when t.kind='sentiment' then (p_values->>'request_count')::integer else 0 end,jev_input_tokens=jev_input_tokens+(p_values->>'input_tokens')::bigint,jev_output_tokens=jev_output_tokens+(p_values->>'output_tokens')::bigint,jev_retry_count=jev_retry_count+(p_values->>'retry_count')::integer,usage_complete=usage_complete and (p_values->>'usage_complete')::boolean,served_models=case when p_values->>'served_model' is null then served_models else array(select distinct unnest(served_models||array[p_values->>'served_model']) order by 1) end where run_id=p_run_id;
 update public.historical_report_runs set cursor=cursor+1,lease_until=now()+interval '240 seconds',updated_at=now(),token_usage_complete=token_usage_complete and (p_values->>'usage_complete')::boolean where id=p_run_id;return true;
end $$;

create function public.historical_v9_metrics_update(p_run_id uuid,p_worker_id uuid,p_action text,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;m public.historical_jev_run_metrics;
begin
 select * into r from public.historical_report_runs where id=p_run_id and locked_by=p_worker_id and status='running' and lease_until>now() and snapshot->>'analysis_version'='9' for update;if not found then return false;end if;
 select * into m from public.historical_jev_run_metrics where run_id=p_run_id for update;
 if p_action='jev_elapsed' then update public.historical_jev_run_metrics set jev_elapsed_ms=jev_elapsed_ms+(p_values->>'duration_ms')::bigint where run_id=p_run_id;
 elsif p_action='narrative_begin' then
  if m.narrative_state<>'pending' or exists(select 1 from public.historical_jev_analysis_tasks where run_id=p_run_id and status in ('pending','running')) then return false;end if;
  update public.historical_jev_run_metrics set narrative_state='attempted',sol_narrative_calls=1 where run_id=p_run_id;update public.historical_report_runs set ai_calls=1 where id=p_run_id;
 elsif p_action='narrative_usage' then
  if m.narrative_state<>'attempted' then return false;end if;
  update public.historical_jev_run_metrics set sol_narrative_input_tokens=(p_values->>'input_tokens')::bigint,sol_narrative_output_tokens=(p_values->>'output_tokens')::bigint where run_id=p_run_id;
  update public.historical_report_runs set input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint where id=p_run_id;
 elsif p_action='narrative_finish' then
  if m.narrative_state in ('completed','fallback') then return true;end if;
  update public.historical_jev_run_metrics set narrative_state=case when (p_values->>'success')::boolean then 'completed' else 'fallback' end,narrative_result=p_values->'result',narrative_error=p_values->>'error_code',sol_narrative_elapsed_ms=coalesce((p_values->>'duration_ms')::bigint,0),usage_complete=usage_complete and coalesce((p_values->>'usage_complete')::boolean,true) where run_id=p_run_id;
 else raise exception 'V9_METRIC_ACTION_INVALID';end if;return true;
end $$;
revoke all on function public.enqueue_first_v9_report(uuid,uuid,uuid,text,uuid,jsonb),public.claim_historical_jev_tasks(uuid,uuid,integer),public.complete_historical_jev_task(uuid,uuid,uuid,jsonb),public.historical_v9_metrics_update(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_first_v9_report(uuid,uuid,uuid,text,uuid,jsonb),public.claim_historical_jev_tasks(uuid,uuid,integer),public.complete_historical_jev_task(uuid,uuid,uuid,jsonb),public.historical_v9_metrics_update(uuid,uuid,text,jsonb) to service_role;

alter table public.historical_establishment_reports add constraint historical_v9_analytical_totals check(analysis_version<>9 or (
 coalesce(consultant_report->>'version'='9',false) and coalesce(consultant_report->>'analysis_engine'='jev_hybrid',false)
 and analytical_positive_count>=0 and analytical_negative_count>=0
 and coalesce(analytical_positive_count+analytical_negative_count+(consultant_report->>'analysis_unavailable_count')::integer=sample_reviews_count,false)
 and coalesce(jsonb_typeof(consultant_report->'cross_rating_analysis')='object',false)));
