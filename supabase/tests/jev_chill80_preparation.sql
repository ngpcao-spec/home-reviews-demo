-- Read-only/rolled-back preparation checks. Never create consent or a paid run.
begin;
set local role service_role;
do $fn$
declare p public.analysis_jls_snapshot_preparations;again uuid;begin
 select * into p from public.analysis_jls_snapshot_preparations where kind='jev_chill_reanalysis80_protocol_v1';
 if p.id is null or not public.check_jev_chill80(p.id) then raise exception 'TEST_SOURCE_OR_NINE_REUSES_INCOMPATIBLE';end if;
 again=public.save_jev_chill80_protocol(p.body,p.sha256);if again<>p.id then raise exception 'TEST_PREPARATION_IDEMPOTENCE';end if;
 if p.body->'run_id'<>'null'::jsonb or p.body->'spending_authorization'<>'null'::jsonb or p.body->>'supplier_calls'<>'0'
 or jsonb_array_length(p.body->'reused')<>9 or jsonb_array_length(p.body->'pending')<>71 then raise exception 'TEST_PREPARATION_SCOPE';end if;
 begin perform public.authorize_jev_chill80(p.id,null,null,null);raise exception 'TEST_ABSENT_GO_ACCEPTED';
 exception when others then if sqlerrm='TEST_ABSENT_GO_ACCEPTED' then raise;end if;end;
 begin perform public.reserve_jev_chill80('00000000-0000-4000-8000-000000000000','00000000-0000-4000-8000-000000000000','invalid','mock_worker');raise exception 'TEST_WITHOUT_RUN_RESERVED';
 exception when others then if sqlerrm='TEST_WITHOUT_RUN_RESERVED' then raise;end if;end;
 begin perform public.wake_jev_chill80(p.id);raise exception 'TEST_PREPARATION_WOKE_WORKER';
 exception when others then if sqlerrm='TEST_PREPARATION_WOKE_WORKER' then raise;end if;end;
 begin update public.analysis_jls_snapshot_preparations set body='{}' where id=p.id;raise exception 'TEST_PROTOCOL_MUTABLE';
 exception when others then if sqlerrm='TEST_PROTOCOL_MUTABLE' then raise;end if;end;
 if exists(select 1 from public.analysis_jls_snapshot_preparations where kind like 'jev_chill80_%') then raise exception 'TEST_UNEXPECTED_EXECUTION';end if;
 if has_function_privilege('authenticated','public.authorize_jev_chill80(uuid,text,text,text)','execute')
 or has_function_privilege('anon','public.wake_jev_chill80(uuid)','execute')
 or has_table_privilege('authenticated','public.analysis_jls_snapshot_preparations','INSERT') then raise exception 'TEST_SERVER_ONLY_WRITES';end if;
end $fn$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $fn$begin if exists(select 1 from public.analysis_jls_snapshot_preparations where kind='jev_chill_reanalysis80_protocol_v1') then raise exception 'TEST_CROSS_ORGANIZATION_READ';end if;end $fn$;
reset role;
rollback;
select 'SQL_PREPARATION_TESTS_PASSED_NO_CONSENT_NO_RUN' status;
