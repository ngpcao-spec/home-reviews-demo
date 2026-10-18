-- Run in BEGIN/ROLLBACK under service_role. No wake and no provider transport.
do $fn$
declare p uuid='3f6ab86c-7557-431b-9389-4fa85054a00e';e uuid;a uuid;r jsonb;parent uuid;i int;v jsonb;
 directive text=repeat('SYNTHETIC SQL ROLLBACK ONLY - NOT A REAL CONSENT. ',6)||' GO 3f6ab86c-7557-431b-9389-4fa85054a00e';
begin
 if not public.check_jev_targeted9(p) then raise exception 'TEST_FROZEN_SOURCE_FAILED';end if;
 begin perform public.authorize_jev_targeted9(p,null,null,null);raise exception 'TEST_ABSENT_GO_ACCEPTED';
 exception when others then if sqlerrm='TEST_ABSENT_GO_ACCEPTED' then raise;end if;end;
 e=public.authorize_jev_targeted9(p,directive,encode(extensions.digest(directive,'sha256'),'hex'),repeat('1',40));
 if e<>public.authorize_jev_targeted9(p,directive,encode(extensions.digest(directive,'sha256'),'hex'),repeat('1',40)) then raise exception 'TEST_SECOND_EXECUTION';end if;
 select protocol_id into parent from public.analysis_jls_snapshot_preparations where id=p;
 for i in 1..9 loop
 select body->'reviews'->(i-1) into r from public.analysis_jls_snapshot_preparations where id=p;
 if i=1 then
 select body->'reviews'->1 into v from public.analysis_jls_snapshot_preparations where id=p;
 if public.reserve_jev_targeted9(e,(v->>'id')::uuid,v->>'request_sha256','sql_parallel_worker') is not null then raise exception 'TEST_SEQUENCE';end if;
 end if;
 a=public.reserve_jev_targeted9(e,(r->>'id')::uuid,r->>'request_sha256','sql_mock_worker');
 if a is null or public.reserve_jev_targeted9(e,(r->>'id')::uuid,r->>'request_sha256','sql_other_worker') is not null then raise exception 'TEST_DUPLICATE_ATTEMPT';end if;
 -- A lost response remains consumed; no lease expiry can make it dispatchable again.
 if public.reserve_jev_targeted9(e,(r->>'id')::uuid,r->>'request_sha256','sql_lost_response') is not null then raise exception 'TEST_UNCERTAIN_RETRY';end if;
 v=jsonb_build_object('explicit_sql_mock',true,'execution_id',e,'review_id',r->>'id');
 perform public.save_jls_snapshot_preparation(parent,'jev_targeted9_result_'||lpad(i::text,2,'0'),v,public.jls_restaurant_hash(v));
 end loop;
 if (select count(*) from public.analysis_jls_snapshot_preparations where protocol_id=parent and kind like 'jev_targeted9_attempt_%')<>9 then raise exception 'TEST_CALL_LIMIT';end if;
 begin update public.analysis_jls_snapshot_preparations set body='{}' where id=e;raise exception 'TEST_HISTORY_MUTABLE';
 exception when others then if sqlerrm='TEST_HISTORY_MUTABLE' then raise;end if;end;
 if has_function_privilege('authenticated','public.authorize_jev_targeted9(uuid,text,text,text)','execute')
 or has_function_privilege('anon','public.reserve_jev_targeted9(uuid,uuid,text,text)','execute')
 or has_table_privilege('authenticated','public.analysis_jls_snapshot_preparations','INSERT') then raise exception 'TEST_ACCESS_GRANTS';end if;
end $fn$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $fn$begin if exists(select 1 from public.analysis_jls_snapshot_preparations) then raise exception 'TEST_ORGANIZATION_ISOLATION';end if;end $fn$;
reset role;
