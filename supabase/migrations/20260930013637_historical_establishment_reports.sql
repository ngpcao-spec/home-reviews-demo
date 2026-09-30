create table public.historical_establishment_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  preferred_language text not null check (preferred_language in ('fr', 'vi')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  google_rating numeric,
  google_total_reviews integer check (google_total_reviews is null or google_total_reviews >= 0),
  stored_reviews_count integer not null default 0 check (stored_reviews_count >= 0),
  negative_reviews_count integer not null default 0 check (negative_reviews_count >= 0),
  negative_rate numeric(5, 1) not null default 0 check (negative_rate >= 0 and negative_rate <= 100),
  ready_replies_count integer not null default 0 check (ready_replies_count >= 0),
  rating_1_count integer not null default 0 check (rating_1_count >= 0),
  rating_2_count integer not null default 0 check (rating_2_count >= 0),
  rating_3_count integer not null default 0 check (rating_3_count >= 0),
  rating_4_count integer not null default 0 check (rating_4_count >= 0),
  rating_5_count integer not null default 0 check (rating_5_count >= 0),
  data_complete boolean not null default false,
  source_latest_published_at timestamptz,
  ai_historical_summary text,
  ai_status text not null default 'generating' check (ai_status in ('generating', 'completed', 'failed')),
  ai_error text,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  ai_total_tokens integer,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, preferred_language),
  check (period_end >= period_start)
);

create index historical_establishment_reports_org_updated_idx
  on public.historical_establishment_reports (organization_id, updated_at desc);

alter table public.historical_establishment_reports enable row level security;
revoke all on public.historical_establishment_reports from public, anon, authenticated;
grant select on public.historical_establishment_reports to authenticated;
grant all on public.historical_establishment_reports to service_role;

create policy historical_establishment_reports_select
on public.historical_establishment_reports
for select
to authenticated
using ((select private.is_org_member(organization_id)));

comment on table public.historical_establishment_reports is
  'Cached per-establishment, per-working-language analysis of reviews already stored by HOME Reviews. No provider collection is triggered.';
comment on column public.historical_establishment_reports.data_complete is
  'True only when the entire displayed period is covered by complete 1-5 star collection; false for imported data preceding reporting_started_at.';

create or replace function public.get_historical_report_metrics(
  p_organization_id uuid,
  p_establishment_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_language text
)
returns table (
  stored_reviews_count bigint,
  negative_reviews_count bigint,
  negative_rate numeric,
  ready_replies_count bigint,
  rating_1_count bigint,
  rating_2_count bigint,
  rating_3_count bigint,
  rating_4_count bigint,
  rating_5_count bigint,
  source_latest_published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with period_reviews as (
    select r.id, r.rating, r.published_at
    from public.reviews r
    where r.organization_id = p_organization_id
      and r.establishment_id = p_establishment_id
      and r.published_at >= p_period_start
      and r.published_at < p_period_end
      and r.rating between 1 and 5
  ), metrics as (
    select
      count(*) as stored_reviews_count,
      count(*) filter (where rating between 1 and 3) as negative_reviews_count,
      count(*) filter (where rating = 1) as rating_1_count,
      count(*) filter (where rating = 2) as rating_2_count,
      count(*) filter (where rating = 3) as rating_3_count,
      count(*) filter (where rating = 4) as rating_4_count,
      count(*) filter (where rating = 5) as rating_5_count,
      max(published_at) as source_latest_published_at
    from period_reviews
  )
  select
    metrics.stored_reviews_count,
    metrics.negative_reviews_count,
    case when metrics.stored_reviews_count = 0 then 0::numeric
      else round(metrics.negative_reviews_count::numeric / metrics.stored_reviews_count::numeric * 100, 1)
    end as negative_rate,
    (
      select count(distinct period_reviews.id)
      from period_reviews
      join public.review_reply_drafts draft on draft.review_id = period_reviews.id
      where period_reviews.rating between 1 and 3
        and draft.language = p_language
        and draft.ai_status = 'completed'
        and coalesce(nullif(btrim(draft.draft_text), ''), nullif(btrim(draft.ai_suggested_reply), '')) is not null
    ) as ready_replies_count,
    metrics.rating_1_count,
    metrics.rating_2_count,
    metrics.rating_3_count,
    metrics.rating_4_count,
    metrics.rating_5_count,
    metrics.source_latest_published_at
  from metrics;
$$;

revoke all on function public.get_historical_report_metrics(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.get_historical_report_metrics(uuid, uuid, timestamptz, timestamptz, text)
  to service_role;
