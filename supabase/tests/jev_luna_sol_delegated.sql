-- Explicit SQL mock only. Requires the free protocol; all writes rolled back. NEVER call jls_wake_delegated here.
begin;set local role service_role;
do $test$ declare p public.analysis_jev_luna_sol_plans;proto public.analysis_jev_luna_sol_protocols;a jsonb;rid uuid;again uuid;t jsonb;v jsonb;attempts int:=0;denied boolean:=false;begin
select * into p from public.analysis_jev_luna_sol_plans where id='5295245f-b2c1-4f5d-80ad-ca9f821ae3da';
select * into proto from public.analysis_jev_luna_sol_protocols where plan_id=p.id;
if public.jls_delegation_valid('11111111-1111-4111-8111-111111111111') is distinct from false then raise exception 'TEST_MISSING_CONSENT_FAILS_OPEN';end if;
a:=jsonb_build_object('version','jls-codex-delegated-pilot-v1','action','execute_luna_and_sol_once','execution_authorized',true,'sol_phase_authorized',true,'consent_source','user_directive_codex_delegation','protocol_sha256',proto.sha256,'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),'user_directive','EXPLICIT_TEST_MOCK: execute this single VI Luna and Sol trial; no actual authorization.','directive_sha256',encode(extensions.digest('EXPLICIT_TEST_MOCK: execute this single VI Luna and Sol trial; no actual authorization.','sha256'),'hex'),'requested_at',now(),'expires_at',now()+interval '24 hours','approved_estimates',p.body->'estimates','scope',jsonb_build_object('plan_id',p.id,'plan_sha256',p.result_sha256,'config_sha256',p.config_sha256,'dossier_sha256',p.dossier_sha256,'organization_id',p.organization_id,'max_luna_calls',24,'max_sol_calls',1,'question_count',25,'automatic_retry',false,'language','vi','luna_model','gpt-6-luna','luna_endpoint','/v1/decisions','sol_model','gpt-6.1-sol','sol_endpoint','/v1/responses'));
begin perform public.jls_authorize_delegated(p.id,proto.sha256,jsonb_set(a,'{action}','"prepare"'::jsonb));exception when others then denied:=sqlerrm='JLS_NEW_EXECUTION_DIRECTIVE_REQUIRED';end;
if not denied or (select count(*) from public.analysis_jev_luna_sol_runs)<>0 then raise exception 'TEST_PREPARATION_BECAME_CONSENT';end if;
denied:=false;begin perform public.jls_authorize_delegated(p.id,proto.sha256,jsonb_set(a,'{scope,max_luna_calls}','25'::jsonb));exception when others then denied:=sqlerrm='JLS_NEW_EXECUTION_DIRECTIVE_REQUIRED';end;
if not denied then raise exception 'TEST_SCOPE_NOT_ENFORCED';end if;
denied:=false;begin perform public.jls_authorize_delegated(p.id,proto.sha256,jsonb_set(a,'{expires_at}',to_jsonb(now()-interval '1 minute')));exception when others then denied:=sqlerrm='JLS_DELEGATION_EXPIRED';end;
if not denied then raise exception 'TEST_EXPIRATION_NOT_ENFORCED';end if;
rid:=public.jls_authorize_delegated(p.id,proto.sha256,a);again:=public.jls_authorize_delegated(p.id,proto.sha256,a);
if rid<>again or (select count(*) from public.analysis_jev_luna_sol_tasks where run_id=rid)<>24 or not public.jls_delegation_valid(rid) then raise exception 'TEST_DUPLICATE_OR_INVALID_RUN';end if;
if (select authorized_identity from public.analysis_jev_luna_sol_runs where id=rid) is not null then raise exception 'TEST_HUMAN_IMPERSONATION';end if;

-- Competing wakes cannot reserve more than eight simultaneous requests.
for attempts in 1..8 loop t:=public.claim_jls_task(rid,'explicit-mock-worker','luna');if t is null then raise exception 'TEST_RESERVATION_MISSING';end if;end loop;
if public.claim_jls_task(rid,'explicit-mock-worker','luna') is not null then raise exception 'TEST_CONCURRENCY_EXCEEDED';end if;
for attempts in 1..24 loop
if attempts<=8 then select to_jsonb(x) into t from public.analysis_jev_luna_sol_tasks x where run_id=rid and status='running' order by task_key limit 1;
else t:=public.claim_jls_task(rid,'explicit-mock-worker','luna');end if;
if t is null then raise exception 'TEST_RESERVATION_MISSING';end if;
declare raw jsonb;ds jsonb;sha text;begin
raw:=jsonb_build_object('model','gpt-6-luna','usage',jsonb_build_object('input_tokens',100,'output_tokens',0,'total_tokens',100),'answers',(select jsonb_agg(jsonb_build_object('name',q->>'name','type','choice','choice','supported','confidence',0.9,'probabilities',jsonb_build_array(jsonb_build_object('value','supported','probability',0.96),jsonb_build_object('value','unsupported','probability',0.02),jsonb_build_object('value','uncertain','probability',0.02)))) from jsonb_array_elements(t->'request'->'questions')q));
sha:=encode(extensions.digest(public.jev_economy_canonical(raw),'sha256'),'hex');
select jsonb_agg(jsonb_build_object('evidence_id',e->>'evidence_id','review_id',e->>'review_id','theme_key',e->>'theme_key','polarity',e->>'polarity','quote_sha256',e->>'quote_sha256','analysis_text_sha256',e->>'analysis_text_sha256','request_sha256',t->>'request_sha256','response_sha256',sha,'config_sha256',p.config_sha256,'served_model','gpt-6-luna','native_choice','supported','probabilities',jsonb_build_object('supported',0.96,'unsupported',0.02,'uncertain',0.02),'confidence',0.9,'refused',false,'status','ACCEPTED','provenance','luna_decisions_not_human_validation')) into ds from jsonb_array_elements(p.body->'selected')e where e->>'review_id'=t->>'review_id';
perform public.jls_finish_delegated((t->>'id')::uuid,'explicit-mock-worker','completed',jsonb_build_object('response',raw,'response_sha256',sha,'parsed',jsonb_build_object('decisions',ds),'served_model','gpt-6-luna','input_tokens',100,'output_tokens',0,'cost_usd',0.00001,'duration_ms',1,'provider_request_id','explicit_test_mock'));
end;
end loop;
if public.claim_jls_task(rid,'explicit-mock-worker','luna') is not null then raise exception 'TEST_25TH_LUNA';end if;
if public.jls_evidence_gate(rid)->>'passed'<>'true' then raise exception 'TEST_GATE_SHOULD_PASS';end if;
if (select sum(request_count) from public.analysis_jev_luna_sol_tasks where run_id=rid)<>24 or (select count(*) from public.analysis_jev_luna_sol_verdicts)<>25 then raise exception 'TEST_GROUPED_COUNTS';end if;
denied:=false;begin update public.analysis_jev_luna_sol_tasks set status='queued',request_count=0 where run_id=rid;exception when others then denied:=sqlerrm='JLS_NO_PAID_RETRY';end;
if not denied then raise exception 'TEST_RETRY_ALLOWED';end if;
denied:=false;begin update public.analysis_jev_luna_sol_runs set consent_record='{}'::jsonb where id=rid;exception when others then denied:=sqlerrm='JLS_AUTHORIZATION_IMMUTABLE';end;
if not denied then raise exception 'TEST_CONSENT_MUTABLE';end if;
-- A mock revised high estimate requires a new decision BEFORE any Sol reservation.
v:=p.body->'conditional_sol_preview';
v:=jsonb_set(v,'{packet,limitations,evidence_scope}','"accepted_only"'::jsonb);
v:=v||jsonb_build_object('statistics_sha256',p.statistics_sha256,'prompt_sha256',p.body->>'prompt_sha256','schema_sha256',p.body->>'schema_sha256','dossier_sha256',encode(extensions.digest(public.jev_economy_canonical(v->'packet'),'sha256'),'hex'));
v:=jsonb_set(v,'{request,input,1,content}',to_jsonb((v->'packet')::text));
v:=jsonb_set(v,'{estimates,high_estimated_cost_usd}',to_jsonb((p.body->'estimates'->'sol'->>'high_estimated_cost_usd')::numeric+1));
-- Evaluate the mutation before subqueries; SQL boolean operands have no evaluation order guarantee.
denied:=public.jls_freeze_sol(rid,v,encode(extensions.digest(public.jev_economy_canonical(v),'sha256'),'hex'));
if denied or
 (select status from public.analysis_jev_luna_sol_runs where id=rid)<>'cost_review_required' or
 exists(select 1 from public.analysis_jev_luna_sol_tasks where run_id=rid and phase='sol') then raise exception 'TEST_COST_REVIEW_BYPASSED';end if;
if has_function_privilege('authenticated','public.jls_authorize_delegated(uuid,text,jsonb)','execute') or has_function_privilege('anon','public.jls_wake_delegated(uuid)','execute') then raise exception 'TEST_RPC_PUBLIC';end if;
end $test$;
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$begin if exists(select 1 from public.analysis_jev_luna_sol_protocols) or exists(select 1 from public.analysis_jev_luna_sol_runs) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
reset role;
select 'JLS delegation SQL/RLS/signature/idempotence/24 grouped calls passed' as checked;
rollback;
