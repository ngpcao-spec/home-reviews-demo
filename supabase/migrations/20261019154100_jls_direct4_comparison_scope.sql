-- Scope aliases must not conflict with row variables in the reused PL/pgSQL RPCs.
do $$declare d text;f text;old_scope text;new_scope text;begin
 old_scope='exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id where r.id=p_run and p.body->>''version''=''jls-direct4-synthesis-comparison-v1'')';
 new_scope='exists(select 1 from public.analysis_jls_restaurant_runs scope_run_cmp join public.analysis_jls_restaurant_protocols scope_protocol_cmp on scope_protocol_cmp.id=scope_run_cmp.protocol_id where scope_run_cmp.id=p_run and scope_protocol_cmp.body->>''version''=''jls-direct4-synthesis-comparison-v1'')';
 foreach f in array array['public.claim_jls_restaurant_task(uuid,text)','public.stage_jls_restaurant(uuid,text,text,jsonb)'] loop
 d=pg_get_functiondef(f::regprocedure);execute replace(d,old_scope,new_scope);end loop;
end $$;
