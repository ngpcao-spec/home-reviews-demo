-- The shared qualification must never create a paid Sol operation.
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.prepare_parallel_ready(uuid,text,jsonb,text)'::regprocedure);
 anchor='r.organization_id,''paid'',''sol'',''queued''';
 if position(anchor in d)=0 then raise exception 'PARALLEL_MOCK_SOL_MODE_ANCHOR_CHANGED';end if;
 d=replace(d,anchor,'r.organization_id,case when public.is_jls_sql_qualification(r.id) then ''mock'' else ''paid'' end,''sol'',''queued''');
 execute d;
end $$;
alter function public.prepare_parallel_ready(uuid,text,jsonb,text) set jit='off';
alter function public.claim_jls_restaurant_tick(uuid,text) set jit='off';
