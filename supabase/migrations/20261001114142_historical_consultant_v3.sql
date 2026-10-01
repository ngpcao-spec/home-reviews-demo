-- V3 analytics are separate from the rating-based operational metrics.
alter table public.historical_establishment_reports
  add column analytical_positive_count integer,
  add column analytical_negative_count integer,
  add column consultant_report jsonb,
  add constraint historical_analytical_totals check (
    analysis_version <> 3 or (
      sample_reviews_count is not null and analytical_positive_count is not null and analytical_negative_count is not null
      and analytical_positive_count >= 0 and analytical_negative_count >= 0
      and analytical_positive_count + analytical_negative_count = sample_reviews_count
      and consultant_report is not null
    )
  );
alter table public.historical_report_runs
  add column classifications jsonb not null default '[]'::jsonb;
comment on column public.historical_establishment_reports.consultant_report is
  'V3 manual report: content sentiment and four fixed axes. Does not redefine operational negative reviews or notifications.';
-- Existing report RLS and service-only run permissions remain unchanged.
