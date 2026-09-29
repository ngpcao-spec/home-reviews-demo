create table public.review_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  language text not null check (language in ('fr', 'vi')),
  ai_summary text,
  ai_suggested_reply text,
  draft_text text,
  draft_updated_at timestamptz,
  draft_version bigint not null default 0 check (draft_version >= 0),
  translated_reply_text text,
  translated_reply_language text,
  translated_from_draft_version bigint,
  translated_at timestamptz,
  ai_status text not null default 'pending' check (ai_status in ('pending', 'processing', 'completed', 'failed')),
  ai_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, language),
  check (draft_text is null or char_length(draft_text) <= 4000),
  check (translated_reply_text is null or char_length(translated_reply_text) <= 4000)
);

create index review_reply_drafts_review_id_idx
  on public.review_reply_drafts (review_id);

alter table public.review_reply_drafts enable row level security;
revoke all on public.review_reply_drafts from public, anon, authenticated;
grant select on public.review_reply_drafts to authenticated;
grant all on public.review_reply_drafts to service_role;

create policy review_reply_drafts_select
on public.review_reply_drafts
for select
to authenticated
using (
  exists (
    select 1
    from public.reviews r
    where r.id = review_reply_drafts.review_id
      and (select private.is_org_member(r.organization_id))
  )
);

-- Only migrate drafts whose recorded language is already a valid HOME Reviews
-- working language. Legacy Russian/Korean/etc. replies deliberately remain audit-only
-- in reviews and are regenerated progressively when opened.
insert into public.review_reply_drafts (
  review_id,
  language,
  ai_summary,
  ai_suggested_reply,
  draft_text,
  draft_updated_at,
  draft_version,
  translated_reply_text,
  translated_reply_language,
  translated_from_draft_version,
  translated_at,
  ai_status,
  ai_error,
  created_at,
  updated_at
)
select
  r.id,
  case
    when lower(replace(coalesce(r.reply_draft_language, r.ai_suggested_reply_language, ''), '_', '-')) like 'fr%' then 'fr'
    when lower(replace(coalesce(r.reply_draft_language, r.ai_suggested_reply_language, ''), '_', '-')) like 'vi%' then 'vi'
  end,
  r.ai_summary,
  r.ai_suggested_reply,
  r.reply_draft_text,
  r.reply_draft_updated_at,
  greatest(r.reply_draft_version, 1),
  r.translated_reply_text,
  r.translated_reply_language,
  r.translated_from_draft_version,
  r.translated_reply_at,
  case when r.ai_status = 'completed' then 'completed' else coalesce(r.ai_status, 'pending') end,
  r.ai_error,
  coalesce(r.ai_analyzed_at, r.created_at, now()),
  coalesce(r.reply_draft_updated_at, r.ai_analyzed_at, r.updated_at, now())
from public.reviews r
where r.reply_draft_text is not null
  and (
    lower(replace(coalesce(r.reply_draft_language, r.ai_suggested_reply_language, ''), '_', '-')) like 'fr%'
    or lower(replace(coalesce(r.reply_draft_language, r.ai_suggested_reply_language, ''), '_', '-')) like 'vi%'
  )
on conflict (review_id, language) do nothing;

comment on table public.review_reply_drafts is
  'Manager-facing AI suggestion, editable draft and optional client-language translation, isolated per review and HOME Reviews working language.';
