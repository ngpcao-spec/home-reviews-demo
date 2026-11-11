-- Recovered schema from 20261009052035; no annotation rows imported.

create table if not exists public.analysis_negative_ai_review_rechecks (
  exploratory_run_id uuid not null references public.analysis_negative_ai_exploratory_runs(id) on delete restrict,
  experiment_id uuid not null,
  review_id uuid not null,
  frozen_text_sha256 text not null check(frozen_text_sha256 ~ '^[a-f0-9]{64}$'),
  review_position integer not null check(review_position between 1 and 32),
  review_status text not null check(review_status in ('reviewed','contains_ambiguity')),
  summary_fr text not null,
  corrector_model text not null default 'gpt-6',
  reference_type text not null default 'chatgpt_ai_recheck_not_human_gold'
    check(reference_type='chatgpt_ai_recheck_not_human_gold'),
  consent_context text not null default 'Chat user approved analysis (GO) and recording (Vas y), 2026-10-09',
  created_at timestamptz not null default now(),
  primary key (exploratory_run_id,review_id),
  foreign key (experiment_id,review_id)
    references public.analysis_negative_validation_ai_preannotations(experiment_id,review_id)
    on delete restrict
);
create table if not exists public.analysis_negative_ai_theme_rechecks (
  exploratory_run_id uuid not null,
  review_id uuid not null,
  theme_key text not null,
  initial_ai_choice text not null check(initial_ai_choice in ('absent','positive','negative','both','uncertain')),
  jev_v9_choice text not null check(jev_v9_choice in ('absent','positive','negative','both','incomplete')),
  jev_v11_choice text not null check(jev_v11_choice in ('absent','positive','negative','both','incomplete')),
  reviewed_ai_choice text not null check(reviewed_ai_choice in ('absent','positive','negative','both','uncertain')),
  judgement text not null check(judgement in ('confirmed','revised','uncertain')),
  confidence text not null check(confidence in ('high','medium','low')),
  reasoning_fr text not null,
  supporting_excerpt text not null default '',
  created_at timestamptz not null default now(),
  primary key (exploratory_run_id,review_id,theme_key),
  foreign key (exploratory_run_id,review_id)
    references public.analysis_negative_ai_review_rechecks(exploratory_run_id,review_id)
    on delete restrict
);
comment on table public.analysis_negative_ai_review_rechecks is
 'Approved ChatGPT AI recheck of 8 original Artisan reviews. Not human Gold; does not update original labels or historical benchmark.';
comment on table public.analysis_negative_ai_theme_rechecks is
 'Per-theme AI adjudication, original AI and Jev V9/V11 labels preserved verbatim as snapshots; no production or benchmark mutation.';
alter table public.analysis_negative_ai_review_rechecks enable row level security;
alter table public.analysis_negative_ai_theme_rechecks enable row level security;
revoke all on public.analysis_negative_ai_review_rechecks,public.analysis_negative_ai_theme_rechecks from public,anon,authenticated;
grant select,insert on public.analysis_negative_ai_review_rechecks,public.analysis_negative_ai_theme_rechecks to service_role;

