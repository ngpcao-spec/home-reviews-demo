-- Conservative concurrency = one native JEV send per experiment. This is not a verified supplier quota.
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.jev_batch_claim(uuid,text)'::regprocedure);
 anchor='if t.status=''pending'' then';
 if position(anchor in d)=0 then raise exception 'BATCH_CLAIM_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,anchor||E'\n  if exists(select 1 from public.analysis_jev_batch_tasks where run_id=p_run and status=''reserved'' and lease_until>now()) then return null;end if;');
end $$;

