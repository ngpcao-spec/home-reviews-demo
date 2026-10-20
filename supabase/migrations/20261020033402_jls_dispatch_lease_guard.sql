-- Fail closed for missing worker/lease as well as expired leases. Does not reset
-- any historical reservation or add a supplier retry.
do $$declare d text;f regprocedure;begin
 foreach f in array array['public.claim_jls_direct4_historical_task(uuid,text)'::regprocedure,'public.begin_jls_restaurant_dispatch(uuid,text,text)'::regprocedure] loop
  d=pg_get_functiondef(f);
  d=replace(d,'if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() then',
   'if p_worker is null or btrim(p_worker)='''' or r.lease_until is null or not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=clock_timestamp() then');
  d=replace(d,'if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=clock_timestamp() then',
   'if p_worker is null or btrim(p_worker)='''' or r.lease_until is null or not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=clock_timestamp() then');
  execute d;
 end loop;
end $$;
