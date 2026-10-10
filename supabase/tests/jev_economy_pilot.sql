-- Rollback-only SQL/RLS tests. No HTTP calls; all mock tasks/cache rows are rolled back.
begin;
do $$
declare s public.analysis_jev_pilot_snapshots;actor uuid;bad boolean;rid uuid;jid uuid;wid uuid:=gen_random_uuid();aid uuid;claimed jsonb;t public.analysis_jev_pilot_tasks;resp jsonb;th jsonb;sid2 uuid;v text;
begin
 select * into s from public.analysis_jev_pilot_snapshots order by created_at desc limit 1;
 if not found then raise exception 'TEST_FREE_SNAPSHOT_REQUIRED';end if;actor=s.created_by;
 if exists(select 1 from public.analysis_jev_pilot_authorizations) or exists(select 1 from public.analysis_jev_pilot_jobs) then raise exception 'TEST_EXPECTED_PREPARATION_ONLY';end if;
 foreach v in array array['analysis_jev_pilot_snapshots','analysis_jev_pilot_authorizations','analysis_jev_pilot_jobs','analysis_jev_pilot_tasks','analysis_jev_pilot_events'] loop
 if not exists(select 1 from pg_class where oid=('public.'||v)::regclass and relrowsecurity) or has_table_privilege('anon','public.'||v,'select') or has_table_privilege('authenticated','public.'||v,'insert') then raise exception 'TEST_RLS_PRIVILEGES';end if;end loop;
 if has_function_privilege('authenticated','public.start_economy_pilot_job(uuid,uuid,text,text,text,jsonb,boolean)','execute') then raise exception 'TEST_RPC_NOT_PRIVATE';end if;
 if public.claim_economy_pilot_job(wid) is not null then raise exception 'TEST_EMPTY_WORKER';end if;
 sid2=public.create_economy_pilot_snapshot(actor,s.organization_id,s.establishment_id,s.source,s.source_sha256,s.config_sha256,s.rates,s.preview_at_creation);if sid2<>s.id then raise exception 'TEST_SNAPSHOT_IDEMPOTENCE';end if;
 bad=false;begin update public.analysis_jev_pilot_snapshots set name='changed' where id=s.id;exception when others then if sqlerrm='PILOT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_SNAPSHOT_IMMUTABLE';end if;
 bad=false;begin perform public.create_economy_pilot_snapshot(gen_random_uuid(),s.organization_id,s.establishment_id,s.source,s.source_sha256,s.config_sha256,s.rates,s.preview_at_creation);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_CROSS_TENANT';end if;
 bad=false;begin perform public.start_economy_pilot_job(actor,s.id,'jev','en',repeat('a',64),'{}',true);exception when others then if sqlerrm='PILOT_NEW_AUTHORIZATION_REQUIRED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_PAYMENT_GATE';end if;
 select (x->>'id')::uuid into rid from jsonb_array_elements(s.source->'reviews') x where x->>'analysis_language'='en' and nullif(x->>'analysis_text','') is not null and not exists(select 1 from public.analysis_jev_review_cache c where c.review_id=(x->>'id')::uuid and c.analysis_text_sha256=x->>'analysis_text_sha256' and c.configuration_id=s.configuration_id) limit 1;
 insert into public.analysis_jev_pilot_authorizations(snapshot_id,organization_id,stage,language,source_sha256,config_sha256,input_sha256,allowed_review_ids,max_calls,authorized_by,authorized_at,user_instruction) values(s.id,s.organization_id,'jev','en',s.source_sha256,s.config_sha256,repeat('a',64),jsonb_build_array(rid),1,actor,now(),'ROLLBACK SYNTHETIC SQL TEST ONLY') returning id into aid;
 bad=false;begin perform public.start_economy_pilot_job(actor,s.id,'jev','en',repeat('a',64),jsonb_build_object('review_ids',jsonb_build_array(rid)),false);exception when others then if sqlerrm='PILOT_COST_CONFIRMATION_REQUIRED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_COST_CONFIRMATION';end if;
 bad=false;begin perform public.start_economy_pilot_job(actor,s.id,'jev','en',repeat('a',64),jsonb_build_object('review_ids',jsonb_build_array('ffffffff-ffff-4fff-8fff-ffffffffffff')),true);exception when others then if sqlerrm='PILOT_ANALYSIS_SCOPE_INVALID' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_REVIEW_SCOPE';end if;
 jid=public.start_economy_pilot_job(actor,s.id,'jev','en',repeat('a',64),jsonb_build_object('review_ids',jsonb_build_array(rid),'expected_served_model','jev-synthetic-offline-only'),true);
 if public.start_economy_pilot_job(actor,s.id,'jev','en',repeat('a',64),jsonb_build_object('review_ids',jsonb_build_array(rid)),true)<>jid then raise exception 'TEST_JOB_IDEMPOTENCE';end if;
 claimed=public.claim_economy_pilot_job(wid);if claimed->>'id'<>jid::text or public.claim_economy_pilot_job(gen_random_uuid()) is not null then raise exception 'TEST_WORKER_LEASE';end if;
 select * into t from public.claim_economy_pilot_tasks(jid,wid);if not found or t.status<>'running' or not public.pilot_cache_dispatch_allowed(t.cache_id,s.organization_id,s.configuration_id) then raise exception 'TEST_CACHE_DISPATCH';end if;
 if exists(select 1 from public.claim_economy_pilot_tasks(jid,wid)) then raise exception 'TEST_DUPLICATE_CALL';end if;
 select jsonb_build_object('themes',jsonb_object_agg(key,jsonb_build_object('choice','absent','probabilities',jsonb_build_object('absent',1,'positive',0,'negative',0,'both',0)))) into resp from jsonb_object_keys((select config->'questions' from public.analysis_jev_economy_configurations where id=s.configuration_id)) key;
 select jsonb_object_agg(key,jsonb_build_object('choice','absent','positive',0,'negative',0,'repeat_stable',null,'evaluations',1)) into th from jsonb_object_keys(resp->'themes') key;
 if not public.pilot_response_valid(resp) or public.pilot_response_valid(jsonb_set(resp,'{themes,food_quality,choice}','null')) then raise exception 'TEST_RESPONSE_VALIDATION';end if;
 if not public.complete_economy_pilot_task(jid,wid,t.id,jsonb_build_object('status','completed','request_count',1,'response',resp,'theme_results',th,'served_model','jev-synthetic-offline-only','input_tokens',8000,'output_tokens',1000,'duration_ms',1,'usage_complete',true,'error_code',null)) then raise exception 'TEST_TASK_SAVE';end if;
 if public.complete_economy_pilot_task(jid,wid,t.id,'{}') then raise exception 'TEST_REPEAT_SAVE';end if;
 if not public.finish_economy_pilot_tick(jid,wid,'{"sol_calls":0}'::jsonb) then raise exception 'TEST_JOB_FINISH';end if;
 if exists(select 1 from public.analysis_jev_pilot_jobs where stage='sol') then raise exception 'TEST_NO_SOL_CHAIN';end if;
 if not exists(select 1 from public.analysis_jev_pilot_jobs where id=jid and request_count=1 and input_tokens=8000 and abs(cost_usd-.000336)<.0000000001) then raise exception 'TEST_COST_TOTAL';end if;
 bad=false;begin update public.analysis_jev_pilot_jobs set status='queued' where id=jid;exception when others then if sqlerrm='PILOT_NO_AUTOMATIC_RETRY' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_JOB_PERMANENT';end if;
 bad=false;begin update public.analysis_jev_pilot_authorizations set max_calls=2 where id=aid;exception when others then if sqlerrm='PILOT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_AUTH_IMMUTABLE';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if (select count(*) from public.analysis_jev_pilot_snapshots)=0 then raise exception 'TEST_OWNER_ACCESS';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_jev_pilot_snapshots) or exists(select 1 from public.analysis_jev_pilot_tasks) then raise exception 'TEST_RLS_CROSS_TENANT_LEAK';end if;end $$;
rollback;
