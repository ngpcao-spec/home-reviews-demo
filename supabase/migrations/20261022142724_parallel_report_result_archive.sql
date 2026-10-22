-- Extend only the existing immutable archive writer's protocol allow-list.
-- No authorization, job, classification, report or provider operation is changed.
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 anchor='''direct4-short-common-comparison-v1'')';
 if position(anchor in d)=0 then raise exception 'PARALLEL_ARCHIVE_VERSION_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,'''direct4-short-common-comparison-v1'',''jls-direct4-parallel-no-luna-v1'')');
end $$;
