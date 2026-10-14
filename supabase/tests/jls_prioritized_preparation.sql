-- Run inside BEGIN/ROLLBACK after the migration and a free synthetic/preparation
-- artifact have been inserted. This script creates no consent, run or task.
do $$ begin
 if has_function_privilege('authenticated','public.save_jls_prioritized_preparation(jsonb,text)','execute') or
    has_function_privilege('anon','public.save_jls_prioritized_preparation(jsonb,text)','execute') then raise exception 'PUBLIC_WRITE_PERMISSION'; end if;
 if not exists(select 1 from pg_indexes where indexname='jls_prioritized_preparation_identity') then raise exception 'IDEMPOTENCE_INDEX_MISSING'; end if;
 if not (select relrowsecurity from pg_class where oid='public.analysis_jev_luna_sol_events'::regclass) then raise exception 'RLS_MISSING'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.analysis_jev_luna_sol_events'::regclass and not tgisinternal) then raise exception 'IMMUTABILITY_TRIGGER_MISSING'; end if;
end $$;
set local role service_role;
do $$ declare e public.analysis_jev_luna_sol_events; x bigint; protected boolean=false; begin
 select * into e from public.analysis_jev_luna_sol_events where action='prioritized_report_format_prepared_v1' limit 1;
 if e.id is null then raise exception 'FREE_PREPARATION_TEST_FIXTURE_REQUIRED'; end if;
 x=public.save_jls_prioritized_preparation(e.payload->'body',e.payload->>'sha256');
 if x<>e.id then raise exception 'IDEMPOTENCE_FAILED'; end if;
 begin update public.analysis_jev_luna_sol_events set payload='{}' where id=e.id;
 exception when others then if sqlerrm not like '%IMMUTABLE%' then raise; end if; protected=true; end;
 if not protected then raise exception 'UPDATE_NOT_BLOCKED'; end if;
 protected=false;
 begin perform public.save_jls_prioritized_preparation(jsonb_set(e.payload->'body','{draft,paid_enabled}','true'),e.payload->>'sha256');
 exception when others then if sqlerrm<>'JLS_PRIORITIZED_PREPARATION_CHANGED' then raise; end if; protected=true; end;
 if not protected then raise exception 'TAMPER_NOT_BLOCKED'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.analysis_jev_luna_sol_events where action='prioritized_report_format_prepared_v1') then raise exception 'CROSS_TENANT_READ'; end if;
end $$;
reset role;
