-- A consumed start with no returned run ID is not disposable history:
-- it is the durable no-resend lock used by the scheduler and worker.
do $$declare d text;begin
 d=pg_get_functiondef('public.cleanup_review_sync_jobs(integer)'::regprocedure);
 if position('or (status=''dead'' and finished_at<' in d)=0 then raise exception 'SYNC_CLEANUP_DEFINITION_CHANGED';end if;
 d=replace(d,'or (status=''dead'' and finished_at<','or (status=''dead'' and not(provider_start_attempted_at is not null and apify_run_id is null) and finished_at<');
 execute d;
end$$;
