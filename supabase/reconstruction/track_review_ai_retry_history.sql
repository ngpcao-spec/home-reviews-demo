-- Recovered from production migration 20260927121048, read-only 2026-11-11.
-- Empty isolated database reconstruction only; never deploy as a migration.
alter table public.reviews
    add column if not exists ai_attempt_count integer not null default 0,
    add column if not exists ai_error_history jsonb not null default '[]'::jsonb;

  alter table public.reviews
    add constraint reviews_ai_attempt_count_check
    check (ai_attempt_count >= 0);

  update public.reviews
  set ai_attempt_count = 1
  where ai_status = 'failed' and ai_attempt_count = 0;

