alter table public.historical_report_runs
  add column rejected_findings_count integer not null default 0 check (rejected_findings_count >= 0),
  add column token_usage_complete boolean not null default true;

-- Older failed calls did not save their usage before validating their findings.
-- Keep the recorded token counts but explicitly mark these lower bounds.
update public.historical_report_runs set token_usage_complete=false
where status='failed' and ai_calls>cursor;

alter table public.historical_establishment_reports
  add column accepted_findings_count integer,
  add column rejected_findings_count integer,
  add column processed_batches_count integer,
  add column token_usage_complete boolean;

comment on column public.historical_report_runs.rejected_findings_count is
  'Individual invalid or over-limit findings rejected in successfully processed extraction batches; never included in themes.';
comment on column public.historical_report_runs.token_usage_complete is
  'False when an attempted model call has unrecorded usage. Recorded token totals are then only a lower bound.';
