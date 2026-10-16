-- Read-only RLS regression against the saved Garden execution. No mutation or wake.
begin;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
set local role authenticated;
do $test$ begin
 if (select count(*) from public.analysis_jls_contract_v2_operations where id='5022e80b-f7d0-4960-9f36-19fe22a1b898' and mode='paid' and status='completed')<>1 then raise exception 'OWNER_REPORT_NOT_VISIBLE';end if;
 if (select count(*) from public.analysis_jls_contract_v2_protocols where id='8484a2e8-ac56-4d16-abcf-964eeb15e5d5' and establishment_id='d40d3438-79d8-4c28-8b09-eba640598201')<>1 then raise exception 'OWNER_PROTOCOL_NOT_VISIBLE';end if;
 if has_table_privilege('authenticated','public.analysis_jls_contract_v2_operations','INSERT') or has_table_privilege('authenticated','public.analysis_jls_contract_v2_operations','UPDATE') then raise exception 'CLIENT_WRITE_PRIVILEGE';end if;
end $test$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $test$ begin
 if exists(select 1 from public.analysis_jls_contract_v2_operations where id='5022e80b-f7d0-4960-9f36-19fe22a1b898') then raise exception 'CROSS_TENANT_REPORT_VISIBLE';end if;
end $test$;
reset role;
rollback;
