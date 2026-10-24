-- Opt-in experiment only. Does not alter report_pipeline_settings or the production worker.
create table public.analysis_jev_batch_runs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),baseline_report_id uuid not null references public.analysis_parallel_reports(id),
 report_id uuid not null unique references public.analysis_parallel_reports(id),configuration_version text not null default 'jev-multi-review-initial-v1' check(configuration_version='jev-multi-review-initial-v1'),
 snapshot jsonb not null,snapshot_sha256 text not null,template jsonb not null,manifest_sha256 text not null,
 source_manifest_sha256 text not null,authorization_evidence text not null,armed boolean not null default false,expires_at timestamptz not null,
 max_new_jev_calls int not null default 0 check(max_new_jev_calls>=0),
 status text not null default 'running',stage text not null default 'jev',error_code text,
 sol_request_count int not null default 0 check(sol_request_count between 0 and 1),sol_worker text,sol_lease_until timestamptz,
 envelope jsonb,envelope_sha256 text,sol_receipt jsonb,sol_receipt_sha256 text,
 created_at timestamptz not null default now(),completed_at timestamptz,
 unique(baseline_report_id,configuration_version,source_manifest_sha256),
 check(snapshot_sha256=public.jls_restaurant_hash(snapshot))
);
create table public.analysis_jev_batch_tasks(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.analysis_jev_batch_runs(id),
 organization_id uuid not null references public.organizations(id),number int not null check(number>0),reviews int not null check(reviews>0),
 request_wire text not null,request_sha256 text not null,mapping jsonb not null,preflight jsonb not null,
 status text not null default 'pending' check(status in('pending','reserved','received','completed','invalid_output','unknown')),
 request_count int not null default 0 check(request_count between 0 and 1),worker text,lease_until timestamptz,
 receipt jsonb,receipt_sha256 text,projection jsonb,projection_sha256 text,error_code text,
 historical_source jsonb,reserved_at timestamptz,completed_at timestamptz,
 unique(run_id,number),unique(run_id,request_sha256),
 check(request_sha256=encode(extensions.digest(request_wire,'sha256'),'hex')),
 check(receipt is null or receipt_sha256=public.jls_restaurant_hash(receipt)),
 check(projection is null or projection_sha256=public.jls_restaurant_hash(projection))
);
create index jev_batch_pending on public.analysis_jev_batch_tasks(run_id,status,number);
alter table public.analysis_jev_batch_runs enable row level security;
alter table public.analysis_jev_batch_tasks enable row level security;
revoke all on public.analysis_jev_batch_runs,public.analysis_jev_batch_tasks from public,anon,authenticated;
grant select on public.analysis_jev_batch_runs,public.analysis_jev_batch_tasks to authenticated;
grant all on public.analysis_jev_batch_runs,public.analysis_jev_batch_tasks to service_role;
create policy batch_run_member_read on public.analysis_jev_batch_runs for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_batch_runs.organization_id and m.user_id=(select auth.uid())));
create policy batch_task_member_read on public.analysis_jev_batch_tasks for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_batch_tasks.organization_id and m.user_id=(select auth.uid())));
-- A batch experiment has a baseline FK above; it is never a new production source run.
alter table public.analysis_parallel_reports drop constraint parallel_source_required;
alter table public.analysis_parallel_reports add constraint parallel_source_required check(reference_report_id is not null or current_source_run_id is not null or configuration_version='jev-multi-review-initial-v1') not valid;

