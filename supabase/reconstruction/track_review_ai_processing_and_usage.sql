-- Recovered from production migration 20260927115917, read-only 2026-11-11.
-- Empty isolated database reconstruction only; never deploy as a migration.
alter table public.reviews
    add column if not exists ai_model text,
    add column if not exists ai_input_tokens integer,
    add column if not exists ai_output_tokens integer,
    add column if not exists ai_reasoning_tokens integer,
    add column if not exists ai_total_tokens integer;

  alter table public.reviews drop constraint if exists reviews_ai_status_check;
  alter table public.reviews
    add constraint reviews_ai_status_check
    check (ai_status is null or ai_status in ('pending', 'processing', 'completed', 'failed'));

  alter table public.reviews
    add constraint reviews_ai_token_counts_check
    check (
      (ai_input_tokens is null or ai_input_tokens >= 0)
      and (ai_output_tokens is null or ai_output_tokens >= 0)
      and (ai_reasoning_tokens is null or ai_reasoning_tokens >= 0)
      and (ai_total_tokens is null or ai_total_tokens >= 0)
    );

