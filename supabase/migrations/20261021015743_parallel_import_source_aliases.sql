do $$declare d text;begin
 select pg_get_functiondef('public.import_parallel_derivative(jsonb,text)'::regprocedure) into d;
 d=replace(d,'from public.analysis_jls_snapshot_preparations where id=(p_body->>''source_archive_id'')::uuid','from public.analysis_jls_snapshot_preparations s where s.id=(p_body->>''source_archive_id'')::uuid');
 d=replace(d,'from public.historical_establishment_reports where id=(p_body->>''reference_report_id'')::uuid','from public.historical_establishment_reports c where c.id=(p_body->>''reference_report_id'')::uuid');
 execute d;
end $$;