create function public.jev_batch_create_saved(p_baseline uuid,p_authorization text) returns uuid language plpgsql set search_path='' as $$
declare b public.analysis_parallel_reports;p public.analysis_jls_restaurant_protocols;r uuid;v uuid;template jsonb;source_manifest text;manifest text;begin
 if current_user<>'service_role' or length(p_authorization)<40 then raise exception 'FORBIDDEN';end if;
 select * into b from public.analysis_parallel_reports where id=p_baseline and state='completed' for share;
 select * into p from public.analysis_jls_restaurant_protocols where id=b.protocol_id;
 select manifest_sha256 into source_manifest from private.nha_trang_jev_batch_experiment where source_run_id=b.run_id;
 if b.id is null or p.id is null or source_manifest is null then raise exception 'BATCH_SAVED_SOURCE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_baseline::text||source_manifest||'jev-multi-review-initial-v1',0));
 select id into r from public.analysis_jev_batch_runs where baseline_report_id=b.id and source_manifest_sha256=source_manifest;
 if r is not null then return r;end if;
 if (select count(*) from private.nha_trang_jev_batch_specs)<>11 or (select sum(reviews) from private.nha_trang_jev_batch_specs)<>527
 or (select count(*) from private.nha_trang_jev_batch_receipts)<>11 then raise exception 'BATCH_SAVED_CORPUS_INCOMPLETE';end if;
 select body into template from public.analysis_jls_restaurant_artifacts where run_id=b.run_id and kind='parallel_sol_envelope_v1';
 if template is null or template->'compact_wire' is null then raise exception 'BATCH_COMPACT_TEMPLATE_REQUIRED';end if;
 select public.jls_restaurant_hash(jsonb_agg(jsonb_build_object('number',s.batch,'request_sha256',s.request_sha256,'mapping',s.mapping,'receipt_sha256',a.sha256) order by s.batch)) into manifest
 from private.nha_trang_jev_batch_specs s join private.nha_trang_jev_batch_receipts a using(batch);
 v=gen_random_uuid();
 insert into public.analysis_parallel_reports(id,organization_id,establishment_id,reference_generation_id,language,configuration_version,corpus_sha256,source_report,source_reviews,state,statistics)
 values(v,b.organization_id,b.establishment_id,b.reference_generation_id,b.language,'jev-multi-review-initial-v1',b.corpus_sha256,b.source_report,b.source_reviews,'generating',
 jsonb_build_object('scope',jsonb_set(b.statistics->'scope','{analysed_text_reviews}','0')));
 insert into public.analysis_jev_batch_runs(organization_id,establishment_id,baseline_report_id,report_id,snapshot,snapshot_sha256,template,manifest_sha256,source_manifest_sha256,authorization_evidence,expires_at)
 values(b.organization_id,b.establishment_id,b.id,v,p.body->'source_snapshot',p.body->>'source_snapshot_sha256',template,manifest,source_manifest,p_authorization,now()+interval '2 hours') returning id into r;
 insert into public.analysis_jev_batch_tasks(run_id,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight,status,receipt,receipt_sha256,historical_source)
 select r,b.organization_id,s.batch,s.reviews,s.request_wire,s.request_sha256,s.mapping,s.preflight,'received',a.body,a.sha256,
 jsonb_build_object('table','private.nha_trang_jev_batch_receipts','batch',s.batch,'receipt_sha256',a.sha256,'new_provider_call',false)
 from private.nha_trang_jev_batch_specs s join private.nha_trang_jev_batch_receipts a using(batch) order by s.batch;
 return r;
end $$;

create function public.jev_batch_wake(p_run uuid) returns bigint language plpgsql set search_path='' as $$
declare result bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.analysis_jev_batch_runs where id=p_run and armed and expires_at>now() and status='running') then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/jev-batch-experiment',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:=jsonb_build_object('action','step','run_id',p_run),timeout_milliseconds:=10000) into result;
 return result;
end $$;
create function public.jev_batch_claim(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;t public.analysis_jev_batch_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if not r.armed or r.status<>'running' or r.expires_at<=now() then return null;end if;
 update public.analysis_jev_batch_tasks set status='unknown',error_code='BATCH_OUTCOME_UNKNOWN_NO_RETRY' where run_id=p_run and status='reserved' and lease_until<now();
 select * into t from public.analysis_jev_batch_tasks where run_id=p_run and (status='pending' and request_count=0 or status='received' and (lease_until is null or lease_until<now())) order by number for update skip locked limit 1;
 if t.id is null then
  if exists(select 1 from public.analysis_jev_batch_tasks where run_id=p_run and status in('unknown','invalid_output')) then
   update public.analysis_jev_batch_runs set status='blocked',error_code='BATCH_INCOMPLETE_NO_SOL',armed=false where id=p_run;
   update public.analysis_parallel_reports set state='blocked',error_code='BATCH_INCOMPLETE_NO_SOL' where id=r.report_id;
  end if;return null;
 end if;
 if t.status='pending' then
  if (select count(*) from public.analysis_jev_batch_tasks where run_id=p_run and request_count=1)>=r.max_new_jev_calls then raise exception 'BATCH_NEW_JEV_NOT_AUTHORIZED';end if;
  update public.analysis_jev_batch_tasks set status='reserved',request_count=1,reserved_at=now(),lease_until=now()+interval '150 seconds',worker=p_worker where id=t.id returning * into t;
 else update public.analysis_jev_batch_tasks set worker=p_worker,lease_until=now()+interval '150 seconds' where id=t.id returning * into t;
 end if;return to_jsonb(t);
end $$;
create function public.jev_batch_receive(p_task uuid,p_worker text,p_receipt jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare t public.analysis_jev_batch_tasks;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_receipt)<>p_sha then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jev_batch_tasks where id=p_task for update;
 if t.receipt is not null then return t.receipt_sha256=p_sha;end if;
 if t.status<>'reserved' or t.worker is distinct from p_worker or t.request_count<>1 then return false;end if;
 update public.analysis_jev_batch_tasks set receipt=p_receipt,receipt_sha256=p_sha,status='received',lease_until=null where id=t.id;
 perform public.jev_batch_wake(t.run_id);return true;
end $$;
create function public.jev_batch_save_projection(p_task uuid,p_worker text,p_body jsonb,p_sha text,p_error text default null) returns boolean language plpgsql set search_path='' as $$
declare t public.analysis_jev_batch_tasks;r public.analysis_jev_batch_runs;done int;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_body)<>p_sha then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jev_batch_tasks where id=p_task for update;
 if t.status='completed' then return t.projection_sha256=p_sha;end if;
 if t.status<>'received' or t.worker is distinct from p_worker then return false;end if;
 select * into r from public.analysis_jev_batch_runs where id=t.run_id for update;
 update public.analysis_jev_batch_tasks set projection=p_body,projection_sha256=p_sha,status=case when p_error is null then 'completed' else 'invalid_output' end,error_code=p_error,completed_at=now(),lease_until=null where id=t.id;
 select coalesce(sum(reviews),0) into done from public.analysis_jev_batch_tasks where run_id=r.id and status='completed';
 update public.analysis_parallel_reports set statistics=jsonb_set(statistics,'{scope,analysed_text_reviews}',to_jsonb(done)) where id=r.report_id;
 if not exists(select 1 from public.analysis_jev_batch_tasks where run_id=r.id and status<>'completed') then update public.analysis_jev_batch_runs set stage='prepare_evidence' where id=r.id;end if;
 perform public.jev_batch_wake(r.id);return true;
