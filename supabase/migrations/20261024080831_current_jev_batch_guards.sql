-- Qualify the SQL row alias separately from the PL/pgSQL loop variable.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.jev_batch_create_current(uuid,jsonb,text)'::regprocedure);
 a='select r,q.organization_id,(b->>''number'')::int,(b->>''reviews'')::int,b->>''request_wire'',b->>''request_sha256'',b->''mapping'',b->''preflight'' from jsonb_array_elements(p_manifest->''plans'') b;';
 if position(a in d)=0 then raise exception 'CURRENT_BATCH_INSERT_ALIAS_CHANGED';end if;
 execute replace(d,a,'select r,q.organization_id,(pb.value->>''number'')::int,(pb.value->>''reviews'')::int,pb.value->>''request_wire'',pb.value->>''request_sha256'',pb.value->''mapping'',pb.value->''preflight'' from jsonb_array_elements(p_manifest->''plans'') pb(value);');
end $$;
