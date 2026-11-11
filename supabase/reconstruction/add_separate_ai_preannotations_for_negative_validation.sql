-- Exact schema-only production history 20261008235232; read-only recovery 2026-11-11.

create table if not exists public.analysis_negative_validation_ai_preannotations (
  experiment_id uuid not null,
  review_id uuid not null,
  analysis_text_sha256 text not null check (analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
  rubric_version text not null default 'human-aligned-review-rubric-v1',
  model_source text not null default 'chatgpt_gpt_6' check (model_source = 'chatgpt_gpt_6'),
  theme_choices jsonb not null check (jsonb_typeof(theme_choices) = 'object'),
  notes_fr text not null default '',
  needs_human_review boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (experiment_id, review_id),
  constraint analysis_negative_validation_ai_preannotations_review_fkey
    foreign key (experiment_id, review_id)
    references public.analysis_negative_validation_reviews (experiment_id, review_id)
    on delete cascade
);
comment on table public.analysis_negative_validation_ai_preannotations is
  'Independent AI preannotations for convenience only. Not human Gold. Do not substitute these for analysis_negative_validation_labels or use for official JEV validation.';
alter table public.analysis_negative_validation_ai_preannotations enable row level security;


