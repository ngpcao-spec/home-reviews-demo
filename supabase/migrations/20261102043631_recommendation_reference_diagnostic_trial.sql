begin;
set local lock_timeout='2s';
-- Extend only the permitted protocol tuples. Never upgrade an existing grant.
alter table private.recommendation_corrected_diagnostic_trials
 drop constraint recommendation_corrected_diagnostic_trial_target_contract_check,
 drop constraint recommendation_corrected_diagnostic_trials_target_cache_check,
 add constraint recommendation_diagnostic_protocol_pair check (
  (target_contract='recommendation-criteria-coverage-v2' and target_cache='recommendation-ai-open-criteria-safety-v7') or
  (target_contract='recommendation-criteria-coverage-v3' and target_cache='recommendation-ai-open-criteria-safety-v8')
 );

create function public.authorize_reference_recommendation_diagnostic_v1(p_parent_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a private.recommendation_ai_attempts; r private.recommendation_ai_attempts; p private.recommendation_ai_attempts;
 previous private.recommendation_corrected_diagnostic_trials; g private.recommendation_corrected_diagnostic_trials;
begin
 select * into a from private.recommendation_ai_attempts where id=p_parent_id for update;
 if a.id is null or a.state<>'invalid_output' or a.completed_at is null or a.error_code is distinct from 'INVALID_REFERENCE'
  or a.metrics->>'provider_request_id' is null or coalesce((a.metrics->>'output_tokens')::bigint,0)<=0
  or a.metrics->>'configuration_version' is distinct from 'recommendation-ai-open-criteria-safety-v7'
 then raise exception 'DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED';end if;
 if not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=a.user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-ai:'||a.organization_id::text,0)) then raise exception 'DIAGNOSTIC_AUTHORIZATION_BUSY';end if;
 select * into g from private.recommendation_corrected_diagnostic_trials where parent_attempt_id=a.id;
 if g.id is not null then return g.id;end if; -- Never reset consumption or expiry.
 -- Only a definitively completed V7 child can receive this explicitly authorized
 -- V8 trial. A V8 child cannot form an automatic or operator replay chain here.
 select * into previous from private.recommendation_corrected_diagnostic_trials where child_attempt_id=a.id;
 if previous.id is null or previous.consumed_at is null or previous.target_contract<>'recommendation-criteria-coverage-v2'
  or previous.target_cache<>'recommendation-ai-open-criteria-safety-v7'
  or previous.request_sha256 is distinct from a.request_sha256
 then raise exception 'DIAGNOSTIC_PARENT_LINK_UNPROVEN';end if;
 select * into r from private.recommendation_ai_attempts where id=previous.root_attempt_id;
 select * into p from private.recommendation_ai_attempts where id=previous.parent_attempt_id;
 if r.id is null or p.id is null or md5(to_jsonb(r)::text) is distinct from previous.root_row_md5
  or md5(to_jsonb(p)::text) is distinct from previous.parent_row_md5
  or r.organization_id<>a.organization_id or r.user_id<>a.user_id or p.organization_id<>a.organization_id or p.user_id<>a.user_id
  or r.cache_key is distinct from previous.legacy_cache_key or r.request_sha256 is distinct from previous.legacy_request_sha256
 then raise exception 'DIAGNOSTIC_PARENT_CHANGED';end if;
 if exists(select 1 from private.recommendation_corrected_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp())
  or exists(select 1 from private.recommendation_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp())
 then raise exception 'DIAGNOSTIC_AUTHORIZATION_ALREADY_ACTIVE';end if;
 insert into private.recommendation_corrected_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5,root_attempt_id,root_row_md5,
  legacy_cache_key,legacy_request_sha256,target_contract,target_cache)
 values(a.id,a.organization_id,a.user_id,md5(to_jsonb(a)::text),r.id,md5(to_jsonb(r)::text),previous.legacy_cache_key,previous.legacy_request_sha256,
  'recommendation-criteria-coverage-v3','recommendation-ai-open-criteria-safety-v8') returning id into g.id;
 return g.id;
end $$;
revoke all on function public.authorize_reference_recommendation_diagnostic_v1(uuid) from public,anon,authenticated;
grant execute on function public.authorize_reference_recommendation_diagnostic_v1(uuid) to service_role;
comment on function public.authorize_reference_recommendation_diagnostic_v1(uuid) is 'Operator-only explicit one-use V3/V8 grant for a proven completed V7 reference rejection. Existing receipt/grant hashes and original request/access/data identity preserved; expires after 24 hours without reset. No provider call or reservation.';
commit;
