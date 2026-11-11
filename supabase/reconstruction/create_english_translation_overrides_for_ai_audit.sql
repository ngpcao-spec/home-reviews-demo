-- Recovered schema from 20261009053221; no annotation rows imported.

create table if not exists public.analysis_review_english_translation_overrides(
 review_id uuid primary key references public.reviews(id) on delete restrict,
 original_text_sha256 text not null check(original_text_sha256 ~ '^[a-f0-9]{64}$'),
 provider_translation_sha256 text not null check(provider_translation_sha256 ~ '^[a-f0-9]{64}$'),
 correction_language text not null default 'en' check(correction_language='en'),
 corrected_english_text text not null check(btrim(corrected_english_text) <> ''),
 corrected_english_sha256 text not null check(corrected_english_sha256 ~ '^[a-f0-9]{64}$'),
 error_type text not null check(error_type in ('sentiment_reversal','hallucinated_currency','menu_item_as_location')),
 evidence_fr text not null,
 source text not null default 'chatgpt_gpt_6_manual_audit' check(source='chatgpt_gpt_6_manual_audit'),
 status text not null default 'candidate_for_future_analysis' check(status='candidate_for_future_analysis'),
 benchmark_policy text not null default 'do_not_change_frozen_v9_v11_inputs' check(benchmark_policy='do_not_change_frozen_v9_v11_inputs'),
 created_at timestamptz not null default now()
);
comment on table public.analysis_review_english_translation_overrides is
 'AI-audited English translations for future analytics only. Preserve raw Apify/provider translations and all frozen historical/benchmark text. Integration requires separate explicit code change.';
alter table public.analysis_review_english_translation_overrides enable row level security;
revoke all on public.analysis_review_english_translation_overrides from public,anon,authenticated;
grant select,insert on public.analysis_review_english_translation_overrides to service_role;

