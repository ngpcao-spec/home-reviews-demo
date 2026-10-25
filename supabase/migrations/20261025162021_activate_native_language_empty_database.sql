-- Restore only the previously active technical schedules. This dispatches no
-- import, generation or provider request; the database must still be empty.
do $$declare j bigint;begin
 if exists(select 1 from public.establishments) or exists(select 1 from public.reviews) or exists(select 1 from public.review_translations) or exists(select 1 from public.current_report_publications) or exists(select 1 from public.initial_import_jobs) or exists(select 1 from public.report_generation_requests) or exists(select 1 from public.review_sync_jobs) then raise exception 'EMPTY_RESET_DATABASE_REQUIRED';end if;
 if not exists(select 1 from public.review_corpus_policy where id and enabled and version='latest_reviews_150_v1' and max_text_reviews=150 and months is null) then raise exception 'LATEST_150_POLICY_REQUIRED';end if;
 if exists(select 1 from private.review_display_runtime where enabled) then raise exception 'EXTRA_TRANSLATOR_MUST_BE_DISABLED';end if;
 update private.restaurant_reset_control set completed_at=coalesce(completed_at,clock_timestamp()) where id;
 update public.review_corpus_policy set paused=false,ingestions_paused=false,updated_at=clock_timestamp() where id;
 for j in select c.jobid from cron.job c where c.jobid=any((select previous_active_jobs from private.restaurant_reset_control where id)::bigint[]) and c.jobname not in('home-reviews-display-translations-v1','home-reviews-english-backfill-worker-v1') loop perform cron.alter_job(j,active:=true);end loop;
end$$;
