-- Real saved inputs, transaction-only fixtures. All pg_net messages roll back.
begin;
set local role service_role;
do $$declare source public.analysis_jev_batch_runs;fixture uuid;report uuid;draft jsonb;final jsonb;bad jsonb;begin
 select * into source from public.analysis_jev_batch_runs where status='completed' and envelope is not null order by completed_at desc limit 1;
 if source.id is null then raise exception 'TEST_COMPLETED_SOURCE_REQUIRED';end if;
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_generation_id,language,configuration_version,corpus_sha256,source_report,source_reviews,state,statistics)
 select organization_id,establishment_id,gen_random_uuid(),language,configuration_version,corpus_sha256,source_report,source_reviews,'generating',statistics from public.analysis_parallel_reports where id=source.report_id returning id into report;
 insert into public.analysis_jev_batch_runs(organization_id,establishment_id,baseline_report_id,report_id,snapshot,snapshot_sha256,template,manifest_sha256,source_manifest_sha256,authorization_evidence,expires_at,max_new_jev_calls,stage,armed)
 values(source.organization_id,source.establishment_id,source.report_id,report,source.snapshot,source.snapshot_sha256,source.template,source.manifest_sha256,source.source_manifest_sha256,'Transactional local preparation fixture; no provider attempt permitted.',now()+interval '1 hour',0,'prepare_evidence',true) returning id into fixture;
 insert into public.analysis_jev_batch_tasks(run_id,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight,status,receipt,receipt_sha256,projection,projection_sha256,historical_source)
 select fixture,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight,'completed',receipt,receipt_sha256,projection,projection_sha256,'{"transactional_saved_fixture":true}' from public.analysis_jev_batch_tasks where run_id=source.id;
 final=source.envelope;draft=final-'measurement';
 if not public.jev_batch_save_draft(fixture,draft,public.jls_restaurant_hash(draft)) or not public.jev_batch_save_draft(fixture,draft,public.jls_restaurant_hash(draft)) then raise exception 'TEST_DRAFT_IDEMPOTENCE';end if;
 if not exists(select 1 from public.analysis_jev_batch_runs where id=fixture and stage='measure_sol' and draft_created_at is not null and sol_request_count=0 and envelope is null) then raise exception 'TEST_DRAFT_NOT_DURABLE';end if;
 if public.jev_batch_claim_sol(fixture,'must-not-send') then raise exception 'TEST_UNMEASURED_SOL_RESERVED';end if;
 begin update public.analysis_jev_batch_runs set draft='{}' where id=fixture;raise exception 'TEST_DRAFT_MUTABLE';exception when others then if sqlerrm<>'BATCH_FROZEN_DRAFT_CHANGED' then raise;end if;end;
 bad=jsonb_set(final,'{packet,language}','"changed"');
 begin perform public.jev_batch_save_envelope(fixture,bad,public.jls_restaurant_hash(bad));raise exception 'TEST_DOSSIER_CHANGED';exception when others then if sqlerrm<>'BATCH_SOL_NOT_READY' then raise;end if;end;
 bad=final-'measurement';
 begin perform public.jev_batch_save_envelope(fixture,bad,public.jls_restaurant_hash(bad));raise exception 'TEST_UNMEASURED_DOSSIER';exception when others then if sqlerrm<>'BATCH_SOL_NOT_READY' then raise;end if;end;
 if not public.jev_batch_save_envelope(fixture,final,public.jls_restaurant_hash(final)) or not public.jev_batch_save_envelope(fixture,final,public.jls_restaurant_hash(final)) then raise exception 'TEST_MEASURED_ENVELOPE';end if;
 if not exists(select 1 from public.analysis_jev_batch_runs where id=fixture and stage='sol' and envelope_prepared_at>=draft_created_at and sol_request_count=0) then raise exception 'TEST_NEXT_LOCAL_STAGE';end if;
 if exists(select 1 from public.analysis_jev_batch_tasks where run_id=fixture and request_count<>0) then raise exception 'TEST_PROVIDER_ATTEMPT_CONSUMED';end if;
 if public.wake_current_jev_preparation(source.current_source_run_id) is not null then raise exception 'TEST_FINISHED_SOURCE_WOKEN';end if;
 if has_function_privilege('authenticated','public.jev_batch_save_draft(uuid,jsonb,text)','EXECUTE') or has_function_privilege('anon','public.wake_current_jev_preparation(uuid)','EXECUTE') then raise exception 'TEST_RPC_NOT_PRIVATE';end if;
end $$;
select 'passed: immutable idempotent draft, separate measured stage, unchanged packet, no Sol reservation before measurement, no native attempts and no wake of completed source' as qualification;
rollback;