end $$;
create function public.jev_batch_save_envelope(p_run uuid,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_body)<>p_sha then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.envelope is not null then return r.envelope_sha256=p_sha;end if;
 if r.stage<>'prepare_evidence' or exists(select 1 from public.analysis_jev_batch_tasks where run_id=r.id and status<>'completed')
 or (p_body->>'request_json')::jsonb->>'model'<>'gpt-6.1-sol' or p_body->'compact_manifest' is null
 or (p_body->'measurement'->>'guarded_input_tokens')::int>32768 then raise exception 'BATCH_SOL_NOT_READY';end if;
 update public.analysis_jev_batch_runs set envelope=p_body,envelope_sha256=p_sha,stage='sol' where id=r.id;
 update public.analysis_parallel_reports set statistics=p_body->'statistics' where id=r.report_id;
 perform public.jev_batch_wake(r.id);return true;
end $$;
create function public.jev_batch_claim_sol(p_run uuid,p_worker text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if not r.armed or r.status<>'running' or r.expires_at<=now() or r.stage<>'sol' then return false;end if;
 if r.sol_request_count=1 then
  if r.sol_receipt is null and r.sol_lease_until<now() then
   update public.analysis_jev_batch_runs set status='billing_uncertain',error_code='SOL_OUTCOME_UNKNOWN_NO_RETRY',armed=false where id=r.id;
   update public.analysis_parallel_reports set state='billing_uncertain',error_code='SOL_OUTCOME_UNKNOWN_NO_RETRY' where id=r.report_id;
  end if;return false;
 end if;
 if r.envelope is null or exists(select 1 from public.analysis_jev_batch_tasks where run_id=r.id and status<>'completed') then raise exception 'BATCH_SOL_NOT_READY';end if;
 update public.analysis_jev_batch_runs set sol_request_count=1,sol_worker=p_worker,sol_lease_until=now()+interval '150 seconds' where id=r.id;return true;
end $$;
create function public.jev_batch_receive_sol(p_run uuid,p_worker text,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_body)<>p_sha then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.sol_receipt is not null then return r.sol_receipt_sha256=p_sha;end if;
 if r.sol_request_count<>1 or r.sol_worker is distinct from p_worker then return false;end if;
 update public.analysis_jev_batch_runs set sol_receipt=p_body,sol_receipt_sha256=p_sha,stage='validate_sol' where id=r.id;
 perform public.jev_batch_wake(r.id);return true;
end $$;
create function public.jev_batch_finish(p_run uuid,p_status text,p_result jsonb,p_usage jsonb,p_error text default null) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' or p_status not in('completed','needs_review','invalid_output','billing_uncertain') then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.status<>'running' then return true;end if;
 if r.stage<>'validate_sol' or r.sol_receipt is null or r.sol_request_count<>1 then return false;end if;
 update public.analysis_parallel_reports set state=p_status,error_code=p_error,generated_at=now(),raw_response=p_result->'response',original_report=p_result->'original_report',derived_report=p_result->'derived_report',
 controls=p_result->'controls',corrections=p_result->'corrections',usage=p_usage where id=r.report_id and configuration_version='jev-multi-review-initial-v1' and current_source_run_id is null;
 update public.analysis_jev_batch_runs set status=p_status,error_code=p_error,completed_at=now(),armed=false where id=r.id;return true;
end $$;
-- No readable secret or arbitrary URL/body arguments are exposed by the wake RPC.
do $$declare f record;begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'jev_batch_%' loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

