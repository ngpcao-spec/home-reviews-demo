-- Initial preparation checks every source and request. Queueing may trust only
-- an exact, immutable server-certified preparation with the same intent binding.
-- This avoids hashing the repeated question bodies again inside the queue RPC.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.check_parallel_protocol(jsonb)'::regprocedure);
 a='and public.check_parallel_protocol_comparison(jsonb_set(b,''{production_enabled}'',''false''))';
 if position(a in d)=0 then raise exception 'CURRENT_SEALED_CHECK_ANCHOR_CHANGED';end if;
 execute replace(d,a,'and (exists(select 1 from public.analysis_parallel_launch_preparations sealed where sealed.current_source_run_id=(b#>>''{current_delivery,source_run_id}'')::uuid and sealed.authority_user_id=(b->>''authority_user_id'')::uuid and sealed.organization_id=(b->>''organization_id'')::uuid and sealed.body=b) or public.check_parallel_protocol_comparison(jsonb_set(b,''{production_enabled}'',''false'')))');
end $$;
