-- Run after free preparation exists. Everything is rolled back. No HTTP or paid dispatch.
begin;
set local role service_role;
do $$declare p public.analysis_jev_luna_sol_plans;r uuid;blocked boolean:=false;begin
 select * into p from public.analysis_jev_luna_sol_plans where language='vi' limit 1;
 if p.id is null then raise exception 'TEST_FREE_PLAN_REQUIRED';end if;
 if public.save_jls_preparation(p.body,p.result_sha256)<>p.id then raise exception 'TEST_IDEMPOTENCE';end if;
 begin perform public.start_jls_run(p.id);exception when others then blocked:=sqlerrm='JLS_PAID_EXECUTION_DISABLED';end;
 if not blocked then raise exception 'TEST_START_OPEN';end if;
 blocked:=false;
 begin perform public.claim_jls_task(gen_random_uuid(),'test');exception when others then blocked:=sqlerrm='JLS_PAID_EXECUTION_DISABLED';end;
 if not blocked then raise exception 'TEST_CLAIM_OPEN';end if;
 begin update public.analysis_jev_luna_sol_plans set language='fr' where id=p.id;raise exception 'TEST_MUTABLE_PLAN';exception when others then if sqlerrm='TEST_MUTABLE_PLAN' then raise;end if;end;
 insert into public.analysis_jev_luna_sol_runs(organization_id,plan_id,max_luna_calls) values(p.organization_id,p.id,p.max_luna_calls) returning id into r;
 blocked:=false;
 begin update public.analysis_jev_luna_sol_runs set consent_source='user_directive_codex_delegation' where id=r;exception when others then blocked:=sqlerrm='JLS_PAID_EXECUTION_DISABLED';end;
 if not blocked then raise exception 'TEST_CONSENT_OPEN';end if;
 if has_function_privilege('authenticated','public.save_jls_preparation(jsonb,text)','execute') or has_function_privilege('anon','public.start_jls_run(uuid)','execute') then raise exception 'TEST_RPC_EXPOSURE';end if;
 if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind in('r','p') and relname like 'analysis_jev_luna_sol_%' and not relrowsecurity) then raise exception 'TEST_RLS_DISABLED';end if;
end $$;
reset role;
-- RLS simulation only, inside rollback; no user action or consent is impersonated.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select s.created_by from public.analysis_jev_pilot_snapshots s join public.analysis_jev_luna_sol_plans p on p.source_snapshot_id=s.id limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$begin if (select count(*) from public.analysis_jev_luna_sol_plans)<>2 then raise exception 'TEST_OWNER_CANNOT_READ';end if;end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$begin if exists(select 1 from public.analysis_jev_luna_sol_plans) then raise exception 'TEST_CROSS_ORG_LEAK';end if;end $$;
reset role;
select 'JLS SQL/RLS/idempotence/immutability/closed-consent passed' as result;
rollback;
