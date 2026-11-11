-- Recovered schema from 20261009090714; no annotation rows imported.

create table if not exists public.analysis_jev_v12_ai_miss_audits(
 run_id uuid not null references public.analysis_jev_v12_runs(id) on delete restrict,
 review_id uuid not null references public.reviews(id) on delete restrict,
 theme_key text not null check(btrim(theme_key) <> ''),
 review_position integer not null check (review_position between 1 and 32),
 analysis_text_sha256 text not null check (analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
 original_ai_choice text not null check (original_ai_choice in('absent','positive','negative','both','uncertain')),
 reference_at_run_choice text not null check (reference_at_run_choice in('absent','positive','negative','both','uncertain')),
 v11_choice text not null check (v11_choice in('absent','positive','negative','both')),
 v12_choice text not null check (v12_choice in('absent','positive','negative','both')),
 reviewed_ai_choice text not null check (reviewed_ai_choice in('absent','positive','negative','both','uncertain')),
 assessment text not null check (assessment in ('confirmed_v12_miss','ambiguous_reference','reference_error')),
 confidence text not null check (confidence in('high','medium','low')),
 v11_mean_negative_probability numeric not null check (v11_mean_negative_probability between 0 and 1),
 v12_mean_negative_probability numeric not null check (v12_mean_negative_probability between 0 and 1),
 evidence_excerpt text not null,
 justification_fr text not null,
 source_method text not null default 'gpt6_textual_recheck_not_independent'
  check (source_method='gpt6_textual_recheck_not_independent'),
 scoring_policy text not null default 'diagnostic_only_no_retroactive_metric_change'
  check (scoring_policy='diagnostic_only_no_retroactive_metric_change'),
 created_at timestamptz not null default now(),
 primary key(run_id,review_id,theme_key)
);
comment on table public.analysis_jev_v12_ai_miss_audits is 'User-approved 2026-10-09 manual GPT-6 review of V12 flagged misses. Audit only, not independent human validation, source metric or production mutation.';
alter table public.analysis_jev_v12_ai_miss_audits enable row level security;
revoke all on public.analysis_jev_v12_ai_miss_audits from public,anon,authenticated;
grant select,insert on public.analysis_jev_v12_ai_miss_audits to service_role;

