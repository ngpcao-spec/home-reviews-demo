begin;
-- Ephemeral technical sidecar only. Existing attempts and their immutable
-- accounting/cache protections are neither updated nor deleted by this feature.
create table private.recommendation_ai_diagnostics (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 attempt_id uuid references private.recommendation_ai_attempts(id),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 trace jsonb not null check(jsonb_typeof(trace)='object' and octet_length(trace::text)<=16384),
 check(expires_at=created_at+interval '7 days')
);
create index recommendation_ai_diagnostics_retention on private.recommendation_ai_diagnostics(organization_id,created_at desc,id desc);
alter table private.recommendation_ai_diagnostics enable row level security;
revoke all on private.recommendation_ai_diagnostics from public,anon,authenticated;
grant select,insert,delete on private.recommendation_ai_diagnostics to service_role;

create function public.prune_recommendation_diagnostics_v1(p_organization_id uuid,p_keep integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_keep not between 0 and 100 then raise exception 'INVALID_DIAGNOSTIC_LIMIT';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-diagnostics:'||p_organization_id::text,0)) then return 0;end if;
 with ranked as (
  select id,row_number() over(order by created_at desc,id desc) rn
  from private.recommendation_ai_diagnostics where organization_id=p_organization_id
 ), victims as (
  select d.id from private.recommendation_ai_diagnostics d join ranked r using(id)
  where d.organization_id=p_organization_id and (d.expires_at<=clock_timestamp() or r.rn>p_keep)
  order by d.created_at,d.id limit 100
 ) delete from private.recommendation_ai_diagnostics where id in(select id from victims);
 get diagnostics n=row_count;return n;
end $$;

create function public.record_recommendation_diagnostic_v1(p_organization_id uuid,p_user_id uuid,p_attempt_id uuid,p_trace jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); result_id uuid;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_attempt_id is not null and not exists(select 1 from private.recommendation_ai_attempts where id=p_attempt_id and organization_id=p_organization_id and user_id=p_user_id) then raise exception 'FOREIGN_ATTEMPT';end if;
 if jsonb_typeof(p_trace) is distinct from 'object' or p_trace->>'version' is distinct from 'recommendation-diagnostic-v2'
  or octet_length(p_trace::text)>16384 or (p_trace->>'attempt_id')::uuid is distinct from p_attempt_id
  or (p_trace-array['version','server_build','deployment_id','server_version','api_version','client_mode','contract_version','validator_version','cache_version','attempt_id','origin','stage','notice','candidate_ids','selected_candidate_ids','criterion_keys','failure','prior_attempt_state','provider_http_status','response_status'])<>'{}'::jsonb then raise exception 'INVALID_DIAGNOSTIC';end if;
 -- Separate non-blocking lock: diagnostics cannot reserve/resend a provider call.
 if not pg_try_advisory_xact_lock(hashtextextended('recommendation-diagnostics:'||p_organization_id::text,0)) then return null;end if;
 perform public.prune_recommendation_diagnostics_v1(p_organization_id,99);
 insert into private.recommendation_ai_diagnostics(organization_id,user_id,attempt_id,created_at,expires_at,trace)
 values(p_organization_id,p_user_id,p_attempt_id,stamp,stamp+interval '7 days',p_trace) returning id into result_id;
 return result_id;
end $$;
revoke all on function public.prune_recommendation_diagnostics_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.record_recommendation_diagnostic_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prune_recommendation_diagnostics_v1(uuid,integer) to service_role;
grant execute on function public.record_recommendation_diagnostic_v1(uuid,uuid,uuid,jsonb) to service_role;
comment on table private.recommendation_ai_diagnostics is 'Private content-free diagnostic sidecar, at most 100 per organization. Expires after 7 days; physical purge on next authorized page access/write, no new scheduler. Never modifies accounting receipts or allows a retry.';
commit;
