alter table public.weekly_establishment_reports
  add column if not exists calculation_version integer not null default 1
  check (calculation_version > 0);

comment on column public.weekly_establishment_reports.calculation_version is
  'Server calculation contract version. Version 2 preserves known negative-review and ready-reply metrics for partially covered periods.';
