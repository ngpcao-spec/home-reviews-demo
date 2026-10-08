-- Rollback-only synthetic ledger checks. No real V10 enqueue, source mutation or model call.
begin;
do $$
declare fixture_id uuid:=gen_random_uuid();fixture_generation uuid:=gen_random_uuid();worker_id uuid:=gen_random_uuid();org uuid;est uuid;actor uuid;review_id uuid:=gen_random_uuid();task public.historical_jev_analysis_tasks;run_cursor integer;rejected boolean;pub jsonb;current_report_hash text;
begin
 if has_table_privilege('authenticated','public.historical_jev_v10_run_metrics','SELECT,INSERT,UPDATE,DELETE') or has_function_privilege('anon','public.enqueue_first_v10_report(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb)','EXECUTE') then raise exception 'private ledger grants failed';end if;
 select e.organization_id,e.id,m.user_id into org,est,actor from public.establishments e join public.organization_members m on m.organization_id=e.organization_id where m.role in ('owner','admin','manager') limit 1;
 if actor is null then raise exception 'fixture actor missing';end if;
 select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) into current_report_hash from public.historical_establishment_reports t;
 -- An unauthorized caller cannot enqueue anything; no successful real-source enqueue is attempted.
 rejected=false;begin perform public.enqueue_first_v10_report(est,org,gen_random_uuid(),'vi',gen_random_uuid(),gen_random_uuid(),'{}','{}');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;rejected=true;end;if not rejected then raise exception 'unauthorized enqueue accepted';end if;
 insert into public.historical_report_runs(id,generation_id,organization_id,establishment_id,language,requested_by,status,snapshot,model,total_steps,locked_by,lease_until)
  values(fixture_id,fixture_generation,org,est,'vi',actor,'running',jsonb_build_object('analysis_version',10,'analysis_engine','jev_hybrid_calibrated','source_generation_id',gen_random_uuid(),'reviews','[]'::jsonb,'base','{}'::jsonb,'source_snapshot','{}'::jsonb,'v10_config','{}'::jsonb,'calibration_audit','{}'::jsonb),'gpt-6.1-sol',5,worker_id,now()+interval '240 seconds');
 insert into public.historical_jev_v10_run_metrics(run_id,organization_id,source_generation_id,source_snapshot_sha256,rates,threshold_version,question_set,thresholds) values(fixture_id,org,gen_random_uuid(),repeat('0',64),'{"jev_input":0.042,"sol_input":2,"sol_output":10}','jev-theme-thresholds-v1','themes_v10_calibrated_v1','{}');
 insert into public.historical_jev_analysis_tasks(run_id,organization_id,review_id,review_alias,position,kind,repeat) values(fixture_id,org,review_id,'r1',1,'sentiment',0);
 insert into public.historical_jev_analysis_tasks(run_id,organization_id,review_id,review_alias,position,kind,repeat) select fixture_id,org,review_id,'r1',1,'themes',n from generate_series(1,3) n;
 if public.historical_v10_metrics_update(fixture_id,worker_id,'narrative_begin','{}') then raise exception 'narrative ran before Jev';end if;
 for task in select * from public.claim_historical_jev_v10_tasks(fixture_id,worker_id,100) loop
  if not public.complete_historical_jev_v10_task(fixture_id,worker_id,task.id,'{"status":"completed","result":{"synthetic":true},"error_code":null,"served_model":"synthetic","request_count":1,"retry_count":0,"input_tokens":10,"output_tokens":1,"duration_ms":1,"usage_complete":true}') then raise exception 'task save failed';end if;
  if public.complete_historical_jev_v10_task(fixture_id,worker_id,task.id,'{}') then raise exception 'paid task replay accepted';end if;
 end loop;
 if (select jev_theme_requests from public.historical_jev_v10_run_metrics where run_id=fixture_id)<>3 or (select jev_sentiment_requests from public.historical_jev_v10_run_metrics where run_id=fixture_id)<>1 then raise exception 'usage counts failed';end if;
 if not public.historical_v10_metrics_update(fixture_id,worker_id,'narrative_begin','{}') then raise exception 'narrative gate failed';end if;
 if public.historical_v10_metrics_update(fixture_id,worker_id,'narrative_begin','{}') then raise exception 'second narrative accepted';end if;
 perform public.historical_v10_metrics_update(fixture_id,worker_id,'narrative_finish','{"success":false,"result":null,"duration_ms":0,"usage_complete":true}');
 rejected=false;begin update public.historical_report_runs set snapshot=snapshot||'{"source_generation_id":"changed"}' where id=fixture_id;exception when others then if sqlerrm<>'REPORT_V10_SOURCE_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'source mutable';end if;
 select cursor into run_cursor from public.historical_report_runs where id=fixture_id;
 pub=jsonb_build_object('generation_id',fixture_generation,'organization_id',org,'establishment_id',est,'preferred_language','vi','analysis_version',10,'ai_status','completed','consultant_report',jsonb_build_object('analysis_engine','jev_hybrid_calibrated'));
 if not public.checkpoint_historical_report_run(fixture_id,fixture_generation,worker_id,run_cursor,jsonb_build_object('snapshot',(select snapshot from public.historical_report_runs where id=fixture_id)||jsonb_build_object('publication',pub))) then raise exception 'checkpoint failed';end if;
 if not public.complete_experimental_v10_report(fixture_id,fixture_generation,worker_id,run_cursor,pub) then raise exception 'completion failed';end if;
 if current_report_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.historical_establishment_reports t) then raise exception 'manager report changed';end if;
 rejected=false;begin update public.historical_report_runs set findings='[]' where id=fixture_id;exception when others then if sqlerrm<>'REPORT_V10_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'completed run mutable';end if;
 rejected=false;begin update public.historical_jev_v10_run_metrics set jev_input_tokens=0 where run_id=fixture_id;exception when others then if sqlerrm<>'REPORT_V10_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'completed metrics mutable';end if;
end $$;
rollback;
select 'V10 synthetic lease/task/narrative/immutability/publication checks passed; all fixtures rolled back' result;
