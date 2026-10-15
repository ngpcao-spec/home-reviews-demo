-- Fixture is the real frozen preparation; this entire test MUST roll back.
-- No authorization/wake/provider command is invoked.
do $$declare c jsonb=current_setting('jls.prepared_fixture')::jsonb;a uuid;p uuid;again uuid;begin
 a=public.save_jls_restaurant_prepared_artifact(c->'artifact'->'body',c->'artifact'->>'sha256');
 p=public.save_jls_restaurant_protocol(c->'protocol'->'body',c->'protocol'->>'sha256');
 again=public.save_jls_restaurant_protocol(c->'protocol'->'body',c->'protocol'->>'sha256');
 if p<>again or not public.check_jls_restaurant_prepared_cache(p) then raise exception 'TEST_PREPARATION_INVALID';end if;
 perform set_config('jls.prepared_id',p::text,true);
 perform set_config('jls.prepared_user',c->'protocol'->'body'->>'authority_user_id',true);
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=p) then raise exception 'TEST_PAID_RUN_CREATED';end if;
 begin update public.analysis_jls_restaurant_prepared_artifacts set body='{}' where id=a;raise exception 'TEST_ARTIFACT_MUTABLE';exception when others then if sqlerrm='TEST_ARTIFACT_MUTABLE' then raise;end if;end;
 begin perform public.save_jls_restaurant_prepared_artifact(jsonb_set(c->'artifact'->'body','{plan,selected,0,quote}','"tampered"'),c->'artifact'->>'sha256');raise exception 'TEST_HASH_TAMPER_ACCEPTED';exception when others then if sqlerrm='TEST_HASH_TAMPER_ACCEPTED' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('jls.prepared_user'),'role','authenticated')::text,true);
do $$begin if not exists(select 1 from public.analysis_jls_restaurant_prepared_artifacts) then raise exception 'TEST_OWNER_CANNOT_READ';end if;
 begin perform public.check_jls_restaurant_prepared_cache(current_setting('jls.prepared_id')::uuid);raise exception 'TEST_BROWSER_EXECUTE';exception when insufficient_privilege then null;end;end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin if exists(select 1 from public.analysis_jls_restaurant_prepared_artifacts) then raise exception 'TEST_TENANT_LEAK';end if;end $$;
set local role anon;
do $$begin begin perform count(*) from public.analysis_jls_restaurant_prepared_artifacts;raise exception 'TEST_ANON_READ';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'prepared artifacts: source/hash/cache/idempotence/immutability/RLS/zero consent or run: PASS' checks;
