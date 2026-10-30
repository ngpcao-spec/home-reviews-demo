begin;
-- Private, content-free receipts/cache. No review/report/restaurant mutation or worker.
create table private.recommendation_ai_attempts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 cache_key text not null check(cache_key ~ '^[a-f0-9]{64}$'),
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'dispatched' check(state in ('dispatched','succeeded','invalid_output','http_error','unknown','obsolete')),
 selection jsonb,
 metrics jsonb,
 error_code text,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 unique(organization_id,user_id,cache_key),
 check((state='succeeded')=(selection is not null)),
 check(selection is null or jsonb_typeof(selection)='array')
);
alter table private.recommendation_ai_attempts enable row level security;
revoke all on private.recommendation_ai_attempts from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update on private.recommendation_ai_attempts to service_role;
create index recommendation_ai_attempts_active on private.recommendation_ai_attempts(organization_id,created_at) where state='dispatched';

create function public.reserve_recommendation_ai_v1(p_organization_id uuid,p_user_id uuid,p_cache_key text,p_request_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a private.recommendation_ai_attempts; fresh boolean:=false;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 -- Transaction-only coordination; no waiting for or retrying a paid call.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('recommendation-ai:'||p_organization_id::text,0)) then
  return jsonb_build_object('id',null,'owned',false,'state','dispatched','selection',null,'metrics',null);
 end if;
 select * into a from private.recommendation_ai_attempts where organization_id=p_organization_id and user_id=p_user_id and cache_key=p_cache_key;
 if a.id is not null then
  return jsonb_build_object('id',a.id,'owned',false,'state',case when a.state='dispatched' and a.created_at<clock_timestamp()-interval '2 minutes' then 'unknown' else a.state end,'selection',a.selection,'metrics',a.metrics);
 end if;
 -- One live comparison per organization. An abandoned reservation remains consumed for its key.
 if exists(select 1 from private.recommendation_ai_attempts where organization_id=p_organization_id and state='dispatched' and created_at>=clock_timestamp()-interval '2 minutes') then
  return jsonb_build_object('id',null,'owned',false,'state','dispatched','selection',null,'metrics',null);
 end if;
 insert into private.recommendation_ai_attempts(organization_id,user_id,cache_key,request_sha256)
 values(p_organization_id,p_user_id,p_cache_key,p_request_sha256) returning * into a;
 fresh:=true;
 return jsonb_build_object('id',a.id,'owned',fresh,'state',a.state,'selection',a.selection,'metrics',a.metrics);
end $$;

create function public.finish_recommendation_ai_v1(p_id uuid,p_state text,p_selection jsonb,p_metrics jsonb,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_state not in ('succeeded','invalid_output','http_error','unknown','obsolete') then raise exception 'INVALID_STATE';end if;
 update private.recommendation_ai_attempts set state=p_state,selection=p_selection,metrics=p_metrics,error_code=p_error,completed_at=clock_timestamp()
 where id=p_id and state='dispatched';
 return found;
end $$;
revoke all on function public.reserve_recommendation_ai_v1(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.finish_recommendation_ai_v1(uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_recommendation_ai_v1(uuid,uuid,text,text) to service_role;
grant execute on function public.finish_recommendation_ai_v1(uuid,text,jsonb,jsonb,text) to service_role;
comment on table private.recommendation_ai_attempts is 'Private recommendation comparison only. One consumed attempt per compatible request/access/data/config hash. No text or provider response stored. Never automatically resend unknown outcomes.';
commit;
