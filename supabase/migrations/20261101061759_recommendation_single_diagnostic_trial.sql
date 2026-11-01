begin;
-- Explicit operator authorization, not a cache reset or automatic retry.
create table private.recommendation_diagnostic_trials (
 id uuid primary key default gen_random_uuid(),
 parent_attempt_id uuid not null unique references private.recommendation_ai_attempts(id),
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 parent_row_md5 text not null,
 authorized_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 consumed_at timestamptz,
 child_attempt_id uuid unique references private.recommendation_ai_attempts(id),
 check((consumed_at is null)=(child_attempt_id is null)),
 check(expires_at>authorized_at)
);
alter table private.recommendation_diagnostic_trials enable row level security;
revoke all on private.recommendation_diagnostic_trials from public,anon,authenticated;
grant select,insert,update on private.recommendation_diagnostic_trials to service_role;

create function public.authorize_recommendation_diagnostic_trial_v1(p_parent_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a private.recommendation_ai_attempts; g private.recommendation_diagnostic_trials;
begin
 select * into a from private.recommendation_ai_attempts where id=p_parent_id for update;
 if a.id is null or a.state<>'invalid_output' or a.completed_at is null
  or a.error_code is null or a.metrics->>'provider_request_id' is null
  or coalesce((a.metrics->>'output_tokens')::bigint,0)<=0 then raise exception 'DIAGNOSTIC_PARENT_NOT_DEFINITIVELY_REJECTED';end if;
 if not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=a.user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.recommendation_diagnostic_trials where child_attempt_id=a.id) then raise exception 'DIAGNOSTIC_REPLAY_CANNOT_BE_PARENT';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-ai:'||a.organization_id::text,0)) then raise exception 'DIAGNOSTIC_AUTHORIZATION_BUSY';end if;
 select * into g from private.recommendation_diagnostic_trials where parent_attempt_id=a.id;
 if g.id is not null then return g.id;end if; -- Never rearm, including after unknown/expiry.
 if exists(select 1 from private.recommendation_diagnostic_trials where organization_id=a.organization_id and user_id=a.user_id and child_attempt_id is null and expires_at>clock_timestamp()) then raise exception 'DIAGNOSTIC_AUTHORIZATION_ALREADY_ACTIVE';end if;
 insert into private.recommendation_diagnostic_trials(parent_attempt_id,organization_id,user_id,parent_row_md5)
 values(a.id,a.organization_id,a.user_id,md5(to_jsonb(a)::text)) returning id into g.id;
 return g.id;
end $$;

