-- Remove an unused PL/pgSQL variable that shadowed the JSON table alias.
do $$declare d text;begin
 d=pg_get_functiondef('public.check_jls_direct4_partial_sources(jsonb)'::regprocedure);
 if position('x jsonb;y jsonb;original jsonb;' in d)=0 then raise exception 'PARTIAL_ALIAS_EXPECTED_BODY_NOT_FOUND';end if;
 execute replace(d,'x jsonb;y jsonb;original jsonb;','x jsonb;original jsonb;');
end $$;
