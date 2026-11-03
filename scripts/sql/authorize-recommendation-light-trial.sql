-- Operator-only statement, run in an explicit transaction with LOCAL settings.
-- Never exposed as a callable RPC. Contains no user text or report excerpts.
do $$
declare
 a private.recommendation_ai_attempts;
 r private.recommendation_ai_attempts;
 p private.recommendation_ai_attempts;
 previous private.recommendation_corrected_diagnostic_trials;
 g private.recommendation_corrected_diagnostic_trials;
 stamp timestamptz;
begin
 select * into a from private.recommendation_ai_attempts where id=current_setting('home.trial_parent')::uuid for update nowait;
 if a.id is null or a.organization_id<>current_setting('home.trial_organization')::uuid or a.user_id<>current_setting('home.trial_user')::uuid
  or a.state is distinct from 'succeeded' or a.completed_at is distinct from current_setting('home.trial_completed_at')::timestamptz
  or a.error_code is not null or a.metrics->>'configuration_version' is distinct from 'recommendation-ai-direct-choice-v10'
  or nullif(a.metrics->>'provider_request_id','') is null or coalesce((a.metrics->>'output_tokens')::bigint,0)<=0
  or md5(to_jsonb(a)::text) is distinct from current_setting('home.trial_parent_hash') then
  raise exception 'DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_SUCCEEDED';
 end if;
 if not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=a.user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-ai:'||a.organization_id::text,0)) then raise exception 'DIAGNOSTIC_AUTHORIZATION_BUSY';end if;
 select * into g from private.recommendation_corrected_diagnostic_trials where parent_attempt_id=a.id for update nowait;
 if g.id is not null then
  if g.target_contract<>'recommendation-direct-choice-v1' or g.target_validator<>'recommendation-structural-validator-v1' or g.target_cache<>'recommendation-ai-light-v11'
   or g.parent_row_md5<>md5(to_jsonb(a)::text) then raise exception 'DIAGNOSTIC_AUTHORIZATION_CONFLICT';end if;
  return; -- Idempotence never changes expiry, consumption or the linked child.
 end if;
 if exists(select 1 from private.recommendation_ai_attempts where organization_id=a.organization_id and user_id=a.user_id and created_at>a.created_at) then raise exception 'DIAGNOSTIC_PARENT_NOT_LATEST';end if;
 select * into previous from private.recommendation_corrected_diagnostic_trials where child_attempt_id=a.id;
 if previous.id is null or previous.consumed_at is null or previous.target_contract<>'recommendation-direct-choice-v1'
  or previous.target_validator<>'recommendation-structural-validator-v1' or previous.target_cache<>'recommendation-ai-direct-choice-v10'
  or previous.request_sha256 is distinct from a.request_sha256 then raise exception 'DIAGNOSTIC_PARENT_LINK_UNPROVEN';end if;
 select * into r from private.recommendation_ai_attempts where id=previous.root_attempt_id;
 select * into p from private.recommendation_ai_attempts where id=previous.parent_attempt_id;
 if r.id is null or p.id is null or md5(to_jsonb(r)::text) is distinct from previous.root_row_md5 or md5(to_jsonb(p)::text) is distinct from previous.parent_row_md5
  or r.organization_id<>a.organization_id or r.user_id<>a.user_id or p.organization_id<>a.organization_id or p.user_id<>a.user_id
  or r.cache_key is distinct from previous.legacy_cache_key or r.request_sha256 is distinct from previous.legacy_request_sha256 then raise exception 'DIAGNOSTIC_PARENT_CHANGED';end if;
 if exists(select 1 from private.recommendation_corrected_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp())
  or exists(select 1 from private.recommendation_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp()) then raise exception 'DIAGNOSTIC_AUTHORIZATION_ALREADY_ACTIVE';end if;
 if exists(select 1 from private.recommendation_ai_attempts where organization_id=a.organization_id and state in('dispatched','unknown')) then raise exception 'DIAGNOSTIC_PROVIDER_OUTCOME_PENDING';end if;
 stamp:=clock_timestamp();
 insert into private.recommendation_corrected_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5,root_attempt_id,root_row_md5,
  legacy_cache_key,legacy_request_sha256,target_contract,target_validator,target_cache,authorized_at,expires_at)
 values(a.id,a.organization_id,a.user_id,md5(to_jsonb(a)::text),r.id,md5(to_jsonb(r)::text),previous.legacy_cache_key,previous.legacy_request_sha256,
  'recommendation-direct-choice-v1','recommendation-structural-validator-v1','recommendation-ai-light-v11',stamp,stamp+interval '24 hours');
end $$;
