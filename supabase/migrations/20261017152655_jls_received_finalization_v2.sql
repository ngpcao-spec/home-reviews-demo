-- No data/run/consent is seeded. Preserve all historical terminal rows.
create or replace function public.jls_restaurant_state_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'JLS_HISTORY_IMMUTABLE';end if;
 if tg_table_name='analysis_jls_restaurant_runs' then
  if old.status not in('queued','running') then
   if (to_jsonb(new)-array['worker','lease_until']) is distinct from (to_jsonb(old)-array['worker','lease_until']) then raise exception 'JLS_RUN_IMMUTABLE';end if;
  elsif (to_jsonb(new)-array['status','stage','error_code','worker','lease_until']) is distinct from (to_jsonb(old)-array['status','stage','error_code','worker','lease_until']) then raise exception 'JLS_RUN_IMMUTABLE';end if;
 else
  -- A consumed Sol receipt can advance to a terminal validation state only.
  -- The snapshot V2 protocol uses the same receipt/finish RPCs as Sol-ready V1.
  if old.status='received' and old.phase='sol' and exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id where r.id=old.run_id and p.body->>'version' in('jls-restaurant-sol-ready-vi-v1','jls-historical-snapshot-v2-vi-v1')) then
   if new.status not in('completed','needs_review','invalid_output','billing_uncertain','blocked') or new.request_count is distinct from 1
   or old.request_count is distinct from 1
   or (to_jsonb(new)-array['status','completed_at','error_code']) is distinct from (to_jsonb(old)-array['status','completed_at','error_code'])
   then raise exception 'JLS_NO_RETRY';end if;return new;
  end if;
  if old.status not in('pending','running') or new.request_count<old.request_count
  or (to_jsonb(new)-array['status','request_count','worker','dispatched_at','completed_at','error_code','cache_id']) is distinct from (to_jsonb(old)-array['status','request_count','worker','dispatched_at','completed_at','error_code','cache_id'])
  or old.request_count=1 and new.request_count<>1 then raise exception 'JLS_NO_RETRY';end if;
 end if;return new;
end $$;

