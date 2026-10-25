-- Administrative, transport-free recovery of a known saved receipt. The
-- provider receipt and request stay immutable; no run is rearmed or reserved.
create function private.compact_generated_content(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb;begin
 if jsonb_typeof(p)='object' then
  select coalesce(jsonb_object_agg(k,private.compact_generated_content(v)),'{}') into r from jsonb_each(p) x(k,v) where k not in('refs','ref','evidence_ids','evidence_id','quote','quote_sha256');return r;
 elsif jsonb_typeof(p)='array' then
  select coalesce(jsonb_agg(private.compact_generated_content(v) order by n),'[]') into r from jsonb_array_elements(p) with ordinality x(v,n);return r;
 end if;return p;
end $$;
create function private.publish_revalidated_compact_sol(p_run uuid,p_envelope_sha text,p_receipt_sha text,p_result jsonb,p_result_sha text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.analysis_jev_batch_runs;p public.analysis_parallel_reports;s public.historical_report_runs;sc public.report_corpus_scopes;
 q public.report_generation_requests;raw jsonb;compact jsonb;v_controls jsonb;c jsonb;before_report jsonb;after_report jsonb;expected_report jsonb;path text[];i integer;removed text;src jsonb;peer jsonb;recovery jsonb;trigger_name text;changed integer;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'FORBIDDEN';end if;
 if public.jls_restaurant_hash(p_result) is distinct from p_result_sha then raise exception 'RECOVERY_RESULT_CHANGED';end if;
 select * into b from public.analysis_jev_batch_runs where id=p_run;
 if b.id is null or b.current_source_run_id is null then raise exception 'RECOVERY_SOURCE_MISSING';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||b.establishment_id::text,0));
 select * into b from public.analysis_jev_batch_runs where id=p_run for update;
 select * into p from public.analysis_parallel_reports where id=b.report_id for update;
 select * into s from public.historical_report_runs where id=b.current_source_run_id for update;
 select * into q from public.report_generation_requests where source_run_id=s.id for update;
 select * into sc from public.report_corpus_scopes where source_run_id=s.id;
 if b.status='completed' and p.state='completed' and p.controls#>>'{saved_receipt_revalidation,result_sha256}'=p_result_sha then return jsonb_build_object('report_id',p.id,'already_published',true,'provider_calls',0);end if;
 if b.status is distinct from 'invalid_output' or b.error_code is distinct from 'COMPACT_SOL_UNKNOWN_OR_INCOMPATIBLE_REFERENCE' or b.stage is distinct from 'validate_sol'
 or b.armed is distinct from false or b.sol_request_count is distinct from 1 or b.sol_receipt is null or p.state is distinct from 'invalid_output' or s.status is distinct from 'failed'
 or q.comparison_id is distinct from p.id or q.jev_transport is distinct from 'batch_initial_v1' or p.current_source_run_id is distinct from s.id
 or b.envelope_sha256 is distinct from p_envelope_sha or b.sol_receipt_sha256 is distinct from p_receipt_sha
 or public.jls_restaurant_hash(b.envelope) is distinct from p_envelope_sha or public.jls_restaurant_hash(b.sol_receipt) is distinct from p_receipt_sha
 or exists(select 1 from public.analysis_jev_batch_tasks where run_id=b.id and (status<>'completed' or request_count<>1 or receipt is null)) then raise exception 'RECOVERY_RECEIPT_OR_BINDING_CHANGED';end if;
 if sc.source_run_id is null or sc.stale or sc.fingerprint is distinct from public.review_corpus_fingerprint(b.establishment_id)
 or not exists(select 1 from public.review_corpus_policy where enabled and not paused and epoch=sc.policy_epoch) then raise exception 'RECOVERY_CORPUS_CHANGED';end if;
 if b.sol_receipt->>'request_sha256' is distinct from b.envelope->>'request_sha256' or (b.sol_receipt->>'http_status')::int is distinct from 200
 or encode(extensions.digest(b.sol_receipt->>'raw_response_text','sha256'),'hex') is distinct from b.sol_receipt->>'raw_response_sha256' then raise exception 'RECOVERY_NATIVE_RECEIPT_CHANGED';end if;
 raw=(b.sol_receipt->>'raw_response_text')::jsonb;
 if raw->>'model' is distinct from 'gpt-6.1-sol' or raw->>'status' is distinct from 'completed' or p.raw_response is distinct from raw or p_result->'response' is distinct from raw then raise exception 'RECOVERY_NATIVE_RESPONSE_CHANGED';end if;
 select (x->>'text')::jsonb into strict compact from jsonb_array_elements(raw->'output') msg cross join lateral jsonb_array_elements(msg->'content') x where msg->>'type'='message' and x->>'type'='output_text';
 v_controls=p_result->'controls';before_report=p_result#>'{original_report,report}';after_report=p_result#>'{derived_report,report}';expected_report=before_report;
 if v_controls->>'technical_checks_passed' is distinct from 'true' or v_controls->>'validator_version' is distinct from 'jls-direct4-reference-links-v1'
 or v_controls->'compact_response' is distinct from compact or v_controls->'evidence' is distinct from b.envelope->'evidence'
 or v_controls->'server_statistics' is distinct from b.envelope->'statistics'
 or v_controls->'section_issues' is distinct from '[]'::jsonb
 or p_result#>>'{derived_report,statistics_sha256}' is distinct from b.envelope->>'statistics_sha256'
 or p_result#>>'{original_report,statistics_sha256}' is distinct from b.envelope->>'statistics_sha256'
 or private.compact_generated_content(before_report) is distinct from private.compact_generated_content(compact->'report')
 or private.compact_generated_content(after_report) is distinct from private.compact_generated_content(compact->'report') then raise exception 'RECOVERY_CONTENT_OR_VALIDATION_CHANGED';end if;
 if jsonb_typeof(p_result#>'{corrections,changes}') is distinct from 'array' or jsonb_array_length(p_result#>'{corrections,changes}')=0 then raise exception 'RECOVERY_DERIVATION_MISSING';end if;
 for c in select value from jsonb_array_elements(p_result#>'{corrections,changes}') loop
  if c->>'reason' is distinct from 'extra_incompatible_polarity_same_review_and_identical_text' or coalesce(c->>'path','') !~ '^(positive_aspects|negative_aspects)\[[0-9]+\]$' then raise exception 'RECOVERY_DERIVATION_UNSUPPORTED';end if;
  i=substring(c->>'path' from '\[([0-9]+)\]')::int;path=array[split_part(c->>'path','[',1),i::text,'evidence_ids'];
  if before_report#>path is distinct from c->'before' or after_report#>path is distinct from c->'after'
  or jsonb_array_length(c->'after')=0 or not((c->'after')<@(c->'before')) then raise exception 'RECOVERY_REFERENCE_CHANGED';end if;
  for removed in select x from jsonb_array_elements_text(c->'before') x where not(c->'after' ? x) loop
   select value into strict src from jsonb_array_elements(b.envelope->'evidence') where value->>'evidence_id'=removed;
   select value into peer from jsonb_array_elements(b.envelope->'evidence') where c->'after' ? (value->>'evidence_id')
    and value->>'review_id'=src->>'review_id' and value->>'category'=src->>'category' and value->>'polarity'<>src->>'polarity'
    and (value-array['evidence_id','polarity'])=(src-array['evidence_id','polarity']) limit 1;
   if peer is null then raise exception 'RECOVERY_ALIAS_NOT_IDENTICAL';end if;
  end loop;
  expected_report=jsonb_set(expected_report,path,c->'after');
 end loop;
 if expected_report is distinct from after_report then raise exception 'RECOVERY_NON_REFERENCE_CHANGE';end if;
 recovery=jsonb_build_object('method','compact-paired-alias-reconstruction-v1','revalidated_at',clock_timestamp(),'previous_state',p.state,'previous_error_code',p.error_code,'previous_controls',p.controls,'previous_generated_at',p.generated_at,'envelope_sha256',p_envelope_sha,'receipt_sha256',p_receipt_sha,'raw_response_sha256',b.sol_receipt->>'raw_response_sha256','result_sha256',p_result_sha,'generated_text_changed',false,'provider_calls',0);
 select tgname into strict trigger_name from pg_trigger where tgrelid='public.analysis_parallel_reports'::regclass and tgfoid='public.guard_parallel_history()'::regprocedure and not tgisinternal;
 -- Transaction-local administrative publication. Only the immutable-history
 -- UPDATE guard is suspended; retention/publication triggers stay in force.
 execute format('alter table public.analysis_parallel_reports disable trigger %I',trigger_name);
 update public.analysis_parallel_reports set state='completed',error_code=null,original_report=p_result->'original_report',derived_report=p_result->'derived_report',corrections=p_result->'corrections',controls=v_controls||jsonb_build_object('saved_receipt_revalidation',recovery) where id=p.id and raw_response=raw;
 get diagnostics changed=row_count;
 execute format('alter table public.analysis_parallel_reports enable trigger %I',trigger_name);
 if changed<>1 or not exists(select 1 from public.analysis_parallel_reports where id=p.id and state='completed') then raise exception 'RECOVERY_PUBLICATION_FAILED';end if;
 update public.analysis_jev_batch_runs set status='completed',error_code=null where id=b.id and sol_request_count=1 and sol_receipt_sha256=p_receipt_sha;
 update public.historical_report_runs set status='completed',error_code=null,last_error=null,locked_by=null,lease_until=null,updated_at=now() where id=s.id;
 return jsonb_build_object('report_id',p.id,'source_run_id',s.id,'batch_run_id',b.id,'provider_calls',0,'revalidated_at',recovery->'revalidated_at');
end $$;
revoke all on function private.compact_generated_content(jsonb),private.publish_revalidated_compact_sol(uuid,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.publish_revalidated_compact_sol(uuid,text,text,jsonb,text) to service_role;