create function public.reserve_recommendation_with_diagnostic_v1(p_organization_id uuid,p_user_id uuid,p_cache_key text,p_request_sha256 text,p_trace jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g private.recommendation_diagnostic_trials; a private.recommendation_ai_attempts; child private.recommendation_ai_attempts; d uuid;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 -- Same organization lock and live-call ceiling as the ordinary circuit.
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-ai:'||p_organization_id::text,0)) then return jsonb_build_object('id',null,'owned',false,'state','dispatched','selection',null,'metrics',null);end if;
 select t.* into g from private.recommendation_diagnostic_trials t join private.recommendation_ai_attempts p on p.id=t.parent_attempt_id
 where t.organization_id=p_organization_id and t.user_id=p_user_id
 and ((t.child_attempt_id is null and t.expires_at>clock_timestamp()) or (p.cache_key=p_cache_key and p.request_sha256=p_request_sha256))
 order by t.authorized_at desc limit 1 for update of t;
 if g.id is null then return public.reserve_recommendation_ai_v1(p_organization_id,p_user_id,p_cache_key,p_request_sha256);end if;
 select * into a from private.recommendation_ai_attempts where id=g.parent_attempt_id;
 if a.state<>'invalid_output' or a.completed_at is null or md5(to_jsonb(a)::text)<>g.parent_row_md5 then raise exception 'DIAGNOSTIC_PARENT_CHANGED';end if;
 if a.cache_key<>p_cache_key or a.request_sha256<>p_request_sha256 then raise exception 'DIAGNOSTIC_REQUEST_CHANGED';end if;
 if g.child_attempt_id is not null then
  select * into child from private.recommendation_ai_attempts where id=g.child_attempt_id;
  return jsonb_build_object('id',child.id,'owned',false,'state',case when child.state='dispatched' and child.created_at<clock_timestamp()-interval '2 minutes' then 'unknown' else child.state end,'selection',child.selection,'metrics',child.metrics);
 end if;
 if g.expires_at<=clock_timestamp() then raise exception 'DIAGNOSTIC_AUTHORIZATION_EXPIRED';end if;
 if p_trace->>'version' is distinct from 'recommendation-diagnostic-v2'
  or p_trace->>'validator_version' is distinct from 'recommendation-criteria-validator-v1'
  or p_trace->>'contract_version' is distinct from 'recommendation-criteria-coverage-v1'
  or p_trace->>'cache_version' is distinct from a.metrics->>'configuration_version'
  or coalesce((p_trace->>'server_version')::integer,0)<8 then raise exception 'DIAGNOSTIC_RUNTIME_INCOMPATIBLE';end if;
 if exists(select 1 from private.recommendation_ai_attempts where organization_id=p_organization_id and state='dispatched' and created_at>=clock_timestamp()-interval '2 minutes') then return jsonb_build_object('id',null,'owned',false,'state','dispatched','selection',null,'metrics',null);end if;
 -- Separate accounting namespace for this explicit grant. Original request/cache
 -- hashes above must match exactly; neither the text nor configuration changes.
 insert into private.recommendation_ai_attempts(organization_id,user_id,cache_key,request_sha256)
 values(p_organization_id,p_user_id,md5('diagnostic-trial:'||g.id::text)||md5('parent:'||a.id::text),p_request_sha256) returning * into child;
 update private.recommendation_diagnostic_trials set child_attempt_id=child.id,consumed_at=clock_timestamp() where id=g.id;
 d:=public.record_recommendation_diagnostic_v1(p_organization_id,p_user_id,child.id,p_trace||jsonb_build_object('attempt_id',child.id,'stage','diagnostic_reserved','origin','pending'));
 if d is null then raise exception 'DIAGNOSTIC_STORE_UNAVAILABLE';end if;
 return jsonb_build_object('id',child.id,'owned',true,'state',child.state,'selection',null,'metrics',null);
end $$;

create function public.finish_recommendation_with_diagnostic_v1(p_id uuid,p_state text,p_selection jsonb,p_metrics jsonb,p_error text,p_trace jsonb)
returns boolean language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare g private.recommendation_diagnostic_trials; d uuid;
begin
 select * into g from private.recommendation_diagnostic_trials where child_attempt_id=p_id;
 if g.id is null then return public.finish_recommendation_ai_v1(p_id,p_state,p_selection,p_metrics,p_error);end if;
 -- Final diagnostic and native accounting receipt commit together. If persistence
 -- fails, the dispatched reservation remains consumed; it can never be resent.
 perform pg_advisory_xact_lock(hashtextextended('recommendation-diagnostics:'||g.organization_id::text,0));
 if not public.finish_recommendation_ai_v1(p_id,p_state,p_selection,p_metrics,p_error) then return false;end if;
 d:=public.record_recommendation_diagnostic_v1(g.organization_id,g.user_id,p_id,p_trace);
 if d is null then raise exception 'DIAGNOSTIC_STORE_UNAVAILABLE';end if;
 return true;
end $$;
revoke all on function public.authorize_recommendation_diagnostic_trial_v1(uuid) from public,anon,authenticated;
revoke all on function public.reserve_recommendation_with_diagnostic_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_recommendation_with_diagnostic_v1(uuid,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_recommendation_diagnostic_trial_v1(uuid) to service_role;
grant execute on function public.reserve_recommendation_with_diagnostic_v1(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.finish_recommendation_with_diagnostic_v1(uuid,text,jsonb,jsonb,text,jsonb) to service_role;
comment on table private.recommendation_diagnostic_trials is 'Content-free, explicit one-use operator grant linked to a definitively rejected attempt. Never reset or auto-rearm; consumed linkage retained to prevent duplicate paid calls. No worker or provider invocation.';
commit;
