-- Explicit transaction / rollback only. Never authorize, wake or dispatch.
-- Set jls.resume_fixture to a verified preparation body before running.
do $$declare b jsonb=current_setting('jls.resume_fixture')::jsonb; p uuid; again uuid; bad jsonb; begin
 p=public.save_jls_restaurant_protocol(b,public.jls_restaurant_hash(b));
 again=public.save_jls_restaurant_protocol(b,public.jls_restaurant_hash(b));
 if p<>again then raise exception 'TEST_RESTART_DUPLICATED';end if;
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=p) then raise exception 'TEST_UNAUTHORIZED_RUN';end if;
 if (select status from public.analysis_jls_restaurant_runs where id=(b->'resume'->>'source_run_id')::uuid)<>'blocked' then raise exception 'TEST_OLD_RUN_REOPENED';end if;
 bad=jsonb_set(b,'{resume,conditional_sol,measurement,guarded_input_tokens}','32769');
 begin perform public.save_jls_restaurant_protocol(bad,public.jls_restaurant_hash(bad));raise exception 'TEST_OVERSIZE_ACCEPTED';exception when others then if sqlerrm='TEST_OVERSIZE_ACCEPTED' then raise;end if;end;
 bad=b-'sol_size_policy';
 begin perform public.save_jls_restaurant_protocol(bad,public.jls_restaurant_hash(bad));raise exception 'TEST_POLICY_MISSING_ACCEPTED';exception when others then if sqlerrm='TEST_POLICY_MISSING_ACCEPTED' then raise;end if;end;
end $$;
select 'restart preflight, source hashes, bounded policy, immutable stopped run, no consent or task, idempotence: PASS' checks;
