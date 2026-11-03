begin;
set local lock_timeout='2s';
lock table private.recommendation_corrected_diagnostic_trials in access exclusive mode nowait;
-- Operator-grant compatibility only. No attempt, grant or expiry is created/reset.
alter table private.recommendation_corrected_diagnostic_trials
 drop constraint recommendation_diagnostic_protocol_pair,
 add constraint recommendation_diagnostic_protocol_pair check (
  (target_contract='recommendation-criteria-coverage-v2' and target_validator='recommendation-criteria-validator-v2' and target_cache='recommendation-ai-open-criteria-safety-v7') or
  (target_contract='recommendation-criteria-coverage-v3' and target_validator='recommendation-criteria-validator-v2' and target_cache='recommendation-ai-open-criteria-safety-v8') or
  (target_contract='recommendation-criteria-coverage-v3' and target_validator='recommendation-criteria-validator-v3' and target_cache='recommendation-ai-open-criteria-safety-v9') or
  (target_contract='recommendation-direct-choice-v1' and target_validator='recommendation-structural-validator-v1' and target_cache='recommendation-ai-direct-choice-v10') or
  (target_contract='recommendation-direct-choice-v1' and target_validator='recommendation-structural-validator-v1' and target_cache='recommendation-ai-light-v11')
 );

-- Only an explicitly inserted light-v11 grant can use a successful direct-v10 parent.
-- Existing grants, receipts, expiry times and old rejected-parent paths are untouched.
CREATE OR REPLACE FUNCTION public.reserve_corrected_recommendation_diagnostic_v1(p_organization_id uuid, p_user_id uuid, p_cache_key text, p_request_sha256 text, p_legacy_cache_key text, p_legacy_request_sha256 text, p_trace jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g private.recommendation_corrected_diagnostic_trials; a private.recommendation_ai_attempts; r private.recommendation_ai_attempts; child private.recommendation_ai_attempts; d uuid;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-ai:'||p_organization_id::text,0)) then return jsonb_build_object('id',null,'owned',false,'state','dispatched','selection',null,'metrics',null);end if;
 select * into g from private.recommendation_corrected_diagnostic_trials t where t.organization_id=p_organization_id and t.user_id=p_user_id
 and (t.child_attempt_id is null or (t.legacy_cache_key=p_legacy_cache_key and t.legacy_request_sha256=p_legacy_request_sha256) or (t.cache_key=p_cache_key and t.request_sha256=p_request_sha256)
  or exists(select 1 from private.recommendation_ai_attempts pending where pending.id=t.child_attempt_id and pending.state in('dispatched','unknown')))
 order by t.authorized_at desc limit 1 for update;
 if g.id is null then return public.reserve_recommendation_with_diagnostic_v1(p_organization_id,p_user_id,p_cache_key,p_request_sha256,p_trace);end if;
 select * into a from private.recommendation_ai_attempts where id=g.parent_attempt_id;
 select * into r from private.recommendation_ai_attempts where id=g.root_attempt_id;
 if (case when g.target_cache='recommendation-ai-light-v11' then
   a.state is distinct from 'succeeded' or a.metrics->>'configuration_version' is distinct from 'recommendation-ai-direct-choice-v10'
    or a.error_code is not null or a.metrics->>'provider_request_id' is null or coalesce((a.metrics->>'output_tokens')::bigint,0)<=0
   else a.state is distinct from 'invalid_output' end)
  or a.completed_at is null or md5(to_jsonb(a)::text) is distinct from g.parent_row_md5
  or md5(to_jsonb(r)::text) is distinct from g.root_row_md5 then raise exception 'DIAGNOSTIC_PARENT_CHANGED';end if;
 if g.legacy_cache_key is distinct from p_legacy_cache_key or g.legacy_request_sha256 is distinct from p_legacy_request_sha256 then raise exception 'DIAGNOSTIC_REQUEST_CHANGED';end if;
 if p_trace->>'version' is distinct from 'recommendation-diagnostic-v2' or p_trace->>'validator_version' is distinct from g.target_validator
  or p_trace->>'contract_version' is distinct from g.target_contract or p_trace->>'cache_version' is distinct from g.target_cache
  or coalesce((p_trace->>'server_version')::integer,0)<10 then raise exception 'DIAGNOSTIC_RUNTIME_INCOMPATIBLE';end if;
 if g.target_cache='recommendation-ai-light-v11' and coalesce((p_trace->>'server_version')::integer,0)<15 then raise exception 'DIAGNOSTIC_RUNTIME_INCOMPATIBLE';end if;
 if g.child_attempt_id is not null then
  if g.cache_key is distinct from p_cache_key or g.request_sha256 is distinct from p_request_sha256 then raise exception 'DIAGNOSTIC_REQUEST_CHANGED';end if;
  select * into child from private.recommendation_ai_attempts where id=g.child_attempt_id;
  return jsonb_build_object('id',child.id,'owned',false,'state',case when child.state='dispatched' and child.created_at<clock_timestamp()-interval '2 minutes' then 'unknown' else child.state end,'selection',child.selection,'metrics',child.metrics);
 end if;
 if g.expires_at<=clock_timestamp() then raise exception 'DIAGNOSTIC_AUTHORIZATION_EXPIRED';end if;
 if exists(select 1 from private.recommendation_ai_attempts where organization_id=p_organization_id and cache_key=p_cache_key) then raise exception 'DIAGNOSTIC_COMPATIBLE_ATTEMPT_ALREADY_EXISTS';end if;
 if exists(select 1 from private.recommendation_ai_attempts where organization_id=p_organization_id and state='dispatched' and created_at>=clock_timestamp()-interval '2 minutes') then return jsonb_build_object('id',null,'owned',false,'state','dispatched','selection',null,'metrics',null);end if;
 -- No reset, nonce, reformulation or synthetic version. A separately authorized,
 -- immutable receipt namespace accounts for this one corrected-protocol trial.
 insert into private.recommendation_ai_attempts(organization_id,user_id,cache_key,request_sha256)
 values(p_organization_id,p_user_id,md5('corrected-diagnostic:'||g.id::text)||md5('parent:'||a.id::text),p_request_sha256) returning * into child;
 update private.recommendation_corrected_diagnostic_trials set child_attempt_id=child.id,consumed_at=clock_timestamp(),cache_key=p_cache_key,request_sha256=p_request_sha256 where id=g.id;
 d:=public.record_recommendation_diagnostic_v1(p_organization_id,p_user_id,child.id,p_trace||jsonb_build_object('attempt_id',child.id,'stage','diagnostic_reserved','origin','pending'));
 if d is null then raise exception 'DIAGNOSTIC_STORE_UNAVAILABLE';end if;
 return jsonb_build_object('id',child.id,'owned',true,'state',child.state,'selection',null,'metrics',null);
end $function$
;
commit;
