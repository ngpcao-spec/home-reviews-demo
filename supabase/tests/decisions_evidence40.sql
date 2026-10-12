-- Explicit rollback-only authorization/task mocks; never visible to the scheduler.
-- Harness sets LOCAL home_reviews.test_manifest from the verified offline builder.
-- Match PostgREST's actual invoker role; do not mask missing privileges as postgres.
set local role service_role;
do $$declare m jsonb:=current_setting('home_reviews.test_manifest')::jsonb;u uuid;pid uuid;rid uuid;t jsonb;t2 jsonb;w uuid:=gen_random_uuid();bad boolean;sha text;
begin
 if current_user<>'service_role' or has_table_privilege('service_role','auth.users','select') then raise exception 'E40_TEST_INCORRECT_SERVER_ROLE';end if;
 select created_by into u from public.analysis_decisions_experiments where id=(m->>'experiment_id')::uuid;
 sha:=encode(extensions.digest(public.jev_economy_canonical(m),'sha256'),'hex');
 if exists(select 1 from public.analysis_decisions_evidence40_runs) or exists(select 1 from public.analysis_decisions_evidence40_tasks) then raise exception 'E40_TEST_MUST_START_EMPTY';end if;
 if has_table_privilege('authenticated','public.analysis_decisions_evidence40_runs','insert') or has_table_privilege('anon','public.analysis_decisions_evidence40_plans','select') or has_function_privilege('authenticated','public.evidence40_confirm(uuid,uuid,text,numeric,text)','execute') then raise exception 'E40_BAD_GRANTS';end if;
 pid:=public.evidence40_save_plan(u,m,sha);if public.evidence40_save_plan(u,m,sha)<>pid then raise exception 'E40_PLAN_NOT_IDEMPOTENT';end if;
 bad:=false;begin perform public.evidence40_save_plan('ffffffff-ffff-4fff-8fff-ffffffffffff',m,sha);exception when others then if sqlerrm='FORBIDDEN' then bad:=true;else raise;end if;end;if not bad then raise exception 'E40_CROSS_TENANT_ALLOWED';end if;
 bad:=false;begin perform public.evidence40_confirm(u,pid,sha,0,'evidence40-cost-confirmation-v1');exception when others then if sqlerrm='EVIDENCE40_CONFIRMATION_CHANGED' then bad:=true;else raise;end if;end;if not bad then raise exception 'E40_COST_NOT_CHECKED';end if;
 if exists(select 1 from public.analysis_decisions_evidence40_runs) then raise exception 'E40_FREE_PLAN_SPENT';end if;
 rid:=public.evidence40_confirm(u,pid,sha,(m->>'estimated_cost_usd')::numeric,'evidence40-cost-confirmation-v1');
 if public.evidence40_confirm(u,pid,sha,(m->>'estimated_cost_usd')::numeric,'evidence40-cost-confirmation-v1')<>rid or (select count(*) from public.analysis_decisions_evidence40_tasks where run_id=rid)<>40 then raise exception 'E40_DOUBLE_CLICK';end if;
 t:=public.evidence40_claim(w,rid);t2:=public.evidence40_claim(gen_random_uuid(),rid);if t->>'id'=t2->>'id' or t->>'request_count'<>'1' then raise exception 'E40_DOUBLE_DISPATCH';end if;
 if public.evidence40_finish((t->>'id')::uuid,gen_random_uuid(),'completed','{}') then raise exception 'E40_FOREIGN_WORKER';end if;
 if not public.evidence40_finish((t->>'id')::uuid,w,'billing_uncertain',jsonb_build_object('error_code','MOCK_TIMEOUT','duration_ms',5)) then raise exception 'E40_FINISH_FAILED';end if;
 if public.evidence40_finish((t->>'id')::uuid,w,'completed','{}') then raise exception 'E40_REPLAY_FINISH';end if;
 bad:=false;begin update public.analysis_decisions_evidence40_tasks set status='queued',request_count=0,worker_id=null where id=(t->>'id')::uuid;exception when others then if sqlerrm='EVIDENCE40_NO_RETRY_OR_MUTATION' then bad:=true;else raise;end if;end;if not bad then raise exception 'E40_PAID_RETRY_ALLOWED';end if;
 bad:=false;begin update public.analysis_decisions_evidence40_plans set manifest_sha256=repeat('0',64) where id=pid;exception when others then bad:=true;end;if not bad then raise exception 'E40_PLAN_MUTABLE';end if;
 perform public.evidence40_stop_unsent(rid,'MOCK_ACCESS_DENIED');
 perform public.evidence40_finish((t2->>'id')::uuid,(t2->>'worker_id')::uuid,'failed',jsonb_build_object('error_code','MOCK_403'));
 if public.evidence40_claim(gen_random_uuid(),rid) is not null then raise exception 'E40_RESTARTED_CANCELLED';end if;
 if not public.evidence40_complete(rid,'{"mock":true}',encode(extensions.digest(public.jev_economy_canonical('{"mock":true}'::jsonb),'sha256'),'hex')) then raise exception 'E40_COMPLETION_FAILED';end if;
 if (select status from public.analysis_decisions_evidence40_runs where id=rid)<>'billing_uncertain' then raise exception 'E40_UNCERTAIN_LOST';end if;
 bad:=false;begin update public.analysis_decisions_evidence40_runs set status='queued' where id=rid;exception when others then if sqlerrm='EVIDENCE40_RUN_TRANSITION' then bad:=true;else raise;end if;end;if not bad then raise exception 'E40_FINAL_MUTABLE';end if;
 if exists(select 1 from public.analysis_decisions_tasks) then raise exception 'E40_OLD_TABLE_CHANGED';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if (select count(*) from public.analysis_decisions_evidence40_plans)<>1 or (select count(*) from public.analysis_decisions_evidence40_tasks)<>40 then raise exception 'E40_OWNER_READ_FAILED';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_decisions_evidence40_plans) or exists(select 1 from public.analysis_decisions_evidence40_runs) or exists(select 1 from public.analysis_decisions_evidence40_tasks) or exists(select 1 from public.analysis_decisions_evidence40_events) then raise exception 'E40_CROSS_TENANT_LEAK';end if;end $$;
reset role;
