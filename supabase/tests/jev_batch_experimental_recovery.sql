-- Mechanical state/atomicity checks, rolled back. No HTTP request is committed.
begin;
set local role service_role;
do $$declare r uuid;t uuid;t2 uuid;w jsonb;ok boolean;source_run uuid;fixture_report uuid;begin
 select id into source_run from public.analysis_jev_batch_runs where baseline_report_id='55b107c4-a33a-405b-b323-4d63f4898223';
 if source_run is null then raise exception 'TEST_SOURCE_MISSING';end if;
 -- Separate transaction-only fixture: the real attempt/report is never modified.
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_generation_id,language,configuration_version,corpus_sha256,source_report,source_reviews,state,statistics)
 select organization_id,establishment_id,gen_random_uuid(),language,'jev-multi-review-initial-v1',corpus_sha256,source_report,source_reviews,'generating',statistics from public.analysis_parallel_reports where id='55b107c4-a33a-405b-b323-4d63f4898223' returning id into fixture_report;
 insert into public.analysis_jev_batch_runs(organization_id,establishment_id,baseline_report_id,report_id,snapshot,snapshot_sha256,template,manifest_sha256,source_manifest_sha256,authorization_evidence,expires_at)
 select organization_id,establishment_id,baseline_report_id,fixture_report,snapshot,snapshot_sha256,template,manifest_sha256,gen_random_uuid()::text,'Mechanical SQL fixture, no provider request committed',now()+interval '2 hours' from public.analysis_jev_batch_runs where id=source_run returning id into r;
 insert into public.analysis_jev_batch_tasks(run_id,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight,status,receipt,receipt_sha256,historical_source)
 select r,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight,'received',receipt,receipt_sha256,historical_source from public.analysis_jev_batch_tasks where run_id=source_run;
 if public.jev_batch_claim(r,'unarmed') is not null then raise exception 'TEST_UNARMED_CLAIM';end if;
 if public.jev_batch_create_saved('55b107c4-a33a-405b-b323-4d63f4898223','Mechanical duplicate-start qualification; no provider call permitted.')<>source_run then raise exception 'TEST_DUPLICATE_START';end if;
 update public.analysis_jev_batch_runs set armed=true,max_new_jev_calls=2 where id=r;
 select id into t from public.analysis_jev_batch_tasks where run_id=r and number=1;
 select id into t2 from public.analysis_jev_batch_tasks where run_id=r and number=2;
 -- Already saved receipts can be reclaimed for validation, never sent again.
 w=public.jev_batch_claim(r,'validator1');
 if w->>'id'<>t::text or (w->>'request_count')::int<>0 or w->>'status'<>'received' then raise exception 'TEST_SAVED_RECEIPT_NOT_REUSED';end if;
 if exists(select 1 from public.analysis_jev_batch_tasks where run_id=r and request_count<>0) then raise exception 'TEST_REPLAY_SPENDING';end if;
 -- A new native attempt is reserved once; after a crash its result stays unknown.
 update public.analysis_jev_batch_tasks set status='completed' where run_id=r;
 update public.analysis_jev_batch_tasks set status='pending',receipt=null,receipt_sha256=null,worker=null,lease_until=null where id in(t,t2);
 w=public.jev_batch_claim(r,'first');
 if w->>'id'<>t::text or (w->>'request_count')::int<>1 then raise exception 'TEST_FIRST_RESERVATION';end if;
 if public.jev_batch_claim(r,'concurrent') is not null then raise exception 'TEST_NATIVE_CONCURRENCY_NOT_BOUNDED';end if;
 update public.analysis_jev_batch_tasks set lease_until=now()-interval '1 second' where id=t;
 w=public.jev_batch_claim(r,'resume');
 if w->>'id'<>t2::text or (w->>'request_count')::int<>1 then raise exception 'TEST_UNSTARTED_NOT_RESUMED';end if;
 if not exists(select 1 from public.analysis_jev_batch_tasks where id=t and status='unknown' and request_count=1) then raise exception 'TEST_UNKNOWN_RESENT';end if;
 if public.jev_batch_claim(r,'duplicate') is not null then raise exception 'TEST_CONSUMED_RESERVED_AGAIN';end if;
 -- A received response is write-once and an identical save is idempotent.
 select id into t from public.analysis_jev_batch_tasks where run_id=r and number=3;
 select public.jev_batch_receive(t,'wrong',receipt,receipt_sha256) into ok from public.analysis_jev_batch_tasks where id=t;
 if not ok then raise exception 'TEST_IDENTICAL_RECEIPT_SAVE';end if;
 if public.jev_batch_receive(t,'wrong','{}',public.jls_restaurant_hash('{}')) then raise exception 'TEST_RECEIPT_OVERWRITE';end if;
 -- Sol is a separate one-attempt gate, including when its result is unknown.
 update public.analysis_jev_batch_tasks set status='completed' where run_id=r;
 update public.analysis_jev_batch_runs set status='running',armed=true,stage='sol',envelope='{"mechanical_mock":true}' where id=r;
 if not public.jev_batch_claim_sol(r,'sol1') then raise exception 'TEST_SOL_FIRST';end if;
 if public.jev_batch_claim_sol(r,'sol2') then raise exception 'TEST_SOL_DUPLICATED';end if;
 update public.analysis_jev_batch_runs set sol_lease_until=now()-interval '1 second' where id=r;
 if public.jev_batch_claim_sol(r,'sol3') then raise exception 'TEST_SOL_UNKNOWN_RETRIED';end if;
 if not exists(select 1 from public.analysis_jev_batch_runs where id=r and status='billing_uncertain' and not armed and sol_request_count=1) then raise exception 'TEST_SOL_UNKNOWN_NOT_BLOCKED';end if;
end $$;
select 'passed: duplicate start, saved receipt reuse, unstarted continuation, unknown-result non-retry, receipt immutability, single Sol reservation' as qualification;
rollback;

