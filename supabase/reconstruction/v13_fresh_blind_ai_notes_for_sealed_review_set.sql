-- Recovered schema from 20261010013059; no annotation rows imported.
create table if not exists public.analysis_jev_v13_fresh_ai_reference_notes (
source_id uuid not null references public.analysis_jev_v13_sealed_inputs(id),
review_id uuid not null references public.reviews(id),
analysis_text_sha256 text not null,
overall_text_sentiment text not null,
notes_fr text not null,
uncertain_notes_fr text not null default '',
translation_caution boolean not null default false,
outside_taxonomy_notes_fr text not null default '',
created_at timestamptz not null default now(),
primary key(source_id,review_id));
alter table public.analysis_jev_v13_fresh_ai_reference_notes enable row level security;
revoke all on public.analysis_jev_v13_fresh_ai_reference_notes from public,anon,authenticated;
grant select,insert on public.analysis_jev_v13_fresh_ai_reference_notes to service_role;
