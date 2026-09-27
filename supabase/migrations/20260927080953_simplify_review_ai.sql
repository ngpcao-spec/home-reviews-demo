alter table public.reviews
  add column ai_summary text,
  add column ai_suggested_reply text,
  add column ai_detected_language text,
  add column ai_analyzed_at timestamptz,
  add column ai_status text,
  add column ai_error text,
  add constraint reviews_ai_status_check
    check (ai_status is null or ai_status in ('pending', 'completed', 'failed')),
  add constraint reviews_ai_rating_check
    check (
      (rating between 1 and 3)
      or (
        ai_summary is null
        and ai_suggested_reply is null
        and ai_detected_language is null
        and ai_analyzed_at is null
        and ai_status is null
        and ai_error is null
      )
    );

alter table public.reviews
  drop constraint if exists reviews_attention_rule;

update public.reviews
set
  requires_attention = rating between 1 and 3,
  requires_ai_analysis = rating between 1 and 3,
  status = case when rating between 1 and 3 and status in ('new', 'ignored') then 'to_process' else status end,
  ai_status = case when rating between 1 and 3 then 'pending' else null end;

alter table public.reviews
  add constraint reviews_attention_rule check (
    (rating between 1 and 3 and requires_attention and requires_ai_analysis)
    or (rating in (4, 5) and not requires_attention and not requires_ai_analysis)
  );

create index reviews_ai_pending_idx
  on public.reviews (organization_id, created_at)
  where rating between 1 and 3 and ai_status in ('pending', 'failed');

create extension if not exists pg_net with schema extensions;

create table public.ai_webhook_config (
  singleton boolean primary key default true check (singleton),
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now()
);

insert into public.ai_webhook_config (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.ai_webhook_config enable row level security;
revoke all on public.ai_webhook_config from public, anon, authenticated;
grant select on public.ai_webhook_config to service_role;

create or replace function private.enqueue_review_ai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  select config.secret
  into webhook_secret
  from public.ai_webhook_config as config
  where config.singleton;

  perform net.http_post(
    url := 'https://eaoefvnpqymngiwiwuff.supabase.co/functions/v1/analyze-review',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-home-reviews-webhook', webhook_secret
    ),
    body := jsonb_build_object('review_id', new.id)
  );

  return new;
end
$$;

revoke all on function private.enqueue_review_ai() from public, anon, authenticated;

create trigger reviews_enqueue_ai_after_insert
after insert on public.reviews
for each row
when (new.rating between 1 and 3)
execute function private.enqueue_review_ai();
