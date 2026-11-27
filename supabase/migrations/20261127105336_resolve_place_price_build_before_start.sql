begin;
set local lock_timeout='5s';

-- Leave historical attempts intact. The next worker records the exact build in its reservation.
alter table private.google_place_price_jobs alter column build set default 'unresolved';
alter table private.google_place_price_jobs add column previous_attempt jsonb;

do $migration$
declare
 definition text:=pg_get_functiondef('public.advance_google_place_price_job(uuid,text,text,jsonb)'::regprocedure);
 reserve_anchor text:=$sql$  update private.google_place_price_jobs set start_attempted_at=clock_timestamp(),attempts=1,request_input=p_data->'input' where id=j.id;$sql$;
 fail_anchor text:=$sql$   error_code=code,finished_at=clock_timestamp(),locked_by=null,lease_until=null where id=j.id;$sql$;
begin
 if (length(definition)-length(replace(definition,reserve_anchor,'')))/length(reserve_anchor)<>1
  or (length(definition)-length(replace(definition,fail_anchor,'')))/length(fail_anchor)<>1
 then raise exception 'PLACE_PRICE_PATCH_ANCHOR_MISMATCH'; end if;
 definition:=replace(definition,reserve_anchor,$sql$  if jsonb_typeof(p_data->'preflight') is distinct from 'object'
   or p_data#>>'{preflight,actor_id}' is distinct from 'nwua9Gu5YrADL7ZDj'
   or coalesce(p_data#>>'{preflight,build_number}','') !~ '^[0-9]+[.][0-9]+[.][0-9]+$'
   or coalesce(p_data#>>'{preflight,build_id}','') !~ '^[A-Za-z0-9]+$'
   or p_data#>'{preflight,max_total_charge_usd}' is distinct from '0.5'::jsonb
  then raise exception 'PLACE_PRICE_BUILD_RESERVATION_REQUIRED'; end if;
  update private.google_place_price_jobs set start_attempted_at=clock_timestamp(),attempts=1,request_input=p_data->'input',
   build=p_data#>>'{preflight,build_number}',receipt=jsonb_build_object('preflight',p_data->'preflight') where id=j.id;$sql$);
 definition:=replace(definition,fail_anchor,$sql$   error_code=code,finished_at=clock_timestamp(),locked_by=null,lease_until=null,
   receipt=case when p_data?'provider_failure' or p_data?'unbound_run_id'
    then coalesce(j.receipt,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
     'provider_failure',p_data->'provider_failure','unbound_run_id',p_data->>'unbound_run_id'))
    else j.receipt end where id=j.id;$sql$);
 execute definition;
end
$migration$;

comment on column private.google_place_price_jobs.previous_attempt is
 'Optional snapshot of the original failed attempt when an operator publishes a checked recovery.';
commit;
