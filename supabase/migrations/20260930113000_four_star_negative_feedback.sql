alter table public.reviews
  add column if not exists has_negative_feedback boolean,
  add column if not exists negative_feedback_summary text,
  add column if not exists negative_feedback_checked_at timestamptz,
  add column if not exists negative_feedback_model text,
  add column if not exists negative_feedback_status text;

alter table public.reviews
  drop constraint if exists reviews_negative_feedback_status_check;

alter table public.reviews
  add constraint reviews_negative_feedback_status_check
  check (negative_feedback_status is null or negative_feedback_status in ('processing','completed','failed'));

create index if not exists reviews_four_star_feedback_pending_idx
  on public.reviews (organization_id, created_at)
  where historical_import = false
    and rating = 4
    and negative_feedback_checked_at is null
    and length(btrim(coalesce(original_text, text, ''))) > 0;

create or replace function private.enqueue_review_ai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  if new.historical_import
     or new.rating < 1
     or new.rating > 4
     or (new.rating = 4 and length(btrim(coalesce(new.original_text, new.text, ''))) = 0) then
    return new;
  end if;

  select config.secret
  into webhook_secret
  from public.ai_webhook_config as config
  where config.singleton;

  perform net.http_post(
    url := 'https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/analyze-review',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-home-reviews-webhook', webhook_secret
    ),
    body := jsonb_build_object('review_id', new.id)
  );

  return new;
end
$$;

drop trigger if exists reviews_enqueue_ai_after_insert on public.reviews;

create trigger reviews_enqueue_ai_after_insert
after insert on public.reviews
for each row
when (
  new.historical_import = false
  and (
    (new.rating between 1 and 3)
    or (
      new.rating = 4
      and length(btrim(coalesce(new.original_text, new.text, ''))) > 0
    )
  )
)
execute function private.enqueue_review_ai();
