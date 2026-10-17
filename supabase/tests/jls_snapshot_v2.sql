-- Free preparation only. No consent/run/task/authorization/wake, even in rollback.
begin;
set local role service_role;
do $test$ declare p public.analysis_jls_restaurant_protocols;a uuid;b uuid;begin
 select * into p from public.analysis_jls_restaurant_protocols where establishment_id='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8' order by created_at desc limit 1;
 if p.id is null or not public.check_jls_snapshot_v2_source(p.body) then raise exception 'SOURCE_MISSING';end if;
 if public.save_jls_snapshot_v2_protocol(p.body,p.sha256)<>p.id then raise exception 'PROTOCOL_NOT_IDEMPOTENT';end if;
 begin perform public.save_jls_snapshot_v2_protocol(jsonb_set(p.body,'{max_jev_calls}','81'),p.sha256);raise exception 'TEST_ACCEPTED_BAD_HASH';exception when others then if sqlerrm='TEST_ACCEPTED_BAD_HASH' then raise;end if;end;
 a=public.save_jls_snapshot_preparation(p.id,'explicit_sql_mock','{"explicit_technical_mock":true}',public.jls_restaurant_hash('{"explicit_technical_mock":true}'));
 b=public.save_jls_snapshot_preparation(p.id,'explicit_sql_mock','{"explicit_technical_mock":true}',public.jls_restaurant_hash('{"explicit_technical_mock":true}'));
 if a<>b then raise exception 'NOT_IDEMPOTENT';end if;
 begin update public.analysis_jls_snapshot_preparations set body='{}' where id=a;raise exception 'TEST_MUTABLE';exception when others then if sqlerrm='TEST_MUTABLE' then raise;end if;end;
 begin perform public.save_jls_snapshot_preparation(p.id,'explicit_sql_mock','{}',public.jls_restaurant_hash('{}'));raise exception 'TEST_REPLACED';exception when others then if sqlerrm='TEST_REPLACED' then raise;end if;end;
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=p.id) then raise exception 'UNAUTHORIZED_RUN_EXISTS';end if;
end $test$;
reset role;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
set local role authenticated;
do $test$ begin
 if (select count(*) from public.analysis_jls_restaurant_protocols where establishment_id='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8')<>1 then raise exception 'OWNER_PROTOCOL_HIDDEN';end if;
 if not exists(select 1 from public.analysis_jls_snapshot_preparations where kind='historical_archive') then raise exception 'OWNER_ARCHIVE_HIDDEN';end if;
 if has_table_privilege('authenticated','public.analysis_jls_snapshot_preparations','INSERT') or has_function_privilege('authenticated','public.authorize_jls_restaurant(uuid,jsonb,text)','EXECUTE') then raise exception 'CLIENT_WRITES_ALLOWED';end if;
end $test$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $test$ begin if exists(select 1 from public.analysis_jls_snapshot_preparations) then raise exception 'CROSS_TENANT_READ';end if;end $test$;
reset role;
rollback;
select 'snapshot V2 SQL/RLS and immutability: PASS; no paid rows' as result;
