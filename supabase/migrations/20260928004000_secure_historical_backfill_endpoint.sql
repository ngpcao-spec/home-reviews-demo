create table if not exists private.historical_backfill_credentials (
  singleton boolean primary key default true check (singleton),
  token_hash text not null,
  updated_at timestamptz not null default now()
);

revoke all on private.historical_backfill_credentials from public, anon, authenticated;
grant select on private.historical_backfill_credentials to service_role;

create or replace function public.verify_historical_backfill_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select exists(
    select 1
    from private.historical_backfill_credentials
    where singleton
      and token_hash = encode(
        extensions.digest(coalesce(p_token, ''), 'sha256'),
        'hex'
      )
  )
$function$;

revoke all on function public.verify_historical_backfill_token(text) from public, anon, authenticated;
grant execute on function public.verify_historical_backfill_token(text) to service_role;
