-- Recovered from production migration 20260927121840, read-only 2026-11-11.
-- Empty isolated database reconstruction only; never deploy as a migration.
alter table public.reviews
    add column if not exists ai_last_rejected_summary text,
    add column if not exists ai_last_rejected_reply text,
    add column if not exists ai_last_rejected_language text,
    add column if not exists ai_validation_error text;

