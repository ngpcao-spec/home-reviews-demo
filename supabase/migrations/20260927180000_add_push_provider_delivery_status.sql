alter table public.push_test_deliveries
  add column if not exists push_attempted boolean not null default false,
  add column if not exists provider_called boolean not null default false,
  add column if not exists provider_status integer,
  add column if not exists subscription_count integer not null default 0,
  add column if not exists expired_subscriptions_removed integer not null default 0;

alter table public.push_test_deliveries
  add constraint push_test_deliveries_provider_status_check
  check (provider_status is null or provider_status between 100 and 599);
