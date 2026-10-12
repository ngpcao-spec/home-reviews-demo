-- Entirely transactional simulation. No provider request or committed paid job.
begin;
set local role service_role;
do $$declare s public.analysis_luna_multirest_sets;ref public.analysis_luna_multirest_reference_seals;m jsonb;sha text;pid uuid;rid uuid;tid jsonb;worker uuid;bad boolean;n int;outcome jsonb;begin
 select * into s from public.analysis_luna_multirest_sets where id='929bef2d-e841-43e0-a055-3d924d5f88b2';
 select * into ref from public.analysis_luna_multirest_reference_seals where id='44f489ae-6f7f-4e9d-8c2f-ae6cfc955d7a';
 perform public.luna_multi_launch_check(s.id,ref.id);
 if exists(select 1 from public.analysis_luna_multirest_runs) then raise exception 'TEST_REQUIRES_NO_REAL_RUN';end if;
 m=jsonb_build_object('version','luna-multirest-manual-run-v1','set_id',s.id,'seal_id',ref.id,'organization_id',s.organization_id,'dataset_sha256',s.body_sha256,'reference_sha256',ref.reference_sha256,'config_sha256',s.config_sha256,'configuration_id','luna-multirest-evidence-choice-v1','model','gpt-6-luna','endpoint','/v1/decisions','max_calls',39,'repeat_count',1,'automatic_retry',false,'production_enabled',false,'estimated_input_tokens',s.body->'estimated_input_tokens','estimated_cost_usd',s.body->'estimated_cost_usd','input_rate_per_million',0.1,'excluded',(select jsonb_agg(jsonb_build_object('position',(c->>'position')::int,'review_id',c->>'review_id','reason','FROZEN_MULTILINGUAL_TEXT','analysis_text_sha256',c->>'analysis_text_sha256')) from jsonb_array_elements(s.body->'cases') c where c->>'position'='32'),'cases',(select jsonb_agg(jsonb_build_object('position',(c->>'position')::int,'review_id',c->>'review_id','establishment_id',c->>'establishment_id','theme_key',c->'candidate'->>'theme_key','polarity',c->'candidate'->>'polarity','analysis_text_sha256',c->>'analysis_text_sha256','case_sha256',c->>'case_sha256','request_sha256',c->>'request_sha256','payload',c->'payload') order by (c->>'position')::int) from jsonb_array_elements(s.body->'cases') c where c->>'evaluation_eligible'='true'));
 sha=encode(extensions.digest(public.jev_economy_canonical(m),'sha256'),'hex');if sha<>'91ea29ff17b8126708b03dbacd11a43b88a4c9cf6ed08af00164842099c332fa' then raise exception 'TEST_MANIFEST_NOT_IDENTICAL';end if;
 bad=false;begin perform public.luna_multi_save_plan(gen_random_uuid(),m,sha);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_ROLE';end if;
 pid=public.luna_multi_save_plan(s.created_by,m,sha);if pid<>public.luna_multi_save_plan(s.created_by,m,sha) then raise exception 'TEST_PLAN_IDEMPOTENCE';end if;
 bad=false;begin update public.analysis_luna_multirest_plans set manifest='{}' where id=pid;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_PLAN_IMMUTABILITY';end if;
 bad=false;begin perform public.luna_multi_confirm(s.created_by,pid,sha,0,'luna-multirest-cost-confirmation-v1');exception when others then if sqlerrm='MULTIREST_CONFIRMATION_CHANGED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_COST_CONSENT';end if;
 if exists(select 1 from public.analysis_luna_multirest_runs) then raise exception 'TEST_NO_IMPLICIT_RUN';end if;
 rid=public.luna_multi_confirm(s.created_by,pid,sha,(m->>'estimated_cost_usd')::numeric,'luna-multirest-cost-confirmation-v1');if rid<>public.luna_multi_confirm(s.created_by,pid,sha,(m->>'estimated_cost_usd')::numeric,'luna-multirest-cost-confirmation-v1') then raise exception 'TEST_DOUBLE_TAP';end if;
 if (select count(*) from public.analysis_luna_multirest_tasks where run_id=rid)<>39 or exists(select 1 from public.analysis_luna_multirest_tasks where run_id=rid and position=32) then raise exception 'TEST_SCOPE_39';end if;
 for n in 1..39 loop
  worker=gen_random_uuid();tid=public.luna_multi_claim(worker,rid);if tid is null or tid->>'request_count'<>'1' then raise exception 'TEST_ATOMIC_RESERVATION';end if;
  if public.luna_multi_finish((tid->>'id')::uuid,gen_random_uuid(),'failed','{}') then raise exception 'TEST_WORKER_ID';end if;
  if not public.luna_multi_finish((tid->>'id')::uuid,worker,case when n=1 then 'billing_uncertain' else 'failed' end,jsonb_build_object('error_code','MOCK_NO_PROVIDER_CALLED','duration_ms',0)) then raise exception 'TEST_FINISH';end if;
  if public.luna_multi_finish((tid->>'id')::uuid,worker,'completed','{}') then raise exception 'TEST_NO_OVERWRITE';end if;
 end loop;
 if public.luna_multi_claim(gen_random_uuid(),rid) is not null or (select sum(request_count) from public.analysis_luna_multirest_tasks where run_id=rid)<>39 then raise exception 'TEST_MAX_39';end if;
 if (select count(*) from public.analysis_luna_multirest_results where set_id=s.id)<>39 then raise exception 'TEST_APPEND_RESULTS';end if;
 bad=false;begin update public.analysis_luna_multirest_tasks set status='queued',request_count=0,worker_id=null where run_id=rid;exception when others then if sqlerrm='MULTIREST_NO_RETRY_OR_MUTATION' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_NO_RETRY';end if;
 outcome=jsonb_build_object('reference_type',s.body->>'reference_type','independent_human_validation',false,'execution',jsonb_build_object('version','luna-multirest-manual-run-v1','max_calls',39,'attempts',39));
 if not public.luna_multi_complete(rid,outcome,encode(extensions.digest(public.jev_economy_canonical(outcome),'sha256'),'hex')) then raise exception 'TEST_COMPLETE';end if;
 if not exists(select 1 from public.analysis_luna_multirest_runs where id=rid and status='billing_uncertain') then raise exception 'TEST_BILLING_UNCERTAIN_TERMINAL';end if;
 if has_table_privilege('anon','public.analysis_luna_multirest_runs','SELECT') or has_table_privilege('authenticated','public.analysis_luna_multirest_runs','INSERT') or has_function_privilege('authenticated','public.luna_multi_confirm(uuid,uuid,text,numeric,text)','EXECUTE') then raise exception 'TEST_RLS_PRIVILEGES';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if not exists(select 1 from public.analysis_luna_multirest_runs) then raise exception 'TEST_OWNER_READ';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_luna_multirest_runs) or exists(select 1 from public.analysis_luna_multirest_tasks) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
rollback;
