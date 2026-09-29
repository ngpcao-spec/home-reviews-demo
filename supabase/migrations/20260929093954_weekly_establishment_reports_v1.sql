create table public.weekly_establishment_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  preferred_language text not null check (preferred_language in ('fr', 'vi')),
  google_rating numeric,
  google_total_reviews integer check (google_total_reviews is null or google_total_reviews >= 0),
  snapshot_captured_at timestamptz,
  new_reviews_count integer not null default 0 check (new_reviews_count >= 0),
  negative_reviews_count integer not null default 0 check (negative_reviews_count >= 0),
  negative_rate numeric(5, 1) not null default 0 check (negative_rate >= 0 and negative_rate <= 100),
  ready_replies_count integer not null default 0 check (ready_replies_count >= 0),
  ai_weekly_summary text,
  ai_status text not null default 'generating' check (ai_status in ('generating', 'completed', 'failed')),
  ai_error text,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  ai_total_tokens integer,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, period_start, preferred_language),
  check (period_end = period_start + interval '7 days'),
  check (period_start = date_trunc('day', period_start at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'),
  check (extract(isodow from period_start at time zone 'Asia/Ho_Chi_Minh') = 1)
);

create index weekly_establishment_reports_org_period_idx
  on public.weekly_establishment_reports (organization_id, period_start desc);

create index weekly_establishment_reports_establishment_period_idx
  on public.weekly_establishment_reports (establishment_id, period_start desc);

alter table public.weekly_establishment_reports enable row level security;
revoke all on public.weekly_establishment_reports from public, anon, authenticated;
grant select on public.weekly_establishment_reports to authenticated;
grant all on public.weekly_establishment_reports to service_role;

create policy weekly_establishment_reports_select
on public.weekly_establishment_reports
for select
to authenticated
using ((select private.is_org_member(organization_id)));

comment on table public.weekly_establishment_reports is
  'Persisted per-establishment Vietnam-calendar weekly reports. Writes are server-only; tenant members may read their organization reports.';
comment on column public.weekly_establishment_reports.period_start is
  'Inclusive Monday 00:00 Asia/Ho_Chi_Minh boundary stored as timestamptz.';
comment on column public.weekly_establishment_reports.period_end is
  'Exclusive following Monday 00:00 Asia/Ho_Chi_Minh boundary stored as timestamptz.';
