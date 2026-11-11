-- Exact schema-only production history 20261009012823; read-only recovery 2026-11-11.

create table if not exists public.analysis_v11_independent_holdout_sets(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),
 source_experiment_id uuid references public.analysis_negative_validation_runs(id),
 name text not null unique,
 test_purpose text not null default 'independent_v11_negative_review_holdout',
 selection_method text not null default 'all_unused_low_and_mixed_plus_deterministic_4_controls',
 label_source text not null default 'human_independent_required',
 status text not null default 'prepared' check(status in('prepared','annotating','gold_frozen','running','completed','failed')),
 expected_count int not null default 32 check(expected_count=32),
 selection_fingerprint text,
 notes text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.analysis_v11_independent_holdout_items(
 holdout_id uuid not null references public.analysis_v11_independent_holdout_sets(id) on delete restrict,
 review_id uuid not null references public.reviews(id) on delete restrict,
 position int not null check(position between 1 and 32),
 selection_bucket text not null check(selection_bucket in('low','mixed','control')),
 overall_rating smallint not null check(overall_rating between 1 and 5),
 analysis_text text not null check(btrim(analysis_text)<>''),
 analysis_language text not null default 'en' check(analysis_language='en'),
 analysis_source text not null check(analysis_source in('original_en','google_translation_en')),
 analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
 original_language text,
 published_at timestamptz,
 google_detailed_ratings jsonb,
 created_at timestamptz not null default now(),
 primary key(holdout_id,review_id),
 unique(holdout_id,position)
);
comment on table public.analysis_v11_independent_holdout_sets is 'Prepared NEW sample for independent human validation of V11. Does NOT start JEV or Sol and is NOT connected to production report queue.';
comment on table public.analysis_v11_independent_holdout_items is 'Frozen English review text; 19 unused 1-3-star, 9 unused 4-star and 4 deterministic unused 5-star controls. No human or AI label stored.';
alter table public.analysis_v11_independent_holdout_sets enable row level security;
alter table public.analysis_v11_independent_holdout_items enable row level security;
revoke all on public.analysis_v11_independent_holdout_sets,public.analysis_v11_independent_holdout_items from public,anon,authenticated;
grant all on public.analysis_v11_independent_holdout_sets,public.analysis_v11_independent_holdout_items to service_role;