create or replace function public.finish_jls_sol_ready(p_operation uuid,p_worker text,p_status text,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.analysis_jls_sol_ready_operations;run_status text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for update;
 if o.id is null then return false;end if;
 if o.result is not null then return o.result_sha256=p_sha and o.result=p_body and o.status=p_status;end if;
 if p_worker is null or o.worker is distinct from p_worker or o.status is distinct from 'validating' or o.phase is distinct from 'validate_sol'
 or o.request_count is distinct from 1 or o.receipt is null or o.lease_until is null or o.lease_until<=now()
 or p_status is null or p_status not in('completed','needs_review','invalid_output','billing_uncertain') or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->>'receipt_sha256' is distinct from o.receipt_sha256 or p_body->>'raw_response_sha256' is distinct from o.receipt->>'raw_response_sha256'
 then return false;end if;
 if o.mode='paid' then
  -- Never reopen a terminal historical run, even with a retained receipt.
  perform 1 from public.analysis_jls_restaurant_runs where id=o.run_id and status in('queued','running') and stage='validate_sol' for update;
  if not found then return false;end if;
  perform 1 from public.analysis_jls_restaurant_tasks where id=o.task_id and run_id=o.run_id and phase='sol' and status='received' and request_count=1 for update;
  if not found then return false;end if;
  if not public.save_jls_restaurant_artifact(o.run_id,p_worker,'task:'||o.task_id,p_body,p_sha) then return false;end if;
  update public.analysis_jls_restaurant_tasks set status=p_status,error_code=p_body->>'error_code',completed_at=now() where id=o.task_id;
  run_status=case when p_status='invalid_output' then 'blocked' else p_status end;
  update public.analysis_jls_restaurant_runs set status=run_status,error_code=p_body->>'error_code',worker=null,lease_until=null where id=o.run_id;
 end if;
 update public.analysis_jls_sol_ready_operations set result=p_body,result_sha256=p_sha,status=p_status,
 worker=null,lease_until=null,completed_at=now(),error_code=p_body->>'error_code' where id=o.id;return true;
end $$;

-- Free explicit revalidation only. It cannot reserve or dispatch a provider
-- call, mutate a run, or create a consent. Reuses the immutable organization-
-- scoped preparation store and its unique(protocol_id,kind) transaction guard.
create function public.save_jls_saved_response_validation_v2(p_operation uuid,p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' set jit='off' as $$
declare o public.analysis_jls_sol_ready_operations;a public.analysis_jls_sol_ready_artifacts;
 p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;v public.analysis_jls_snapshot_preparations;
 result jsonb=p_body->'result';native jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for share;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 select * into p from public.analysis_jls_restaurant_protocols where id=o.protocol_id;
 select * into r from public.analysis_jls_restaurant_runs where id=o.run_id;
 select * into v from public.analysis_jls_snapshot_preparations where id=(p_body->>'source_original_validation_id')::uuid;
 if not coalesce(o.mode='paid' and o.status='blocked' and r.status='blocked' and o.phase='validate_sol' and o.request_count=1
 and o.organization_id=p.organization_id and r.organization_id=p.organization_id and a.organization_id=p.organization_id and v.organization_id=p.organization_id
 and a.source_run_id=r.id and a.source_protocol_id=p.id and v.protocol_id=p.id
 and p.sha256=public.jls_restaurant_hash(p.body) and a.sha256=public.jls_restaurant_hash(a.body)
 and p_body->>'version'='jls-saved-response-validation-v2'
 and p_body->>'source_operation_id'=o.id::text and p_body->>'source_run_id'=r.id::text
 and p_body->>'source_operation_historical_status'=o.status
 and p_body->>'source_original_validation_sha256'=v.sha256 and v.sha256=public.jls_restaurant_hash(v.body)
 and p_body->>'source_protocol_sha256'=p.sha256 and p_body->>'source_artifact_sha256'=a.sha256
 and p_body->>'source_request_sha256'=a.body->>'request_sha256'
 and p_body->>'source_receipt_sha256'=o.receipt_sha256 and o.receipt_sha256=public.jls_restaurant_hash(o.receipt)
 and p_body->>'source_raw_response_sha256'=o.receipt->>'raw_response_sha256'
 and o.receipt->>'raw_response_sha256'=encode(extensions.digest(o.receipt->>'raw_response_text','sha256'),'hex')
 and p_body->>'provider_calls'='0' and p_body->>'human_validated'='false' and p_body->>'production_enabled'='false'
 and p_body->>'new_paid_run'='false' and p_body->>'new_consent'='false'
 and p_body->>'finalization_version'='jls-received-finalization-v2'
 and p_body->>'validator_code_provenance' ~ '^[a-f0-9]{40}$'
 and p_sha=public.jls_restaurant_hash(p_body) and p_body->>'result_sha256'=public.jls_restaurant_hash(result)
 and result->>'receipt_sha256'=o.receipt_sha256 and result->>'raw_response_text'=o.receipt->>'raw_response_text'
 and result->>'raw_response_sha256'=o.receipt->>'raw_response_sha256'
 and result->>'request_sha256'=a.body->>'request_sha256'
 and p_body->>'validation_status' in('completed','needs_review','invalid_output','billing_uncertain'),false)
 then raise exception 'JLS_SAVED_RESPONSE_CHANGED';end if;
 native=(o.receipt->>'raw_response_text')::jsonb;
 if result->'response' is distinct from native or result->>'response_sha256' is distinct from public.jls_restaurant_hash(native)
 or result->'usage' is distinct from native->'usage' or result->>'served_model' is distinct from native->>'model'
 or not public.check_jls_sol_ready_sources(a.body) then raise exception 'JLS_SAVED_RESPONSE_SOURCE_CHANGED';end if;
 return public.save_jls_snapshot_preparation(p.id,'saved_sol_response_validation_v2',p_body,p_sha);
end $$;
revoke all on function public.save_jls_saved_response_validation_v2(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_jls_saved_response_validation_v2(uuid,jsonb,text) to service_role;
