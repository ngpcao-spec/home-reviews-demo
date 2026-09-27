-- Internal, authenticated Web Push test delivery audit.
-- No browser role can read or write this table.

create table if not exists public.push_test_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  test_type text not null check (test_type in ('simple', 'deep_link')),
  review_id uuid references public.reviews(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint push_test_deliveries_user_key_unique unique (user_id, idempotency_key),
  constraint push_test_deliveries_key_length check (char_length(idempotency_key) between 16 and 128)
);

alter table public.push_test_deliveries enable row level security;

revoke all on table public.push_test_deliveries from anon, authenticated;
grant all on table public.push_test_deliveries to service_role;

comment on table public.push_test_deliveries is
  'Server-only idempotency and delivery audit for explicit internal Web Push tests.';
