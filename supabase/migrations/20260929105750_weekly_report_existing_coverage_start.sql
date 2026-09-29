-- Product cutover: existing active establishments are considered covered from
-- the beginning of the Vietnam calendar week starting 28 September 2026.
-- Future establishments are activated by the snapshot + successful-sync trigger.
update public.establishments
set reporting_started_at = timestamptz '2026-09-28 00:00:00+07'
where active = true
  and reporting_started_at is not null;
