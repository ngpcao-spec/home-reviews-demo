-- Resume only the inspected technical schedules, with no data or queued work.
do $$declare j bigint;begin
 if exists(select 1 from public.establishments) or exists(select 1 from public.reviews) or exists(select 1 from public.current_report_publications) or exists(select 1 from public.initial_import_jobs) or exists(select 1 from public.report_generation_requests) then raise exception 'EMPTY_RESET_DATABASE_REQUIRED';end if;
 if not exists(select 1 from public.review_corpus_policy where id and enabled and version='latest_reviews_150_v1' and max_text_reviews=150 and months is null) then raise exception 'LATEST_150_POLICY_REQUIRED';end if;
 update private.restaurant_reset_control set completed_at=coalesce(completed_at,clock_timestamp()) where id;
 update public.review_corpus_policy set paused=false,ingestions_paused=false,updated_at=now() where id;
 foreach j in array (select previous_active_jobs from private.restaurant_reset_control where id) loop perform cron.alter_job(j,active:=true);end loop;
end $$;
