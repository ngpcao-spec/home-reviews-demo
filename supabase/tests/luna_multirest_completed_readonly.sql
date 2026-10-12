-- Read-only audit of the existing completed run. Never confirms or dispatches a task.
begin read only;
set local role service_role;
do $$declare r public.analysis_luna_multirest_runs;begin
 perform public.luna_multi_launch_check('929bef2d-e841-43e0-a055-3d924d5f88b2','44f489ae-6f7f-4e9d-8c2f-ae6cfc955d7a');
 select * into r from public.analysis_luna_multirest_runs where id='d7aa0bbf-dab4-4366-b3d4-e392f2e75999';
 if r.id is null or r.status<>'completed' or r.max_calls<>39 or r.automatic_retry or r.consent_version<>'luna-multirest-cost-confirmation-v1' or r.result_sha256<>encode(extensions.digest(public.jev_economy_canonical(r.result),'sha256'),'hex') then raise exception 'TEST_COMPLETED_RUN_INTEGRITY';end if;
 if not exists(select 1 from public.analysis_luna_multirest_events where run_id=r.id and event='manual_cost_confirmed' and body->>'user_id'=r.confirmed_by::text and body->>'max_calls'='39') then raise exception 'TEST_MANUAL_CONFIRMATION';end if;
 if (select count(*) from public.analysis_luna_multirest_tasks where run_id=r.id)<>39 or exists(select 1 from public.analysis_luna_multirest_tasks where run_id=r.id and (position=32 or request_count<>1 or status<>'completed' or request_sha256<>encode(extensions.digest(public.jev_economy_canonical(payload),'sha256'),'hex') or response_sha256<>encode(extensions.digest(public.jev_economy_canonical(response),'sha256'),'hex'))) then raise exception 'TEST_TASK_INTEGRITY';end if;
 if not exists(select 1 from public.analysis_luna_multirest_cases where set_id='929bef2d-e841-43e0-a055-3d924d5f88b2' and position=32 and body->>'evaluation_eligible'='false') then raise exception 'TEST_CASE32_NOT_EXCLUDED';end if;
 if has_function_privilege('authenticated','public.luna_multi_confirm(uuid,uuid,text,numeric,text)','EXECUTE') or has_table_privilege('authenticated','public.analysis_luna_multirest_tasks','UPDATE') or has_table_privilege('anon','public.analysis_luna_multirest_tasks','SELECT') then raise exception 'TEST_PRIVILEGES';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if not exists(select 1 from public.analysis_luna_multirest_runs where id='d7aa0bbf-dab4-4366-b3d4-e392f2e75999') then raise exception 'TEST_OWNER_READ';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_luna_multirest_runs) or exists(select 1 from public.analysis_luna_multirest_tasks) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
rollback;
