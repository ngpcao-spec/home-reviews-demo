-- A previous comparison can also have an unresolved Sol attempt. A fresh
-- default-path click must not silently repeat it under a new source wrapper.
do $$declare d text;a text;b text;begin
 d=pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
 a='select 1 from public.report_generation_requests req join public.analysis_parallel_reports pair on pair.id=req.comparison_id join public.analysis_jls_sol_ready_operations op on op.run_id=pair.run_id
 where req.organization_id=p_organization and req.establishment_id=p_establishment and req.language=p_language';
 b='select 1 from public.analysis_parallel_reports pair join public.analysis_jls_sol_ready_operations op on op.run_id=pair.run_id
 where pair.organization_id=p_organization and pair.establishment_id=p_establishment and pair.language=p_language';
 if position(a in d)=0 then raise exception 'CURRENT_UNKNOWN_OUTCOME_GUARD_CHANGED';end if;execute replace(d,a,b);
end $$;
