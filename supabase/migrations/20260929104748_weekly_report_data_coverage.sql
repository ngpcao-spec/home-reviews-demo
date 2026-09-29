alter table public.establishments
  add column if not exists reporting_started_at timestamptz;

comment on column public.establishments.reporting_started_at is
  'Authoritative instant from which HOME Reviews considers 1-5 star review collection and establishment snapshots complete for reporting.';

-- The complete 1-5 star persistence contract was enabled for existing active
-- establishments for the Vietnam calendar week beginning 28 September 2026.
-- Establishments created later keep their real initialization time.
update public.establishments
set reporting_started_at = greatest(
  created_at,
  timestamptz '2026-09-28 00:00:00+07'
)
where active = true
  and reporting_started_at is null;

alter table public.weekly_establishment_reports
  add column if not exists data_complete boolean not null default true;

comment on column public.weekly_establishment_reports.data_complete is
  'False when the requested period begins before the establishment reporting coverage started. Metrics must not be presented as reliable in that case.';

update public.weekly_establishment_reports report
set data_complete = false,
    ai_weekly_summary = null,
    ai_model = null,
    ai_input_tokens = null,
    ai_output_tokens = null,
    ai_total_tokens = null,
    updated_at = now()
from public.establishments establishment
where establishment.id = report.establishment_id
  and (
    establishment.reporting_started_at is null
    or report.period_start < establishment.reporting_started_at
  );
