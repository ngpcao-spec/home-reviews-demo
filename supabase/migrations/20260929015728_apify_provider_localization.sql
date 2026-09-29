alter table public.profiles
  add column if not exists preferred_language text;

alter table public.profiles
  drop constraint if exists profiles_preferred_language_check;
alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language is null or preferred_language in ('fr', 'vi'));

alter table public.reviews
  add column if not exists original_text text,
  add column if not exists original_language text;

update public.reviews
set original_text = text,
    original_language = coalesce(original_language, language)
where original_text is null;

alter table public.reviews
  alter column original_text set default '',
  alter column original_text set not null;

create table if not exists public.review_translations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  language text not null check (language in ('fr', 'vi')),
  translated_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, language)
);

create index if not exists review_translations_review_id_idx
  on public.review_translations(review_id);

alter table public.review_translations enable row level security;
revoke all on public.review_translations from public, anon, authenticated;
grant select on public.review_translations to authenticated;
grant all on public.review_translations to service_role;

drop policy if exists review_translations_select on public.review_translations;
create policy review_translations_select
on public.review_translations
for select
to authenticated
using (
  exists (
    select 1
    from public.reviews r
    where r.id = review_translations.review_id
      and (select private.is_org_member(r.organization_id))
  )
);

comment on column public.profiles.preferred_language is
  'HOME Reviews interface and provider translation language (fr or vi).';
comment on column public.reviews.original_text is
  'Original review text returned by the review provider. Never overwritten by translations.';
comment on table public.review_translations is
  'Provider translations cached per review and target language.';
