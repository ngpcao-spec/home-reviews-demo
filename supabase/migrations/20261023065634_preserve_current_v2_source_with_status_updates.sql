-- The current V2 wrapper is a frozen corpus plus an operational status, not a
-- historical Sol result. Only its status/lease fields may advance after sealing.
-- All source, identity, model, usage and report fields remain immutable. Legacy
-- historical results and every other certified source keep their full guard.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.guard_jls_certified_source()'::regprocedure);
 a=' if exists(select 1 from public.analysis_jls_source_certificate_refs where source_table=tg_table_name and source_id=old.id)';
 if position(a in d)=0 then raise exception 'CURRENT_SOURCE_GUARD_ANCHOR_CHANGED';end if;
 execute replace(d,a,' if tg_table_name=''historical_report_runs'' and tg_op=''UPDATE''
 and exists(select 1 from public.report_generation_requests q where q.source_run_id=old.id and q.engine=''jev_sol_v2'')
 and (to_jsonb(new)-array[''status'',''locked_by'',''lease_until'',''updated_at'',''completed_at'',''error_code'',''last_error''])=(to_jsonb(old)-array[''status'',''locked_by'',''lease_until'',''updated_at'',''completed_at'',''error_code'',''last_error'']) then return new;end if;'||a);
end $$;
