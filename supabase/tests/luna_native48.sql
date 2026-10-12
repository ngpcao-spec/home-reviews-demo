-- Harness sets home_reviews.native48_manifest in a transaction. All simulated jobs are rolled back.
-- NEVER call native48_wake from this test.
set local role service_role;
do $$declare m jsonb:=current_setting('home_reviews.native48_manifest')::jsonb;sha text;pid uuid;rid uuid;auth jsonb;task jsonb;worker uuid;bad boolean;n int;outcome jsonb;source jsonb;begin
 if current_user<>'service_role' then raise exception 'TEST_ROLE_REQUIRED';end if;
 source=public.native48_source_check();if jsonb_array_length(source->'cases')<>48 or jsonb_array_length(source->'references')<>48 then raise exception 'TEST_SEALED_COUNT';end if;
 if exists(select 1 from public.analysis_luna_native48_runs) then raise exception 'TEST_NO_REAL_EXECUTION_REQUIRED';end if;
 sha=encode(extensions.digest(public.jev_economy_canonical(m),'sha256'),'hex');
 pid=public.native48_save_plan('codex_admin',null,m,sha);if pid<>public.native48_save_plan('codex_admin',null,m,sha) then raise exception 'TEST_PLAN_IDEMPOTENCE';end if;
 if not exists(select 1 from public.analysis_luna_native48_plans where id=pid and created_by is null and actor_kind='codex_admin') then raise exception 'TEST_NO_FALSE_USER_ID';end if;
 bad=false;begin perform public.native48_save_plan('app_user',gen_random_uuid(),m,sha);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_TENANT_MEMBERSHIP';end if;
 auth=jsonb_build_object('consent_source','user_directive_codex_delegation','authorization_commit_sha','1b36499e81197d4ac0edc8cb9b7e6afa877214af','authorization_spec_sha256','a2c5ca649169884194cacbdc345b9faa70f82c4deb8d73a8e8e7ed2729f48386','operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),'scope',jsonb_build_object('set_id','a125ba0e-e4b0-49ca-83c8-1e52a27bd2be','seal_id','24883941-e3bc-4759-9af6-d21bd62413f9','protocol_version','luna-native-balanced48-run-v1','model','gpt-6-luna','endpoint','/v1/decisions','max_calls',48,'attempts_per_case',1,'automatic_retry',false));
 bad=false;begin perform public.native48_authorize_delegated(pid,sha,0,auth);exception when others then if sqlerrm='NATIVE48_DELEGATION_CHANGED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_COST_CONFIRMATION';end if;
 if exists(select 1 from public.analysis_luna_native48_runs) then raise exception 'TEST_NO_IMPLICIT_CONSENT';end if;
 rid=public.native48_authorize_delegated(pid,sha,(m->>'estimated_cost_usd')::numeric,auth);if rid<>public.native48_authorize_delegated(pid,sha,(m->>'estimated_cost_usd')::numeric,auth) then raise exception 'TEST_DUPLICATE_CONFIRMATION';end if;
 if (select count(*) from public.analysis_luna_native48_tasks where run_id=rid)<>48 or not exists(select 1 from public.analysis_luna_native48_tasks where run_id=rid and position=32) then raise exception 'TEST_NATIVE48_ALL_POSITIONS';end if;
 for n in 1..48 loop
  worker=gen_random_uuid();task=public.native48_claim(worker,rid);if task is null or task->>'request_count'<>'1' then raise exception 'TEST_RESERVATION';end if;
  if public.native48_finish((task->>'id')::uuid,gen_random_uuid(),'failed','{}') then raise exception 'TEST_WORKER_ISOLATION';end if;
  if not public.native48_finish((task->>'id')::uuid,worker,case when n=1 then 'billing_uncertain' else 'failed' end,jsonb_build_object('error_code','MOCK_NO_PROVIDER_CALLED','duration_ms',0)) then raise exception 'TEST_FINISH';end if;
  if public.native48_finish((task->>'id')::uuid,worker,'completed','{}') then raise exception 'TEST_NO_OVERWRITE';end if;
 end loop;
 if public.native48_claim(gen_random_uuid(),rid) is not null or (select sum(request_count) from public.analysis_luna_native48_tasks where run_id=rid)<>48 then raise exception 'TEST_MAX_48';end if;
 bad=false;begin update public.analysis_luna_native48_tasks set status='queued',request_count=0,worker_id=null where run_id=rid;exception when others then if sqlerrm='NATIVE48_NO_RETRY_OR_MUTATION' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_NO_RETRY';end if;
 outcome=jsonb_build_object('version','luna-native-balanced48-run-v1','independent_human_validation',false,'config_sha256',m->>'config_sha256','attempts',48);
 if not public.native48_complete(rid,outcome,encode(extensions.digest(public.jev_economy_canonical(outcome),'sha256'),'hex')) then raise exception 'TEST_COMPLETION';end if;
 bad=false;begin update public.analysis_luna_native48_results set body='{}' where run_id=rid;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_IMMUTABLE_RESULT';end if;
 if has_table_privilege('anon','public.analysis_luna_native48_runs','SELECT') or has_table_privilege('authenticated','public.analysis_luna_native48_tasks','INSERT') or has_function_privilege('authenticated','public.native48_authorize_delegated(uuid,text,numeric,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.native48_wake(uuid)','EXECUTE') then raise exception 'TEST_RLS_AND_PAID_RPC';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if not exists(select 1 from public.analysis_luna_native48_runs) then raise exception 'TEST_OWNER_READ';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_luna_native48_runs) or exists(select 1 from public.analysis_luna_native48_tasks) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
