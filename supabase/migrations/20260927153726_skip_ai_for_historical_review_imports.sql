create or replace function private.enqueue_review_ai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  webhook_secret text;
begin
  if new.historical_import
     or new.rating < 1
     or new.rating > 3 then
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
$function$;

drop trigger if exists reviews_enqueue_ai_after_insert on public.reviews;

create trigger reviews_enqueue_ai_after_insert
after insert on public.reviews
for each row
when (
  new.historical_import = false
  and new.rating >= 1
  and new.rating <= 3
)
execute function private.enqueue_review_ai();
