-- Deploy the previous client first. These objects are read-only; no review data is removed.
begin;
drop function public.read_restaurant_statistic_reviews(uuid,text,integer[],text,text,timestamptz,text,integer);
drop function public.read_restaurant_statistics(uuid,text);
drop function private.restaurant_statistic_reviews(uuid,text,integer[],text,text,timestamptz,text,integer);
drop function private.restaurant_statistics(uuid,text);
drop function private.statistics_rows(uuid);
drop function private.statistics_bounds(text,text,timestamptz);
drop function private.statistics_context(uuid);
drop index private.statistics_ready_jev_source;
commit;
