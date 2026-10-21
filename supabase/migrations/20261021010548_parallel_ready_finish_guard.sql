-- Admit only terminal validation of an already received Sol response for the
-- new version. Preserve the exact existing one-attempt and immutable-field guards.
do $$declare d text;begin
 select pg_get_functiondef('public.jls_restaurant_state_guard()'::regprocedure) into d;
 d=replace(d,'''jls-direct4-no-luna-candidates-v1''','''jls-direct4-no-luna-candidates-v1'',''jls-direct4-parallel-no-luna-v1''');
 execute d;
end $$;
