-- Recovered schema from 20261010063953; no annotation rows imported.
-- PREPARED AUDIT, NOT APPLIED TO SUPABASE.
-- HOME Reviews V13 / 3rd holdout: 18 negative-polarity post-prediction AI judgments.
-- Does not change the 800 sealed labels, previous results, JEV configurations or production.
-- Review every precondition; execute once through a trusted, authorized Supabase migration.

CREATE TABLE IF NOT EXISTS public.analysis_jev_v13_fresh_posthoc_ai_audits (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.analysis_jev_v13_runs(id) on delete restrict,
    source_id uuid not null references public.analysis_jev_v13_sealed_inputs(id) on delete restrict,
    review_id uuid not null references public.reviews(id) on delete restrict,
    review_position integer not null check(review_position between 1 and 32),
    theme_key text not null,
    polarity text not null default 'negative' check(polarity='negative'),
    error_kind text not null check(error_kind in ('false_positive','false_negative')),
    initial_ai_choice text not null,
    v12_choice text not null,
    v13_choice text not null,
    reviewed_ai_choice text not null check(reviewed_ai_choice in ('absent','negative','positive','both','uncertain')),
    verdict text not null check(verdict in ('confirmed_v13_error','ai_reference_correction','ambiguous')),
    confidence text not null check(confidence in ('high','medium','low')),
    evidence_excerpt text not null,
    rationale_fr text not null,
    analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
    sealed_reference_sha256 text not null check(sealed_reference_sha256 ~ '^[a-f0-9]{64}$'),
    provenance text not null default 'chatgpt_gpt6_post_prediction_not_human_gold',
    scope text not null default 'diagnostic_only_no_historical_rewrite',
    created_at timestamptz not null default now(),
    unique (run_id,review_id,theme_key,error_kind)
);
COMMENT ON TABLE public.analysis_jev_v13_fresh_posthoc_ai_audits IS 'Post-hoc ChatGPT-GPT6 AI diagnostic. Never human Gold or blinded validation.';
ALTER TABLE public.analysis_jev_v13_fresh_posthoc_ai_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analysis_jev_v13_fresh_posthoc_ai_audits FROM public,anon,authenticated;
GRANT SELECT,INSERT ON public.analysis_jev_v13_fresh_posthoc_ai_audits TO service_role;

CREATE OR REPLACE FUNCTION public.guard_jev_v13_posthoc_audit_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'V13_POSTHOC_AUDIT_IMMUTABLE'; END; $$;
DROP TRIGGER IF EXISTS guard_jev_v13_posthoc_ai_audit ON public.analysis_jev_v13_fresh_posthoc_ai_audits;
CREATE TRIGGER guard_jev_v13_posthoc_ai_audit BEFORE UPDATE OR DELETE ON public.analysis_jev_v13_fresh_posthoc_ai_audits
FOR EACH ROW EXECUTE FUNCTION public.guard_jev_v13_posthoc_audit_immutability();

