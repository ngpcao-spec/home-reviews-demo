-- Local computation only: never resets a native attempt or changes routing.
alter table public.analysis_jev_batch_runs add column draft jsonb;
alter table public.analysis_jev_batch_runs add column draft_sha256 text;
alter table public.analysis_jev_batch_runs add column draft_created_at timestamptz;
alter table public.analysis_jev_batch_runs add column envelope_prepared_at timestamptz;

create function public.jev_batch_save_draft(p_run uuid,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_body) is distinct from p_sha then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.draft is not null then return r.draft_sha256=p_sha;end if;
 if r.id is null or r.status<>'running' or not r.armed or r.stage<>'prepare_evidence' or r.envelope is not null
 or exists(select 1 from public.analysis_jev_batch_tasks where run_id=r.id and status<>'completed')
 or p_body#>>'{compact_manifest,source_snapshot_sha256}' is distinct from r.snapshot_sha256
 or (p_body->>'request_json')::jsonb->>'model' is distinct from 'gpt-6.1-sol'
 or public.jls_restaurant_hash((p_body->>'request_json')::jsonb) is distinct from p_body->>'request_sha256'
 then raise exception 'BATCH_DRAFT_NOT_READY';end if;
 update public.analysis_jev_batch_runs set draft=p_body,draft_sha256=p_sha,draft_created_at=clock_timestamp(),stage='measure_sol' where id=r.id;
 perform public.jev_batch_wake(r.id);return true;
end $$;

create or replace function public.jev_batch_save_envelope(p_run uuid,p_body jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_body) is distinct from p_sha then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.envelope is not null then return r.envelope_sha256=p_sha;end if;
 if r.id is null or r.stage not in('prepare_evidence','measure_sol') or exists(select 1 from public.analysis_jev_batch_tasks where run_id=r.id and status<>'completed')
 or r.draft is not null and p_body-'measurement' is distinct from r.draft
 or (p_body->>'request_json')::jsonb->>'model'<>'gpt-6.1-sol' or p_body->'compact_manifest' is null
 or not coalesce(p_body#>>'{measurement,version}'='jls-sol-envelope-32k-v1'
  and (p_body#>>'{measurement,guarded_input_tokens}')::int between 1 and 32768
  and (p_body#>>'{measurement,request_bytes}')::int=octet_length(p_body->>'request_json')
  and (p_body#>>'{measurement,request_bytes}')::int<=1048576
  and (p_body#>>'{measurement,output_reserved_tokens}')::int=9500,false) then raise exception 'BATCH_SOL_NOT_READY';end if;
 update public.analysis_jev_batch_runs set envelope=p_body,envelope_sha256=p_sha,envelope_prepared_at=clock_timestamp(),stage='sol' where id=r.id;
 update public.analysis_parallel_reports set statistics=p_body->'statistics' where id=r.report_id;
 perform public.jev_batch_wake(r.id);return true;
end $$;

create function public.guard_batch_draft() returns trigger language plpgsql set search_path='' as $$begin
 if old.draft is not null and row(new.draft,new.draft_sha256,new.draft_created_at) is distinct from row(old.draft,old.draft_sha256,old.draft_created_at)
 or old.envelope_prepared_at is not null and new.envelope_prepared_at is distinct from old.envelope_prepared_at
 then raise exception 'BATCH_FROZEN_DRAFT_CHANGED';end if;return new;
end $$;
create trigger batch_draft_frozen before update on public.analysis_jev_batch_runs for each row execute function public.guard_batch_draft();

-- The snapshot checkpoint releases the lease. Continue that existing current
-- preparation immediately; the minute cron is a recovery path, not a stage timer.
create function public.wake_current_jev_preparation(p_source uuid) returns bigint language plpgsql set search_path='' as $$
declare result bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.report_generation_requests q join public.historical_report_runs s on s.id=q.source_run_id
  where s.id=p_source and q.engine='jev_sol_v2' and q.jev_transport='batch_initial_v1' and q.comparison_id is null
  and s.status in('queued','running','retry') and s.locked_by is null and s.created_at+interval '24 hours'>now()
  and s.snapshot->'reviews' is not null and s.snapshot->'base' is not null) then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-historical-report-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
   (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
  body:='{}'::jsonb,timeout_milliseconds:=180000) into result;return result;
end $$;
revoke all on function public.jev_batch_save_draft(uuid,jsonb,text),public.guard_batch_draft(),public.wake_current_jev_preparation(uuid) from public,anon,authenticated;
grant execute on function public.jev_batch_save_draft(uuid,jsonb,text),public.guard_batch_draft(),public.wake_current_jev_preparation(uuid) to service_role;
