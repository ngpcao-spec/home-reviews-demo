-- Recovered schema from 20261009153815; no annotation rows imported.

create table if not exists public.analysis_jev_independent_ai_error_audits(
 audit_id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.analysis_jev_independent_runs(id) on delete restrict,
 holdout_id uuid not null,
 review_id uuid not null,
 review_position int not null check(review_position between 1 and 32),
 theme_key text not null,
 polarity text not null default 'negative' check(polarity='negative'),
 error_kind text not null check(error_kind in ('false_negative','false_positive')),
 analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
 reference_fingerprint text not null check(reference_fingerprint ~ '^[a-f0-9]{64}$'),
 initial_ai_choice text not null check(initial_ai_choice in ('absent','positive','negative','both','uncertain')),
 v11_prediction text not null check(v11_prediction in ('absent','positive','negative','both')),
 v12_prediction text not null check(v12_prediction in ('absent','positive','negative','both')),
 reviewed_ai_choice text not null check(reviewed_ai_choice in ('absent','positive','negative','both','uncertain')),
 verdict text not null check(verdict in ('confirmed_v12_error','ai_reference_correction','ambiguous')),
 confidence text not null check(confidence in ('high','medium','low')),
 evidence_excerpt text not null,
 rationale_fr text not null,
 v11_mean_negative_probability numeric not null check(v11_mean_negative_probability between 0 and 1),
 v12_mean_negative_probability numeric not null check(v12_mean_negative_probability between 0 and 1),
 annotation_source text not null default 'chatgpt_gpt_6_post_prediction_audit' 
  check(annotation_source='chatgpt_gpt_6_post_prediction_audit'),
 scoring_use text not null default 'diagnostic_only_no_sealed_reference_change'
  check(scoring_use='diagnostic_only_no_sealed_reference_change'),
 has_translation_concern boolean not null default false,
 created_at timestamptz not null default now(),
 unique(run_id,review_id,theme_key,error_kind),
 foreign key(holdout_id,review_id)
 references public.analysis_v11_independent_holdout_items(holdout_id,review_id) on delete restrict
);
comment on table public.analysis_jev_independent_ai_error_audits is
 'AI review after inspecting Jev holdout predictions. POST-HOC DIAGNOSTIC ONLY: never considered blinded, human Gold, or independent score. Does not modify sealed reference, V11/V12, or the frozen benchmark.';
alter table public.analysis_jev_independent_ai_error_audits enable row level security;
revoke all on public.analysis_jev_independent_ai_error_audits from public,anon,authenticated;
grant select,insert on public.analysis_jev_independent_ai_error_audits to service_role;
create or replace function public.guard_independent_ai_audit_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'IMMUTABLE_POSTHOC_AI_AUDIT'; end;$$;
drop trigger if exists independent_ai_audit_immutable on public.analysis_jev_independent_ai_error_audits;
create trigger independent_ai_audit_immutable before update or delete on
 public.analysis_jev_independent_ai_error_audits for each row execute function public.guard_independent_ai_audit_immutable();

