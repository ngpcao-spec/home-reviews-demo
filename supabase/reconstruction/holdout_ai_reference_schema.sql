-- Exact schema-only history 20261009094500 blind_32_review_holdout_ai_references_with_immutable_seal; read-only recovery.

create table if not exists public.analysis_v11_independent_holdout_ai_references (
 holdout_id uuid not null,
 review_id uuid not null,
 analysis_text_sha256 text not null check (analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
 rubric_version text not null default 'human-aligned-review-rubric-v1' check(rubric_version='human-aligned-review-rubric-v1'),
 model_source text not null default 'chatgpt_gpt_6' check(model_source='chatgpt_gpt_6'),
 reference_kind text not null default 'blind_ai_reference_not_human_gold'
   check(reference_kind='blind_ai_reference_not_human_gold'),
 annotation_protocol text not null default 'english_only_25_theme_blind_to_v11_v12_predictions'
   check(annotation_protocol='english_only_25_theme_blind_to_v11_v12_predictions'),
 theme_choices jsonb not null check(jsonb_typeof(theme_choices)='object'),
 overall_text_sentiment text not null check(overall_text_sentiment in('positive','negative','mixed','insufficient')),
 notes_fr text not null default '',
 uncertain_notes_fr text not null default '',
 requires_review boolean not null default false,
 created_at timestamptz not null default now(),
 primary key(holdout_id,review_id),
 foreign key(holdout_id,review_id)
    references public.analysis_v11_independent_holdout_items(holdout_id,review_id) on delete restrict
);
create table if not exists public.analysis_v11_independent_holdout_ai_seals (
 holdout_id uuid primary key references public.analysis_v11_independent_holdout_sets(id) on delete restrict,
 sealed_at timestamptz not null default now(),
 reference_kind text not null default 'blind_ai_reference_not_human_gold'
  check(reference_kind='blind_ai_reference_not_human_gold'),
 rubric_version text not null default 'human-aligned-review-rubric-v1',
 model_source text not null default 'chatgpt_gpt_6',
 reference_records int not null check(reference_records=32),
 labeled_theme_choices int not null check(labeled_theme_choices=800),
 uncertain_theme_choices int not null check(uncertain_theme_choices between 0 and 800),
 reference_fingerprint text not null check(reference_fingerprint ~ '^[a-f0-9]{64}$'),
 frozen_dataset_fingerprint text not null check(frozen_dataset_fingerprint ~ '^[a-f0-9]{64}$'),
 note text not null default 'Independent of JEV predictions on this holdout; not human-validated or statistically independent AI.',
 created_at timestamptz not null default now()
);
comment on table public.analysis_v11_independent_holdout_ai_references is 'Blind independent AI annotation by GPT-6 of 32 English Artisan holdout reviews. Never human Gold. Not allowed to read Jev outputs when annotating.';
comment on table public.analysis_v11_independent_holdout_ai_seals is 'Immutable snapshot fingerprint for AI-only holdout reference. No paid benchmark may start without independent user authorization.';
alter table public.analysis_v11_independent_holdout_ai_references enable row level security;
alter table public.analysis_v11_independent_holdout_ai_seals enable row level security;
revoke all on public.analysis_v11_independent_holdout_ai_references,public.analysis_v11_independent_holdout_ai_seals from public,anon,authenticated;
grant select,insert on public.analysis_v11_independent_holdout_ai_references,public.analysis_v11_independent_holdout_ai_seals to service_role;
create or replace function public.guard_holdout_ai_reference_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'IMMUTABLE_AI_HOLDOUT_REFERENCE';
end $$;
drop trigger if exists holdout_ai_reference_immutable on public.analysis_v11_independent_holdout_ai_references;
create trigger holdout_ai_reference_immutable before update or delete
on public.analysis_v11_independent_holdout_ai_references
for each row execute function public.guard_holdout_ai_reference_immutable();
drop trigger if exists holdout_ai_seal_immutable on public.analysis_v11_independent_holdout_ai_seals;
create trigger holdout_ai_seal_immutable before update or delete
on public.analysis_v11_independent_holdout_ai_seals
for each row execute function public.guard_holdout_ai_reference_immutable();

