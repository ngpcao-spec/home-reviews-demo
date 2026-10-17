-- Preserve exact raw receipt SHA while comparing parsed JSON values. JSONB
-- retains 1.0 whereas JSON.parse/JSON.stringify normalizes it to 1. Equality
-- with the source native value plus the unchanged raw SHA binds both forms.
create or replace function public.save_jls_saved_response_validation_v2(p_operation uuid,p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' set jit='off' as $$
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
 and v.kind='saved_sol_response_validation_v1' and v.body->>'source_run_id'=r.id::text and v.body->>'source_operation_id'=o.id::text
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
 if result->'response' is distinct from native or result->>'response_sha256' is distinct from public.jls_restaurant_hash(result->'response')
 or result->'usage' is distinct from native->'usage' or result->>'served_model' is distinct from native->>'model'
 or not public.check_jls_sol_ready_sources(a.body) then raise exception 'JLS_SAVED_RESPONSE_SOURCE_CHANGED';end if;
 return public.save_jls_snapshot_preparation(p.id,'saved_sol_response_validation_v2',p_body,p_sha);
end $$;
