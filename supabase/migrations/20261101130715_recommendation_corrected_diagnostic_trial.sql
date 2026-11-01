begin;
-- A new explicit operator grant for a deployed protocol correction. Existing
-- grants/receipts are never edited, rearmed or automatically upgraded.
create table private.recommendation_corrected_diagnostic_trials (
 id uuid primary key default gen_random_uuid(),
 parent_attempt_id uuid not null unique references private.recommendation_ai_attempts(id),
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 parent_row_md5 text not null,
 root_attempt_id uuid not null references private.recommendation_ai_attempts(id),
 root_row_md5 text not null,
 legacy_cache_key text not null check(legacy_cache_key ~ '^[a-f0-9]{64}$'),
 legacy_request_sha256 text not null check(legacy_request_sha256 ~ '^[a-f0-9]{64}$'),
 identity_bridge text not null default 'recommendation-v6-to-v7-identity-v1' check(identity_bridge='recommendation-v6-to-v7-identity-v1'),
 target_contract text not null default 'recommendation-criteria-coverage-v2' check(target_contract='recommendation-criteria-coverage-v2'),
 target_validator text not null default 'recommendation-criteria-validator-v2' check(target_validator='recommendation-criteria-validator-v2'),
 target_cache text not null default 'recommendation-ai-open-criteria-safety-v7' check(target_cache='recommendation-ai-open-criteria-safety-v7'),
 authorized_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 consumed_at timestamptz,
 child_attempt_id uuid unique references private.recommendation_ai_attempts(id),
 request_sha256 text check(request_sha256 ~ '^[a-f0-9]{64}$'),
 cache_key text check(cache_key ~ '^[a-f0-9]{64}$'),
 check((consumed_at is null)=(child_attempt_id is null)),
 check((child_attempt_id is null)=(request_sha256 is null)),
 check((child_attempt_id is null)=(cache_key is null)),
 check(expires_at>authorized_at)
);
alter table private.recommendation_corrected_diagnostic_trials enable row level security;
revoke all on private.recommendation_corrected_diagnostic_trials from public,anon,authenticated;
grant select,insert,update on private.recommendation_corrected_diagnostic_trials to service_role;

create function public.authorize_corrected_recommendation_diagnostic_v1(p_parent_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a private.recommendation_ai_attempts; r private.recommendation_ai_attempts; old private.recommendation_diagnostic_trials; g private.recommendation_corrected_diagnostic_trials;
begin
 select * into a from private.recommendation_ai_attempts where id=p_parent_id for update;
 if a.id is null or a.state<>'invalid_output' or a.completed_at is null or a.error_code is distinct from 'IRRELEVANT_CAUTION'
  or a.metrics->>'provider_request_id' is null or coalesce((a.metrics->>'output_tokens')::bigint,0)<=0
  or a.metrics->>'configuration_version' is distinct from 'recommendation-ai-caution-safety-v6' then raise exception 'DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED';end if;
 if not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=a.user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-ai:'||a.organization_id::text,0)) then raise exception 'DIAGNOSTIC_AUTHORIZATION_BUSY';end if;
 select * into g from private.recommendation_corrected_diagnostic_trials where parent_attempt_id=a.id;
 if g.id is not null then return g.id;end if; -- Never reset consumption/expiry.
 if exists(select 1 from private.recommendation_corrected_diagnostic_trials where child_attempt_id=a.id) then raise exception 'DIAGNOSTIC_REPLAY_CANNOT_BE_PARENT';end if;
 if exists(select 1 from private.recommendation_corrected_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp())
  or exists(select 1 from private.recommendation_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp()) then raise exception 'DIAGNOSTIC_AUTHORIZATION_ALREADY_ACTIVE';end if;
 r:=a;
 select * into old from private.recommendation_diagnostic_trials where child_attempt_id=a.id;
 if old.id is not null then
  select * into r from private.recommendation_ai_attempts where id=old.parent_attempt_id;
  if r.id is null or md5(to_jsonb(r)::text)<>old.parent_row_md5 or r.organization_id<>a.organization_id or r.user_id<>a.user_id
   or r.request_sha256<>a.request_sha256 then raise exception 'DIAGNOSTIC_PARENT_CHANGED';end if;
 end if;
 insert into private.recommendation_corrected_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5,root_attempt_id,root_row_md5,legacy_cache_key,legacy_request_sha256)
 values(a.id,a.organization_id,a.user_id,md5(to_jsonb(a)::text),r.id,md5(to_jsonb(r)::text),r.cache_key,a.request_sha256) returning id into g.id;
 return g.id;
end $$;

create function public.reserve_corrected_recommendation_diagnostic_v1(p_organization_id uuid,p_user_id uuid,p_cache_key text,p_request_sha256 text,p_legacy_cache_key text,p_legacy_request_sha256 text,p_trace jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if a.state is distinct from 'invalid_output' or a.completed_at is null or md5(to_jsonb(a)::text) is distinct from g.parent_row_md5
  or md5(to_jsonb(r)::text) is distinct from g.root_row_md5 then raise exception 'DIAGNOSTIC_PARENT_CHANGED';end if;
 if g.legacy_cache_key is distinct from p_legacy_cache_key or g.legacy_request_sha256 is distinct from p_legacy_request_sha256 then raise exception 'DIAGNOSTIC_REQUEST_CHANGED';end if;
 if p_trace->>'version' is distinct from 'recommendation-diagnostic-v2' or p_trace->>'validator_version' is distinct from g.target_validator
  or p_trace->>'contract_version' is distinct from g.target_contract or p_trace->>'cache_version' is distinct from g.target_cache
  or coalesce((p_trace->>'server_version')::integer,0)<10 then raise exception 'DIAGNOSTIC_RUNTIME_INCOMPATIBLE';end if;
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
end $$;

create function public.finish_corrected_recommendation_diagnostic_v1(p_id uuid,p_state text,p_selection jsonb,p_metrics jsonb,p_error text,p_trace jsonb)
returns boolean language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare g private.recommendation_corrected_diagnostic_trials; d uuid;
begin
 select * into g from private.recommendation_corrected_diagnostic_trials where child_attempt_id=p_id;
 if g.id is null then return public.finish_recommendation_with_diagnostic_v1(p_id,p_state,p_selection,p_metrics,p_error,p_trace);end if;
 perform pg_advisory_xact_lock(hashtextextended('recommendation-diagnostics:'||g.organization_id::text,0));
 if not public.finish_recommendation_ai_v1(p_id,p_state,p_selection,p_metrics,p_error) then return false;end if;
 d:=public.record_recommendation_diagnostic_v1(g.organization_id,g.user_id,p_id,p_trace);
 if d is null then raise exception 'DIAGNOSTIC_STORE_UNAVAILABLE';end if;
 return true;
end $$;
revoke all on function public.authorize_corrected_recommendation_diagnostic_v1(uuid) from public,anon,authenticated;
revoke all on function public.reserve_corrected_recommendation_diagnostic_v1(uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_corrected_recommendation_diagnostic_v1(uuid,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_corrected_recommendation_diagnostic_v1(uuid) to service_role;
grant execute on function public.reserve_corrected_recommendation_diagnostic_v1(uuid,uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.finish_corrected_recommendation_diagnostic_v1(uuid,text,jsonb,jsonb,text,jsonb) to service_role;
comment on table private.recommendation_corrected_diagnostic_trials is 'Content-free operator authorization for one V6-to-V7 corrected trial. Same legacy request/access/data hashes required; consumed and unknown attempts never resent. No automatic work.';
commit;
