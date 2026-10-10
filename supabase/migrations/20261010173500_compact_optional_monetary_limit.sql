-- HOME Reviews: opt-in compact A/B test can be authorized without a
-- monetary ceiling, at the user's express request.
--
-- NULL cost_limit_usd means "no monetary ceiling". Positive values
-- retain the original ceiling checks. This migration does NOT create
-- an authorization or a run, dispatch JEV, or change any JEV configuration.
-- Existing guardrails remain in place: an authenticated role-confirmed
-- authorization tied to both sealed fingerprints, a second manual cost
-- confirmation, exactly 32 reviews x 2 variants, at most 64 requests,
-- one request per task, no automatic paid retry, and no production activation.
--
-- PostgreSQL IF/ELSIF only execute their branch for TRUE; comparisons
-- with NULL are UNKNOWN, so the existing "estimate > cost_limit_usd" and
-- "spent >= cost_limit_usd" checks are naturally bypassed for the
-- explicitly unbounded authorization. Both remain effective for
-- positive numeric cost limits.

alter table public.analysis_jev_compact_authorizations
  alter column cost_limit_usd drop not null;

alter table public.analysis_jev_compact_runs
  alter column cost_limit_usd drop not null;

comment on column public.analysis_jev_compact_authorizations.cost_limit_usd is
  'Optional USD spending ceiling. NULL only when user explicitly authorizes no monetary ceiling; maximum 64 evaluations and manual paid confirmation remain mandatory.';

comment on column public.analysis_jev_compact_runs.cost_limit_usd is
  'Copied from explicit authorization: NULL means no monetary ceiling; maximum 64 evaluation tasks, no automatic retries.';

-- Require the two schema columns to be nullable. No benchmark rows touched.
do $$
begin
 if exists(
   select 1 from information_schema.columns
   where table_schema='public'
     and table_name in('analysis_jev_compact_authorizations','analysis_jev_compact_runs')
     and column_name='cost_limit_usd'
     and is_nullable <> 'YES'
 ) then raise exception 'COMPACT_OPTIONAL_LIMIT_SCHEMA_NOT_READY'; end if;
end $$;
