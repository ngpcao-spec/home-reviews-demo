-- All mock confirmations/tasks/responses are uncommitted and ROLLED BACK.
-- No Edge invocation, HTTP dispatch, supplier request or durable spending consent.
begin;
set local role service_role;
do $$ <<luna_negative_v2_launch>> declare manifest jsonb;sha text;plan_id uuid;mock_run_id uuid;duplicate_id uuid;worker uuid;task jsonb;raw jsonb;parsed jsonb;output jsonb;next_task jsonb;summary jsonb;
begin
 perform public.luna_nv2_launch_check('c8b3eee7-2554-43d9-a16b-5e12413af793','c4031dc6-e0a3-4992-bb35-f790ecccd034');
 -- A local test harness substitutes the verified manifest from the offline estimator.
 manifest:=current_setting('home_reviews.mock_nv2_manifest')::jsonb;
 sha:=encode(extensions.digest(public.jev_economy_canonical(manifest),'sha256'),'hex');
 plan_id:=public.luna_nv2_save_plan('d6e79d9c-72cd-40d2-a945-0452b268a783',manifest,sha);
 if public.luna_nv2_save_plan('d6e79d9c-72cd-40d2-a945-0452b268a783',manifest,sha)<>plan_id then raise exception 'PLAN_IDEMPOTENCE_FAILED';end if;
 begin perform public.luna_nv2_confirm('d6e79d9c-72cd-40d2-a945-0452b268a783',plan_id,sha,1,'luna-negative-v2-cost-confirmation-v1');raise exception 'COST_MISMATCH_ACCEPTED';exception when others then if sqlerrm<>'NEGATIVE_V2_CONFIRMATION_CHANGED' then raise;end if;end;
 begin perform public.luna_nv2_confirm('00000000-0000-4000-8000-000000000001',plan_id,sha,(manifest->>'estimated_cost_usd')::numeric,'luna-negative-v2-cost-confirmation-v1');raise exception 'WRONG_ROLE_ACCEPTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 mock_run_id:=public.luna_nv2_confirm('d6e79d9c-72cd-40d2-a945-0452b268a783',plan_id,sha,(manifest->>'estimated_cost_usd')::numeric,'luna-negative-v2-cost-confirmation-v1');
 duplicate_id:=public.luna_nv2_confirm('d6e79d9c-72cd-40d2-a945-0452b268a783',plan_id,sha,(manifest->>'estimated_cost_usd')::numeric,'luna-negative-v2-cost-confirmation-v1');
 if duplicate_id<>mock_run_id or (select count(*) from public.analysis_luna_negative_v2_tasks where run_id=luna_negative_v2_launch.mock_run_id)<>28 then raise exception 'DOUBLE_CONFIRMATION_CREATED_DUPLICATE';end if;
 for i in 1..28 loop
  worker:=gen_random_uuid();task:=public.luna_nv2_claim(worker,mock_run_id);
  if task is null or task->>'request_count'<>'1' or task->>'status'<>'dispatched' then raise exception 'RESERVATION_FAILED';end if;
  raw:=jsonb_build_object('model','gpt-6-luna','usage',jsonb_build_object('input_tokens',1000,'output_tokens',0,'total_tokens',1000),'answers',(select jsonb_agg(jsonb_build_object('name',q->>'name','type','choice','choice','supported','confidence',0.85,'probabilities',jsonb_build_array(jsonb_build_object('value','supported','probability',0.85),jsonb_build_object('value','unsupported','probability',0.1),jsonb_build_object('value','uncertain','probability',0.05)))) from jsonb_array_elements(task->'payload'->'questions')q));
  parsed:=jsonb_build_object('model','gpt-6-luna','usage',raw->'usage','observations',(select jsonb_agg(jsonb_build_object('review_id',task->>'review_id','theme_key',a->>'theme_key','choice','supported','native_choice','supported','confidence',0.85,'refused',false,'probabilities',jsonb_build_object('supported',0.85,'unsupported',0.1,'uncertain',0.05))) from public.analysis_luna_negative_v2_associations arow cross join lateral (select arow.body a) v where arow.set_id='c8b3eee7-2554-43d9-a16b-5e12413af793' and arow.review_id=(task->>'review_id')::uuid));
  output:=jsonb_build_object('response',raw,'response_sha256',encode(extensions.digest(public.jev_economy_canonical(raw),'sha256'),'hex'),'parsed',parsed,'served_model','gpt-6-luna','input_tokens',1000,'output_tokens',0,'usage_details',raw->'usage','cost_usd',0.0001,'duration_ms',7);
  if public.luna_nv2_finish((task->>'id')::uuid,gen_random_uuid(),'completed',output) then raise exception 'WRONG_WORKER_ACCEPTED';end if;
  if not public.luna_nv2_finish((task->>'id')::uuid,worker,'completed',output) then raise exception 'FINISH_FAILED';end if;
  if public.luna_nv2_finish((task->>'id')::uuid,worker,'completed',output) then raise exception 'RESPONSE_OVERWRITTEN';end if;
  begin update public.analysis_luna_negative_v2_tasks set status='queued',request_count=0,worker_id=null where id=(task->>'id')::uuid;raise exception 'PAID_RETRY_ACCEPTED';exception when others then if sqlerrm<>'NEGATIVE_V2_NO_RETRY_OR_MUTATION' then raise;end if;end;
 end loop;
 next_task:=public.luna_nv2_claim(gen_random_uuid(),mock_run_id);if next_task is not null then raise exception 'REQUEST_29_ACCEPTED';end if;
 if (select sum(request_count) from public.analysis_luna_negative_v2_tasks where run_id=luna_negative_v2_launch.mock_run_id)<>28 or (select count(*) from public.analysis_luna_negative_v2_results where run_id=luna_negative_v2_launch.mock_run_id)<>32 or (select sum(input_tokens) from public.analysis_luna_negative_v2_tasks where run_id=luna_negative_v2_launch.mock_run_id)<>28000 or (select sum(cost_usd) from public.analysis_luna_negative_v2_tasks where run_id=luna_negative_v2_launch.mock_run_id)<>0.0028 then raise exception 'GROUPED_USAGE_DOUBLE_COUNTED';end if;
 summary:='{"technical_mock_only":true}'::jsonb;
 if not public.luna_nv2_complete(mock_run_id,summary,encode(extensions.digest(public.jev_economy_canonical(summary),'sha256'),'hex')) then raise exception 'COMPLETION_FAILED';end if;
 if public.luna_nv2_claim(gen_random_uuid(),mock_run_id) is not null then raise exception 'TERMINAL_RUN_RELAUNCHED';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$begin if exists(select 1 from public.analysis_luna_negative_v2_runs) or exists(select 1 from public.analysis_luna_negative_v2_tasks) or exists(select 1 from public.analysis_luna_negative_v2_results) then raise exception 'CROSS_TENANT_READ';end if;end $$;
reset role;
do $$declare t text;begin foreach t in array array['analysis_luna_negative_v2_plans','analysis_luna_negative_v2_runs','analysis_luna_negative_v2_tasks','analysis_luna_negative_v2_events','analysis_luna_negative_v2_results']loop
 if has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('anon','public.'||t,'SELECT') then raise exception 'UNSAFE_PUBLIC_ACCESS';end if;
 if not exists(select 1 from pg_class where relname=t and relrowsecurity) then raise exception 'RLS_MISSING';end if;
 end loop;end $$;
rollback;
select 'LUNA_V2_MOCK_SQL_RLS_GROUPING_NO_RETRY_PASSED' status;
