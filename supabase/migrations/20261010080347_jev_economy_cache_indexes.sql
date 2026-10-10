-- Cover the new cache foreign keys and establishment preview reads.
create index jev_review_cache_establishment on public.analysis_jev_review_cache(establishment_id,review_id);
create index jev_review_cache_review on public.analysis_jev_review_cache(review_id);
create index jev_review_cache_events_cache on public.analysis_jev_review_cache_events(cache_id);
