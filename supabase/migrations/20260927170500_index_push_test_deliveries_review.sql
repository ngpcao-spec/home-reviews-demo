create index if not exists push_test_deliveries_review_idx on public.push_test_deliveries(review_id) where review_id is not null;
