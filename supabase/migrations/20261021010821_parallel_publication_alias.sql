do $$declare d text;begin
 select pg_get_functiondef('public.publish_parallel_report(uuid)'::regprocedure) into d;
 d=replace(d,'a public.analysis_jls_sol_ready_artifacts','ready_row public.analysis_jls_sol_ready_artifacts');
 d=replace(d,'select * into a from public.analysis_jls_sol_ready_artifacts','select * into ready_row from public.analysis_jls_sol_ready_artifacts');
 d=replace(d,'''evidence'',a.body->''evidence''),statistics=a.body->''statistics''','''evidence'',ready_row.body->''evidence''),statistics=ready_row.body->''statistics''');
 execute d;
end $$;
