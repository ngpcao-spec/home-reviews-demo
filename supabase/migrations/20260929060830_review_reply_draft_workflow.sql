alter table public.reviews
  add column if not exists ai_suggested_reply_language text,
  add column if not exists reply_draft_text text,
  add column if not exists reply_draft_language text,
  add column if not exists reply_draft_updated_at timestamptz,
  add column if not exists reply_draft_version bigint not null default 0,
  add column if not exists translated_reply_text text,
  add column if not exists translated_reply_language text,
  add column if not exists translated_from_draft_updated_at timestamptz,
  add column if not exists translated_from_draft_version bigint,
  add column if not exists translated_reply_at timestamptz;

alter table public.reviews
  drop constraint if exists reviews_reply_draft_text_length,
  add constraint reviews_reply_draft_text_length
    check (reply_draft_text is null or char_length(reply_draft_text) <= 4000),
  drop constraint if exists reviews_translated_reply_text_length,
  add constraint reviews_translated_reply_text_length
    check (translated_reply_text is null or char_length(translated_reply_text) <= 4000),
  drop constraint if exists reviews_reply_draft_version_nonnegative,
  add constraint reviews_reply_draft_version_nonnegative
    check (reply_draft_version >= 0);

-- Preserve existing suggestions as versioned drafts without generating or translating anything.
-- Their historical language is the detected original language under the previous product rule.
update public.reviews
set ai_suggested_reply_language = coalesce(ai_suggested_reply_language, ai_detected_language, original_language, language),
    reply_draft_text = coalesce(reply_draft_text, ai_suggested_reply),
    reply_draft_language = coalesce(reply_draft_language, ai_detected_language, original_language, language),
    reply_draft_updated_at = coalesce(reply_draft_updated_at, ai_analyzed_at, updated_at, now()),
    reply_draft_version = case when reply_draft_text is null and ai_suggested_reply is not null then 1 else reply_draft_version end
where ai_suggested_reply is not null;

create or replace function public.save_review_reply_draft(
  p_review_id uuid,
  p_text text
)
returns table (
  reply_draft_text text,
  reply_draft_language text,
  reply_draft_updated_at timestamptz,
  reply_draft_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_language text;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if p_text is null or char_length(p_text) > 4000 then
    raise exception 'INVALID_DRAFT';
  end if;

  select r.organization_id
    into v_organization_id
  from public.reviews r
  where r.id = p_review_id;

  if v_organization_id is null
     or not private.has_org_role(v_organization_id, array['owner', 'admin', 'manager']) then
    raise exception 'FORBIDDEN';
  end if;

  select p.preferred_language
    into v_language
  from public.profiles p
  where p.user_id = v_user_id;

  if v_language not in ('fr', 'vi') then
    raise exception 'PREFERRED_LANGUAGE_REQUIRED';
  end if;

  return query
  update public.reviews r
  set reply_draft_text = p_text,
      reply_draft_language = v_language,
      reply_draft_updated_at = now(),
      reply_draft_version = r.reply_draft_version + 1
  where r.id = p_review_id
  returning r.reply_draft_text, r.reply_draft_language, r.reply_draft_updated_at, r.reply_draft_version;
end;
$$;

revoke all on function public.save_review_reply_draft(uuid, text) from public, anon;
grant execute on function public.save_review_reply_draft(uuid, text) to authenticated;

comment on column public.reviews.ai_suggested_reply_language is
  'Working language used by Terra for the immutable AI suggestion.';
comment on column public.reviews.reply_draft_text is
  'Latest manager-edited reply draft. Never replaced by final client-language translations.';
comment on column public.reviews.reply_draft_version is
  'Monotonic draft version used to invalidate stale translations safely.';
comment on column public.reviews.translated_from_draft_version is
  'Exact draft version used to create translated_reply_text.';
