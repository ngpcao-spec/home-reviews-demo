-- Experimental, manually invoked decision-layer benchmark. No production writes,
-- triggers, cron registration or changes to the historical V6 schema.
create table public.jev_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  establishment_id uuid not null references public.establishments(id),
  source_generation_id uuid not null,
  source_analysis_version integer not null check (source_analysis_version = 6),
  source_fingerprint text not null,
  requested_model text not null,
  served_models jsonb not null default '[]'::jsonb,
  status text not null check (status in ('running','completed','failed')),
  repeat_count integer not null default 3 check (repeat_count between 1 and 5),
  concurrency integer not null default 8 check (concurrency between 1 and 8),
  reviews_total integer not null,
  reviews_with_text integer not null,
  reviews_without_text integer not null,
  request_count integer not null default 0,
  retry_count integer not null default 0,
  jev_input_tokens bigint not null default 0,
  jev_output_tokens bigint not null default 0,
  jev_elapsed_ms bigint not null default 0,
  estimated_jev_cost_usd numeric,
  rate_used jsonb not null,
  sol_baseline_input_tokens bigint not null,
  sol_baseline_output_tokens bigint not null,
  estimated_sol_baseline_cost_usd numeric,
  sol_baseline_elapsed_ms bigint not null,
  decisions jsonb not null default '[]'::jsonb,
  comparison jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (reviews_total = reviews_with_text + reviews_without_text),
  check (reviews_with_text >= 0 and reviews_without_text >= 0),
  check (request_count >= 0 and retry_count >= 0 and jev_input_tokens >= 0 and jev_output_tokens >= 0 and jev_elapsed_ms >= 0)
);
create index jev_benchmark_runs_org_created_idx on public.jev_benchmark_runs (organization_id, created_at desc);
create index jev_benchmark_runs_establishment_idx on public.jev_benchmark_runs (establishment_id);
create unique index jev_benchmark_runs_one_active_source on public.jev_benchmark_runs (organization_id, source_generation_id) where status = 'running';
alter table public.jev_benchmark_runs enable row level security;
revoke all on public.jev_benchmark_runs from public, anon, authenticated;
grant select on public.jev_benchmark_runs to authenticated;
grant all on public.jev_benchmark_runs to service_role;
create policy jev_benchmark_runs_select on public.jev_benchmark_runs for select to authenticated
  using ((select private.has_org_role(organization_id, array['owner','admin','manager'])));
comment on table public.jev_benchmark_runs is 'Manual Jev Phase 1 experiments. No review text or secrets; immutable Sol V6 source is only read. Retained until explicitly deleted.';
