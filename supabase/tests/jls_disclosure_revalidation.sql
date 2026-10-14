-- Run in a transaction and ROLLBACK, with a real offline replay payload injected.
-- No spending consent, paid job, claim, wake, or provider call.
set local role service_role;
do $$ declare rid uuid;payload jsonb;eid bigint;blocked boolean;before_status text;after_status text;begin
 payload=current_setting('home_reviews.revalidation_test_payload')::jsonb;rid=(payload->'body'->>'run_id')::uuid;
 select status into before_status from public.analysis_jls_prioritized_runs where id=rid;
 if not (select relrowsecurity from pg_class where oid='public.analysis_jls_prioritized_events'::regclass) then raise exception 'RLS_OFF';end if;
 if has_function_privilege('authenticated','public.save_jls_pri_revalidation(uuid,jsonb)','execute') or
  has_function_privilege('anon','public.save_jls_pri_revalidation(uuid,jsonb)','execute') or
  has_table_privilege('authenticated','public.analysis_jls_prioritized_events','insert') then raise exception 'CLIENT_WRITE_ENABLED';end if;
 eid=public.save_jls_pri_revalidation(rid,payload);
 if public.save_jls_pri_revalidation(rid,payload)<>eid then raise exception 'IDEMPOTENCE_FAILED';end if;
 if (select count(*) from public.analysis_jls_prioritized_events where run_id=rid and action='prioritized_fee_disclosure_revalidated_v1')<>1 then raise exception 'DUPLICATE';end if;
 blocked=false;begin perform public.save_jls_pri_revalidation(rid,jsonb_set(payload,'{body,original_result_sha256}',to_jsonb(repeat('0',64))));exception when others then blocked=true;end;
 if not blocked then raise exception 'SOURCE_CHANGE_ACCEPTED';end if;
 blocked=false;begin update public.analysis_jls_prioritized_events set payload='{}' where id=eid;exception when others then blocked=true;end;
 if not blocked then raise exception 'UPDATE_ALLOWED';end if;
 blocked=false;begin delete from public.analysis_jls_prioritized_events where id=eid;exception when others then blocked=true;end;
 if not blocked then raise exception 'DELETE_ALLOWED';end if;
 select status into after_status from public.analysis_jls_prioritized_runs where id=rid;
 if before_status is distinct from after_status then raise exception 'HISTORY_CHANGED';end if;
end $$;
-- Transactional mocked identity for RLS, never a borrowed browser session.
select set_config('request.jwt.claim.sub',(select organization_authority_user_id::text from public.analysis_jls_prioritized_runs where id=(current_setting('home_reviews.revalidation_test_payload')::jsonb->'body'->>'run_id')::uuid),true);
set local role authenticated;
do $$ begin if not exists(select 1 from public.analysis_jls_prioritized_events where action='prioritized_fee_disclosure_revalidated_v1') then raise exception 'AUTHORIZED_READ_FAILED';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ begin if exists(select 1 from public.analysis_jls_prioritized_events) then raise exception 'CROSS_ORG_READ';end if;end $$;
reset role;
select 'SQL_RLS_IDEMPOTENCE_IMMUTABILITY_OK' as test_result;
