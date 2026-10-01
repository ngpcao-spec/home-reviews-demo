alter table public.historical_establishment_reports
  add column sample_reviews_count integer,
  add column sample_average_rating numeric,
  add column positive_reviews_count integer,
  add column positive_rate numeric,
  add column attention_reviews_count integer,
  add column processed_reviews_count integer,
  add column remaining_replies_count integer,
  add column food_average numeric,
  add column food_review_count integer,
  add column service_average numeric,
  add column service_review_count integer,
  add column atmosphere_average numeric,
  add column atmosphere_review_count integer,
  add column positive_themes jsonb,
  add column negative_themes jsonb,
  add column representative_positive_review_ids uuid[],
  add column representative_attention_review_ids uuid[],
  add column ai_overall_summary text,
  add column analysis_version integer not null default 1,
  add column source_fingerprint text,
  add column ai_call_count integer,
  add column ai_cost_usd numeric,
  add column source_undated_count integer,
  add column generation_id uuid;

comment on column public.historical_establishment_reports.data_complete is
  'V2: stored sample count is at least the current Google total. This does not assert reconstructed historical coverage.';

-- Private report execution state, including the immutable input for each generation.
-- No client writes or reads; the authenticated Edge Function performs membership checks.
create table public.historical_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  language text not null check(language in ('fr','vi')),
  generation_id uuid not null default gen_random_uuid(),
  status text not null default 'running' check(status in ('running','completed','failed')),
  snapshot jsonb not null,
  findings jsonb not null default '[]',
  cursor integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  ai_calls integer not null default 0,
  lease_until timestamptz,
  locked_by uuid,
  error_code text,
  updated_at timestamptz not null default now(),
  unique(establishment_id,language)
);
alter table public.historical_report_runs enable row level security;
revoke all on public.historical_report_runs from public,anon,authenticated;
grant all on public.historical_report_runs to service_role;

create function public.claim_historical_report_step(p_run_id uuid,p_generation_id uuid,p_worker_id uuid)
returns boolean language sql security invoker set search_path='' as $$
  with claimed as (
    update public.historical_report_runs set locked_by=p_worker_id,
      lease_until=now()+interval '180 seconds',updated_at=now()
    where id=p_run_id and generation_id=p_generation_id and status='running'
      and (lease_until is null or lease_until<now()) returning 1
  ) select exists(select 1 from claimed)
$$;
revoke all on function public.claim_historical_report_step(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_historical_report_step(uuid,uuid,uuid) to service_role;
