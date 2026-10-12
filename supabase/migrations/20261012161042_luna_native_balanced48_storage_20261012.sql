-- Independent multilingual source-language experiment. No provider connectors, cron or paid execution.
create table public.analysis_luna_balanced_sets(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  version text not null check(version='luna-native-balanced48-v1'),
  manifest jsonb not null,
  manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  source_commit_sha text not null check(source_commit_sha ~ '^[a-f0-9]{40}$'),
  source_kind text not null default 'frozen_native_original_text' check(source_kind='frozen_native_original_text'),
  created_by uuid not null references auth.users(id),
  sealed_at timestamptz not null default now(),
  paid_enabled boolean not null default false check(not paid_enabled),
  production_enabled boolean not null default false check(not production_enabled),
  unique(organization_id,version),
  unique(id,organization_id)
);
create table public.analysis_luna_balanced_cases(
  set_id uuid not null,
  organization_id uuid not null,
  position int not null check(position between 1 and 48),
  review_id uuid not null references public.reviews(id),
  establishment_id uuid not null references public.establishments(id),
  rating smallint not null check(rating between 1 and 5),
  original_language text not null,
  original_text text not null,
  original_text_sha256 text not null check(original_text_sha256 ~ '^[a-f0-9]{64}$'),
  theme_key text not null,
  proposed_polarity text not null check(proposed_polarity in ('positive','negative')),
  axis text not null check(axis in ('quality','service','price','atmosphere')),
  candidate_source text not null check(candidate_source in ('multilingual_lexical_anchor','seeded_boundary_probe')),
  candidate_sha256 text not null check(candidate_sha256 ~ '^[a-f0-9]{64}$'),
  primary key(set_id,position),
  unique(set_id,review_id),
  unique(set_id,review_id,theme_key,original_text_sha256),
  foreign key(set_id,organization_id) references public.analysis_luna_balanced_sets(id,organization_id),
  check(original_text_sha256=encode(extensions.digest(convert_to(original_text,'UTF8'),'sha256'),'hex'))
);
create table public.analysis_luna_balanced_reference_seals(
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null unique,
  organization_id uuid not null,
  dataset_sha256 text not null check(dataset_sha256 ~ '^[a-f0-9]{64}$'),
  reference_sha256 text not null check(reference_sha256 ~ '^[a-f0-9]{64}$'),
  body jsonb not null,
  model text not null check(model='GPT-6'),
  reference_type text not null check(reference_type='GPT6_AI_reference_not_independent_human_Gold'),
  sealed_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  foreign key(set_id,organization_id) references public.analysis_luna_balanced_sets(id,organization_id),
  unique(id,organization_id)
);
create table public.analysis_luna_balanced_references(
  set_id uuid not null,
  organization_id uuid not null,
  seal_id uuid not null,
  review_id uuid not null,
  theme_key text not null,
  original_text_sha256 text not null,
  choice text not null check(choice in ('absent','positive','negative','both','uncertain')),
  justification text not null check(char_length(btrim(justification))>=8),
  primary key(set_id,review_id),
  foreign key(set_id,organization_id) references public.analysis_luna_balanced_sets(id,organization_id),
  foreign key(seal_id,organization_id) references public.analysis_luna_balanced_reference_seals(id,organization_id),
  foreign key(set_id,review_id,theme_key,original_text_sha256)
    references public.analysis_luna_balanced_cases(set_id,review_id,theme_key,original_text_sha256)
);
do $x$
declare t text;
begin
 foreach t in array array['analysis_luna_balanced_sets','analysis_luna_balanced_cases','analysis_luna_balanced_reference_seals','analysis_luna_balanced_references'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy luna_balanced_read_org on public.%I for select to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t,t);
  execute format('create trigger luna_balanced_immutable before update or delete on public.%I for each row execute function public.pilot_evidence_immutable()',t);
  execute format('create index %I on public.%I(organization_id)',t||'_org_idx',t);
 end loop;
end $x$;
create index luna_balanced_cases_review_idx on public.analysis_luna_balanced_cases(review_id);
create index luna_balanced_refs_seal_idx on public.analysis_luna_balanced_references(seal_id);
