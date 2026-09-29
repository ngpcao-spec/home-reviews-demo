alter table public.reviews
  add column if not exists source_provider text,
  add column if not exists provider_publish_at text,
  add column if not exists provider_rating numeric,
  add column if not exists likes_count integer,
  add column if not exists review_context jsonb,
  add column if not exists review_detailed_rating jsonb,
  add column if not exists visited_in text,
  add column if not exists review_image_urls jsonb,
  add column if not exists response_from_owner_text text,
  add column if not exists response_from_owner_date timestamptz,
  add column if not exists reviewer_id text,
  add column if not exists reviewer_url text,
  add column if not exists reviewer_number_of_reviews integer,
  add column if not exists reviewer_photo_url text,
  add column if not exists is_local_guide boolean,
  add column if not exists review_origin text,
  add column if not exists provider_scraped_at timestamptz;

alter table public.reviews
  drop constraint if exists reviews_source_provider_check;
alter table public.reviews
  add constraint reviews_source_provider_check
  check (source_provider is null or source_provider in ('apify', 'outscraper', 'mock'));

create table if not exists public.review_provider_payloads (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  provider text not null check (provider in ('apify', 'outscraper', 'mock')),
  raw_payload jsonb not null,
  provider_first_seen_at timestamptz not null default now(),
  provider_last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, provider)
);

create index if not exists review_provider_payloads_review_id_idx
  on public.review_provider_payloads (review_id);

alter table public.review_provider_payloads enable row level security;
revoke all on public.review_provider_payloads from public, anon, authenticated;
grant all on public.review_provider_payloads to service_role;

create table if not exists public.establishment_snapshots (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  captured_at timestamptz not null default now(),
  rating numeric not null default 0,
  total_reviews integer not null default 0,
  provider text not null check (provider in ('apify', 'outscraper', 'mock')),
  source_run_id text,
  raw_place_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists establishment_snapshots_source_run_uidx
  on public.establishment_snapshots (establishment_id, provider, source_run_id)
  where source_run_id is not null;

create index if not exists establishment_snapshots_establishment_captured_idx
  on public.establishment_snapshots (establishment_id, captured_at desc);

create index if not exists establishment_snapshots_organization_captured_idx
  on public.establishment_snapshots (organization_id, captured_at desc);

alter table public.establishment_snapshots enable row level security;
revoke all on public.establishment_snapshots from public, anon, authenticated;
grant all on public.establishment_snapshots to service_role;

comment on table public.review_provider_payloads is
  'Server-only raw provider review payloads. No browser role receives access.';
comment on table public.establishment_snapshots is
  'Server-only provider snapshots used for rating and total-review evolution.';
comment on column public.reviews.original_text is
  'Original provider review text. Provider translations never overwrite it.';
