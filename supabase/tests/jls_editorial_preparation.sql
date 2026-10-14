-- Transactional test only: inject one offline artifact; always ROLLBACK.
set local role service_role;
do $$declare v jsonb;eid bigint;blocked boolean;begin
 v=current_setting('home_reviews.editorial_test_artifact')::jsonb;
 if has_function_privilege('authenticated','public.save_jls_editorial_preparation(jsonb,text)','execute') or
  has_function_privilege('anon','public.save_jls_editorial_preparation(jsonb,text)','execute') then raise exception 'CLIENT_WRITE_ENABLED';end if;
 if not (select relrowsecurity from pg_class where oid='public.analysis_jev_luna_sol_events'::regclass) then raise exception 'RLS_OFF';end if;
 eid=public.save_jls_editorial_preparation(v->'body',v->>'sha256');
 if public.save_jls_editorial_preparation(v->'body',v->>'sha256')<>eid then raise exception 'IDEMPOTENCE_FAILED';end if;
 blocked=false;begin perform public.save_jls_editorial_preparation(jsonb_set(v->'body','{execution_authorized}','true'),v->>'sha256');exception when others then blocked=true;end;
 if not blocked then raise exception 'SPENDING_ACCEPTED';end if;
 blocked=false;begin update public.analysis_jev_luna_sol_events set payload='{}' where id=eid;exception when others then blocked=true;end;
 if not blocked then raise exception 'UPDATE_ALLOWED';end if;
end $$;
select set_config('request.jwt.claim.sub',(select s.created_by::text from public.analysis_jev_pilot_snapshots s join public.analysis_jev_luna_sol_plans p on p.source_snapshot_id=s.id where p.id=(current_setting('home_reviews.editorial_test_artifact')::jsonb->'body'->>'source_plan_id')::uuid),true);
set local role authenticated;
do $$begin if not exists(select 1 from public.analysis_jev_luna_sol_events where action='prioritized_editorial_prepared_v1') then raise exception 'AUTHORIZED_READ_FAILED';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$begin if exists(select 1 from public.analysis_jev_luna_sol_events where action='prioritized_editorial_prepared_v1') then raise exception 'CROSS_ORG_READ';end if;end $$;
reset role;
select 'EDITORIAL_SQL_RLS_IMMUTABILITY_IDEMPOTENCE_OK' as test_result;
